"""Run the actions an LLM reply requested through the existing services (PLAN §9 Auto-Execution).

Watchlist changes run first, then trades, so a trade can use a ticker the same reply
just added. Each action runs independently and in order: a failure is recorded and
the next action still runs. Every mutation goes through `WatchlistService.add/remove`
and `TradeService.execute`, which apply the same rules as the REST routes and take
the shared lock themselves; this module never takes it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from ..errors import DomainError
from ..trading import TradeService
from ..watchlist import WatchlistService
from .parsing import ParsedReply

logger = logging.getLogger(__name__)

UNEXPECTED_ERROR = "Unexpected error; the action was not run."
BAD_WATCHLIST_ACTION = "Action must be 'add' or 'remove'."


@dataclass(frozen=True, slots=True)
class ActionOutcome:
    """The PLAN §8 `actions` record (None when nothing was requested) and failure notes."""

    actions: dict | None
    notes: list[str]


async def execute_actions(
    reply: ParsedReply, watchlist: WatchlistService, trades: TradeService
) -> ActionOutcome:
    """Execute `reply`'s watchlist changes, then its trades; record each outcome."""
    if not reply.trades and not reply.watchlist_changes:
        return ActionOutcome(None, [])
    watch_records = [await _watchlist_change(item, watchlist) for item in reply.watchlist_changes]
    trade_records = [await _trade(item, trades) for item in reply.trades]
    return ActionOutcome({"trades": trade_records, "watchlist_changes": watch_records}, [])


async def _watchlist_change(item: object, watchlist: WatchlistService) -> dict:
    item = item if isinstance(item, dict) else {}  # 03-02 adds per-item validation
    ticker = item.get("ticker")
    action = item.get("action")
    try:
        if action == "add":
            entry, _created = await watchlist.add(ticker)  # already watched is not an error
            ticker = entry["ticker"]
        elif action == "remove":
            await watchlist.remove(ticker)
        else:
            raise DomainError(BAD_WATCHLIST_ACTION)
    except DomainError as exc:
        return {"ticker": ticker, "action": action, "status": "failed", "error": exc.message}
    except Exception:
        logger.exception("Chat: action failed")
        return {"ticker": ticker, "action": action, "status": "failed", "error": UNEXPECTED_ERROR}
    if isinstance(ticker, str):
        ticker = ticker.strip().upper()
    return {"ticker": ticker, "action": action, "status": "executed"}


async def _trade(item: object, trades: TradeService) -> dict:
    item = item if isinstance(item, dict) else {}
    ticker = item.get("ticker")
    side = item.get("side")
    quantity = item.get("quantity")
    try:
        result = await trades.execute(ticker, quantity, side)
    except DomainError as exc:
        return {
            "ticker": ticker,
            "side": side,
            "quantity": quantity,
            "status": "failed",
            "error": exc.message,
        }
    except Exception:
        logger.exception("Chat: action failed")
        return {
            "ticker": ticker,
            "side": side,
            "quantity": quantity,
            "status": "failed",
            "error": UNEXPECTED_ERROR,
        }
    trade = result.trade
    return {
        "ticker": trade.ticker,
        "side": trade.side,
        "quantity": trade.quantity,
        "status": "executed",
        "price": trade.price,
    }
