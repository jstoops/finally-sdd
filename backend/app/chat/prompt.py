"""The chat prompt (PLAN §9 "How It Works" steps 2-4 and "System Prompt Guidance").

Every turn sends, in this fixed order: the FinAlly system prompt, the live portfolio
context as JSON in a second system message, up to 20 prior messages oldest first, and
the new user message last. History is replayed as text plus a plain "[executed: ...]"
summary of executed actions, never as the raw `trades` / `watchlist_changes` JSON,
so the model cannot re-emit earlier actions and run them twice.
"""

from __future__ import annotations

import json

from ..money import format_money, format_qty

SYSTEM_PROMPT = """\
You are FinAlly, an AI trading assistant inside a simulated trading terminal (fake money).
- Analyze portfolio composition, concentration risk and unrealized P&L using the portfolio \
context provided.
- Suggest trades with brief reasoning. Execute trades only when the user asks or agrees.
- Manage the watchlist proactively when it helps the user.
- Be concise and data-driven. Plain text only: no markdown tables, no headings.
- Quantities are shares, with at most 4 decimal places. Convert dollar amounts to shares \
using the current price in the context.
- For "sell all", use the exact held quantity from the context.
- Only include trades and watchlist_changes the user requests in their latest message; \
never repeat earlier actions.
- Describe orders as being placed; the app confirms fills and reports failures.
- Always reply with JSON: {"message": string, "trades": [...], "watchlist_changes": [...]}, \
using [] when there are none."""

CONTEXT_PREFIX = "Portfolio context (JSON):\n"


def build_context(portfolio: dict, watchlist: list[dict]) -> dict:
    """The portfolio context: the view's numbers copied as is, plus the watchlist.

    `portfolio` is `PortfolioService.view()`; `watchlist` is
    `WatchlistService.list_entries()`. chg_percent is the session change in percent
    at 2 dp, or None without a price or a positive open price.
    """
    return {
        "cash_balance": portfolio["cash_balance"],
        "total_value": portfolio["total_value"],
        "positions_value": portfolio["positions_value"],
        "unrealized_pnl": portfolio["unrealized_pnl"],
        "positions": portfolio["positions"],
        "watchlist": [
            {
                "ticker": entry["ticker"],
                "price": entry["price"],
                "chg_percent": _chg_percent(entry["price"], entry["open_price"]),
            }
            for entry in watchlist
        ],
    }


def replay_content(row: dict) -> str:
    """A stored chat row as prompt text; assistant rows add their executed actions."""
    content = row["content"]
    actions = row.get("actions")
    if row["role"] != "assistant" or not actions:
        return content
    parts = [
        f"{change['action']} {change['ticker']}"
        for change in actions.get("watchlist_changes") or []
        if change.get("status") == "executed"
    ]
    parts += [
        f"{trade['side']} {format_qty(trade['quantity'])} {trade['ticker']} "
        f"@ {format_money(trade['price'])}"
        for trade in actions.get("trades") or []
        if trade.get("status") == "executed"
    ]
    if not parts:
        return content
    return f"{content}\n[executed: {'; '.join(parts)}]"


def build_messages(context: dict, history: list[dict], text: str) -> list[dict[str, str]]:
    """System prompt, context, history oldest first, then the new user message."""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": CONTEXT_PREFIX + json.dumps(context, ensure_ascii=False)},
        *({"role": row["role"], "content": replay_content(row)} for row in history),
        {"role": "user", "content": text},
    ]


def _chg_percent(price: float | None, open_price: float | None) -> float | None:
    if price is None or open_price is None or open_price <= 0:
        return None
    return round((price - open_price) / open_price * 100, 2)
