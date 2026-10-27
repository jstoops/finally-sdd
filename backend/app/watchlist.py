"""Watchlist service: reads the watchlist and joins live prices from the cache."""

from __future__ import annotations

import asyncio
import logging
from contextlib import closing

from .db import DEFAULT_USER_ID, Database
from .market import PriceCache

logger = logging.getLogger(__name__)


class WatchlistService:
    """Watchlist reads in the PLAN §8 shape.

    Prices come from the shared PriceCache (already rounded to 2 dp there) and are
    passed through unchanged; both are None until the ticker has a cached price.
    """

    def __init__(self, db: Database, cache: PriceCache) -> None:
        self._db = db
        self._cache = cache

    async def list_entries(self) -> list[dict]:
        """Watchlist entries in `added_at, rowid` order: ticker, price, open_price, added_at."""
        rows = await asyncio.to_thread(self._load_rows)
        return [self._entry(ticker, added_at) for ticker, added_at in rows]

    def _load_rows(self) -> list[tuple[str, str]]:
        with closing(self._db.connect()) as conn:
            rows = conn.execute(
                "SELECT ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at, rowid",
                (DEFAULT_USER_ID,),
            ).fetchall()
        return [(row["ticker"], row["added_at"]) for row in rows]

    def _entry(self, ticker: str, added_at: str) -> dict:
        update = self._cache.get(ticker)
        return {
            "ticker": ticker,
            "price": update.price if update else None,
            "open_price": update.open_price if update else None,
            "added_at": added_at,
        }
