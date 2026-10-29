"""Run the actions an LLM reply requested through the existing services (PLAN §9 Auto-Execution).

Watchlist changes run first, then trades, so a trade can use a ticker the same reply
just added. Each action runs independently and in input order: a failure is recorded
and the next action still runs. At most MAX_WATCHLIST_CHANGES and MAX_TRADES items
per reply are processed (by position); later items fail without reaching a service.
Each item is type-checked on its own (`WatchlistItem` / `TradeItem`), then every
mutation goes through `WatchlistService.add/remove` and `TradeService.execute`, which
apply the same rules as the REST routes and take the shared lock themselves; this
module never takes it.

Every failed action yields one templated note (PLAN §9 "Reporting Failures"), e.g.
"⚠️ Couldn't buy 50 TSLA: insufficient cash (need $12,450.00, have $8,095.00).",
watchlist notes first, then trade notes, each in input order.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass

from pydantic import ValidationError

from ..errors import DomainError
from ..money import format_qty
from ..tickers import normalize_ticker
from ..trading import MAX_QUANTITY, TradeService
from ..watchlist import WatchlistService
from .parsing import ParsedReply, TradeItem, WatchlistItem

logger = logging.getLogger(__name__)

MAX_TRADES = 10  # per reply (G-21)
MAX_WATCHLIST_CHANGES = 10  # per reply (G-21)

UNEXPECTED_ERROR = "Unexpected error; the action was not run."
BAD_WATCHLIST_ACTION = "Action must be 'add' or 'remove'."
TOO_MANY_TRADES = f"Too many actions (at most {MAX_TRADES} trades per reply)."
TOO_MANY_WATCHLIST = (
    f"Too many actions (at most {MAX_WATCHLIST_CHANGES} watchlist changes per reply)."
)
INVALID_TRADE = "Invalid trade (expected ticker, side and quantity)."
INVALID_WATCHLIST = "Invalid watchlist change (expected ticker and action)."
INVALID_TRADES_LIST = "Invalid trades list."
INVALID_WATCHLIST_LIST = "Invalid watchlist_changes list."

WARNING = "⚠️ "  # U+26A0 U+FE0F and a space start every note
_MAX_TEXT = 32  # raw strings echoed into a failed record are cut to this length


@dataclass(frozen=True, slots=True)
class ActionOutcome:
    """The PLAN §8 `actions` record (None when nothing was requested) and failure notes."""

    actions: dict | None
    notes: list[str]


async def execute_actions(
    reply: ParsedReply, watchlist: WatchlistService, trades: TradeService
) -> ActionOutcome:
    """Execute `reply`'s watchlist changes, then its trades; record each outcome and note."""
    if not reply.trades and not reply.watchlist_changes and not reply.bad_lists:
        return ActionOutcome(None, [])

    watch_records: list[dict] = []
    if "watchlist_changes" in reply.bad_lists:
        watch_records.append(_failed_watch(None, INVALID_WATCHLIST_LIST))
    for i, raw in enumerate(reply.watchlist_changes):
        if i >= MAX_WATCHLIST_CHANGES:
            watch_records.append(_failed_watch(raw, TOO_MANY_WATCHLIST))
        else:
            watch_records.append(await _watchlist_change(raw, watchlist))

    trade_records: list[dict] = []
    if "trades" in reply.bad_lists:
        trade_records.append(_failed_trade(None, INVALID_TRADES_LIST))
    for i, raw in enumerate(reply.trades):
        if i >= MAX_TRADES:
            trade_records.append(_failed_trade(raw, TOO_MANY_TRADES))
        else:
            trade_records.append(await _trade(raw, trades))

    notes = [_watch_note(r) for r in watch_records if r["status"] == "failed"]
    notes += [_trade_note(r) for r in trade_records if r["status"] == "failed"]
    return ActionOutcome({"trades": trade_records, "watchlist_changes": watch_records}, notes)


