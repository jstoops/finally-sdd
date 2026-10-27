"""Authoritative ticker normalization shared by every route (PLAN §7 Trade Rules)."""

from __future__ import annotations

import re

from .errors import DomainError

TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")  # PLAN §7


def normalize_ticker(raw: str) -> str:
    """Trim and uppercase `raw`, then validate it against TICKER_RE.

    Non-ASCII input is rejected before uppercasing, so e.g. "aß" can never
    uppercase into the valid symbol "ASS". Raises DomainError (400).
    """
    symbol = raw.strip()
    if not symbol:
        raise DomainError("Ticker is required.")
    if symbol.isascii():
        symbol = symbol.upper()
        if TICKER_RE.fullmatch(symbol):
            return symbol
    raise DomainError(
        f"Invalid ticker {symbol!r}: use 1-10 letters, digits or '.', starting with a letter."
    )
