"""Tracked-ticker reconcile: the market source prices watchlist ∪ held positions (PLAN §6).

This is the only module outside `app/market` that calls `source.add_ticker` or
`source.remove_ticker`, so a held ticker is never removed from pricing.
"""

from __future__ import annotations

import asyncio
import logging

from .db import Database
from .market import MarketDataSource

logger = logging.getLogger(__name__)


class TickerTracker:
    """Brings the source's ticker set in line with the database.

    Callers hold the shared state lock, so reconciles never interleave.
    """

    def __init__(self, db: Database, source: MarketDataSource) -> None:
        self._db = db
        self._source = source

    async def reconcile(self) -> None:
        """Add desired tickers the source lacks; remove ones neither watched nor held."""
        desired = set(await asyncio.to_thread(self._db.tracked_tickers))
        current = set(self._source.get_tickers())
        # Source calls stay on the event loop: the simulator is not thread-safe.
        for ticker in sorted(desired - current):
            await self._source.add_ticker(ticker)
            logger.info("Tracker: added %s", ticker)
        for ticker in sorted(current - desired):
            await self._source.remove_ticker(ticker)
            logger.info("Tracker: removed %s", ticker)

    async def reconcile_quietly(self, context: str) -> None:
        """Reconcile after a committed change, logging instead of raising on failure.

        The database change has already committed, so a source error must not turn
        it into a failed request. The next reconcile repairs the source's ticker set.
        `context` names the change for the log, e.g. "adding PYPL" or "sell PYPL".
        """
        try:
            await self.reconcile()
        except Exception:
            logger.exception("Tracker: reconcile failed after %s", context)
