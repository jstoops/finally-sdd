"""Watchlist service: reads, adds and removes tickers, joining live prices from the cache."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import uuid
from contextlib import closing

from .db import DEFAULT_USER_ID, Database, now_iso
from .errors import DomainError, NotFoundError
from .market import PriceCache
from .tickers import normalize_ticker
from .tracker import TickerTracker

logger = logging.getLogger(__name__)

WATCHLIST_CAP = 50  # keeps the simulator's correlation matrix small


class WatchlistService:
    """Watchlist reads and mutations in the PLAN §8 shape.

    Prices come from the shared PriceCache (already rounded to 2 dp there) and are
    passed through unchanged; both are None until the ticker has a cached price.
    Mutations run under the shared state lock and reconcile the tracked tickers
    before the lock is released. A reconcile failure is logged, not raised: the
    database change has already committed, and the next reconcile heals the source.
    """

    def __init__(
        self,
        db: Database,
        cache: PriceCache,
        tracker: TickerTracker,
        lock: asyncio.Lock,
    ) -> None:
        self._db = db
        self._cache = cache
        self._tracker = tracker
        self._lock = lock

    @property
    def lock(self) -> asyncio.Lock:
        """The shared state lock serializing every mutation."""
        return self._lock

    async def list_entries(self) -> list[dict]:
        """Watchlist entries in `added_at, rowid` order: ticker, price, open_price, added_at."""
        rows = await asyncio.to_thread(self._load_rows)
        return [self._entry(ticker, added_at) for ticker, added_at in rows]

    async def add(self, raw: str) -> tuple[dict, bool]:
        """Add a ticker. Returns (entry, created); an existing ticker returns (entry, False).

        Raises DomainError for a malformed ticker or a full watchlist.
        """
        ticker = normalize_ticker(raw)
        async with self._lock:
            row, created = await asyncio.to_thread(self._add_tx, ticker)
            if created:
                logger.info("Watchlist: added %s", ticker)
            # On every add, not only on creation: reconcile is idempotent, so a re-add
            # also heals a source that failed to pick up an earlier, committed add.
            await self._reconcile("adding", ticker)  # the simulator prices it right away
            return self._entry(*row), created

    async def remove(self, raw: str) -> None:
        """Remove a ticker. Raises NotFoundError if it is not on the watchlist."""
        ticker = normalize_ticker(raw)
        async with self._lock:
            deleted = await asyncio.to_thread(self._remove_tx, ticker)
            if not deleted:
                raise NotFoundError(f"{ticker} is not on your watchlist")
            logger.info("Watchlist: removed %s", ticker)
            await self._reconcile("removing", ticker)  # a held ticker stays tracked

    # --- Internals ---

    async def _reconcile(self, action: str, ticker: str) -> None:
        """Reconcile tracked tickers after a committed change, without failing the request.

        The database change is already committed, so a source error must not turn it
        into a 500. The next mutation's reconcile repairs the source's ticker set.
        """
        try:
            await self._tracker.reconcile()
        except Exception:
            logger.exception("Tracker: reconcile failed after %s %s", action, ticker)

    def _add_tx(self, ticker: str) -> tuple[tuple[str, str], bool]:
        with self._db.transaction() as conn:
            existing = conn.execute(
                "SELECT ticker, added_at FROM watchlist WHERE user_id = ? AND ticker = ?",
                (DEFAULT_USER_ID, ticker),
            ).fetchone()
            # Duplicate check first: re-adding at the cap is a harmless 200, not a 400
            if existing:
                return (existing["ticker"], existing["added_at"]), False
            (count,) = conn.execute(
                "SELECT COUNT(*) FROM watchlist WHERE user_id = ?", (DEFAULT_USER_ID,)
            ).fetchone()
            if count >= WATCHLIST_CAP:
                raise DomainError(
                    f"Watchlist is full ({WATCHLIST_CAP} tickers). "
                    "Remove one before adding another."
                )
            added_at = now_iso()
            conn.execute(
                "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, added_at),
            )
            return (ticker, added_at), True

    def _remove_tx(self, ticker: str) -> bool:
        with self._db.transaction() as conn:
            cur = conn.execute(
                "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
                (DEFAULT_USER_ID, ticker),
            )
            return cur.rowcount > 0

    def _load_rows(self) -> list[tuple[str, str]]:
        with closing(self._db.connect()) as conn:
            rows: list[sqlite3.Row] = conn.execute(
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
