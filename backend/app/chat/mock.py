"""Deterministic mock LLM (PLAN §9 "LLM Mock Mode"), enabled by LLM_MOCK=true.

The rules match the user message case-insensitively and the first rule wins. The
mock returns raw JSON text, like a real model, so its replies go through the same
parse, execute and store path as any other client.
"""

from __future__ import annotations

import json
import re

_BUY = re.compile(r"\bbuy\b", re.IGNORECASE)
_SELL = re.compile(r"\bsell\b", re.IGNORECASE)
_ADD = re.compile(r"\badd\s+([A-Za-z][A-Za-z0-9.]{0,9})\b", re.IGNORECASE)
_REMOVE = re.compile(r"\bremove\s+([A-Za-z][A-Za-z0-9.]{0,9})\b", re.IGNORECASE)

GREETING = "Hello! I'm FinAlly, your AI trading assistant. How can I help?"


def mock_reply(text: str) -> dict:
    """The structured reply the PLAN §9 table gives for `text`."""
    if _BUY.search(text):
        return {
            "message": "Buying 1 share of AAPL.",
            "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}],
            "watchlist_changes": [],
        }
    if _SELL.search(text):
        return {
            "message": "Selling 1 share of AAPL.",
            "trades": [{"ticker": "AAPL", "side": "sell", "quantity": 1}],
            "watchlist_changes": [],
        }
    if match := _ADD.search(text):
        ticker = match.group(1).upper()
        return {
            "message": f"Adding {ticker} to your watchlist.",
            "trades": [],
            "watchlist_changes": [{"ticker": ticker, "action": "add"}],
        }
    if match := _REMOVE.search(text):
        ticker = match.group(1).upper()
        return {
            "message": f"Removing {ticker} from your watchlist.",
            "trades": [],
            "watchlist_changes": [{"ticker": ticker, "action": "remove"}],
        }
    return {"message": GREETING, "trades": [], "watchlist_changes": []}


class MockLLMClient:
    """Stateless LLMClient that answers the last user message with `mock_reply`."""

    async def complete(self, messages: list[dict[str, str]]) -> str:
        """Return `json.dumps(mock_reply(...))` for the last user message ("" if none)."""
        text = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"), ""
        )
        return json.dumps(mock_reply(text))