def failure_reason(error: str) -> str:
    """A service error as a note clause: stripped, trailing "." dropped, and the first
    letter lowercased only when the second is lowercase ("Insufficient cash" becomes
    "insufficient cash"; "PYPL is not on your watchlist" is unchanged)."""
    text = error.strip().rstrip(".")
    if len(text) > 1 and text[0].isupper() and text[1].islower():
        text = text[0].lower() + text[1:]
    return text


# --- Internals ---


async def _watchlist_change(raw: object, watchlist: WatchlistService) -> dict:
    try:
        item = WatchlistItem.model_validate(raw)
    except ValidationError:
        return _failed_watch(raw, INVALID_WATCHLIST)
    action = item.action.strip().lower()
    try:
        if action == "add":
            entry, _created = await watchlist.add(item.ticker)  # already watched is executed
            ticker = entry["ticker"]
        elif action == "remove":
            await watchlist.remove(item.ticker)
            ticker = normalize_ticker(item.ticker)
        else:
            return _failed_watch(raw, BAD_WATCHLIST_ACTION)
    except DomainError as exc:  # includes NotFoundError
        return _failed_watch(raw, exc.message)
    except Exception:
        logger.exception("Chat: action failed")
        return _failed_watch(raw, UNEXPECTED_ERROR)
    return {"ticker": ticker, "action": action, "status": "executed"}


async def _trade(raw: object, trades: TradeService) -> dict:
    try:
        item = TradeItem.model_validate(raw)
    except ValidationError:
        return _failed_trade(raw, INVALID_TRADE)
    try:
        result = await trades.execute(item.ticker, item.quantity, item.side)
    except DomainError as exc:
        return _failed_trade(raw, exc.message)
    except Exception:
        logger.exception("Chat: action failed")
        return _failed_trade(raw, UNEXPECTED_ERROR)
    trade = result.trade
    return {
        "ticker": trade.ticker,
        "side": trade.side,
        "quantity": trade.quantity,
        "status": "executed",
        "price": trade.price,
    }


def _field(raw: object, key: str) -> object:
    return raw.get(key) if isinstance(raw, dict) else None


def _text(value: object) -> str | None:
    """A string field, stripped and cut to _MAX_TEXT chars; None for anything else or blank."""
    if not isinstance(value, str):
        return None
    text = value.strip()[:_MAX_TEXT]
    return text or None


def _number(value: object) -> int | float | None:
    """An int or float (never bool) that is finite; None otherwise, so JSON never sees NaN."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        finite = math.isfinite(value)
    except OverflowError:  # an int beyond float range
        return None
    return value if finite else None


def _upper(value: str | None) -> str | None:
    return value.upper() if value is not None else None


def _lower(value: str | None) -> str | None:
    return value.lower() if value is not None else None


def _failed_watch(raw: object, error: str) -> dict:
    return {
        "ticker": _upper(_text(_field(raw, "ticker"))),
        "action": _lower(_text(_field(raw, "action"))),
        "status": "failed",
        "error": error,
    }


def _failed_trade(raw: object, error: str) -> dict:
    return {
        "ticker": _upper(_text(_field(raw, "ticker"))),
        "side": _lower(_text(_field(raw, "side"))),
        "quantity": _number(_field(raw, "quantity")),
        "status": "failed",
        "error": error,
    }


def _trade_note(record: dict) -> str:
    reason = failure_reason(record["error"])
    ticker, side, qty = record["ticker"], record["side"], record["quantity"]
    if ticker and side in ("buy", "sell") and qty is not None and abs(qty) <= MAX_QUANTITY:
        return f"{WARNING}Couldn't {side} {format_qty(qty)} {ticker}: {reason}."
    return f"{WARNING}Couldn't run a requested trade: {reason}."


def _watch_note(record: dict) -> str:
    reason = failure_reason(record["error"])
    ticker, action = record["ticker"], record["action"]
    if ticker and action == "add":
        return f"{WARNING}Couldn't add {ticker} to your watchlist: {reason}."
    if ticker and action == "remove":
        return f"{WARNING}Couldn't remove {ticker} from your watchlist: {reason}."
    return f"{WARNING}Couldn't run a requested watchlist change: {reason}."
