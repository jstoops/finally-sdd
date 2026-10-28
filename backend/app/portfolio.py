"""Portfolio read view in the PLAN §8 shape and the trade list (history and reset arrive later)."""

from __future__ import annotations

import asyncio
from contextlib import closing

from .db import DEFAULT_USER_ID, Database
from .market import PriceCache
from .tracker import TickerTracker
from .valuation import value_portfolio

TRADES_LIMIT = 100  # GET /api/trades returns at most this many rows, newest first


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

    async def list_trades(self, limit: int = TRADES_LIMIT) -> list[dict]:
        """The most recent trades, newest first (GET /api/trades)."""
        return await asyncio.to_thread(self._load_trades, limit)

    def _load_trades(self, limit: int) -> list[dict]:
        """Blocking read. rowid breaks ties so trades in the same second keep execution order."""
        with closing(self._db.connect()) as conn:
            return [
                {
                    "id": row["id"],
                    "ticker": row["ticker"],
                    "side": row["side"],
                    "quantity": row["quantity"],
                    "price": row["price"],
                    "executed_at": row["executed_at"],
                }
                for row in conn.execute(
                    "SELECT id, ticker, side, quantity, price, executed_at FROM trades "
                    "WHERE user_id = ? ORDER BY executed_at DESC, rowid DESC LIMIT ?",
                    (DEFAULT_USER_ID, limit),
                )
            ]
