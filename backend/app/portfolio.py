"""Portfolio read view in the PLAN §8 shape (trade list, history and reset arrive later)."""

from __future__ import annotations

import asyncio
from contextlib import closing

from .db import DEFAULT_USER_ID, Database
from .market import PriceCache
from .tracker import TickerTracker
from .valuation import value_portfolio


class PortfolioService:
    """Reads cash and positions and values them against the shared PriceCache.

    The tracker and the shared state lock are stored for the trade list (02-05),
    history and reset (02-06); the read view itself needs no lock.
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

    async def view(self) -> dict:
        """The current portfolio (GET /api/portfolio)."""
        return await asyncio.to_thread(self.view_sync)

    def view_sync(self) -> dict:
        """Blocking view. Cash and positions are read in one deferred read transaction,
        so a concurrent trade yields the before or the after state, never a mix."""
        with closing(self._db.connect()) as conn:
            conn.execute("BEGIN")
            try:
                (cash,) = conn.execute(
                    "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
                ).fetchone()
                rows = [
                    (row["ticker"], row["quantity"], row["avg_cost"])
                    for row in conn.execute(
                        "SELECT ticker, quantity, avg_cost FROM positions "
                        "WHERE user_id = ? ORDER BY rowid",
                        (DEFAULT_USER_ID,),
                    )
                ]
            finally:
                conn.execute("COMMIT")
        return value_portfolio(cash, rows, self._cache.get_price)
