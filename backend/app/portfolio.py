"""Portfolio read view in the PLAN §8 shape, the trade list, the snapshot history and reset."""

from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import closing

from .db import DEFAULT_CASH, DEFAULT_USER_ID, DEFAULT_WATCHLIST, Database, now_iso
from .market import PriceCache
from .snapshots import insert_snapshot
from .tracker import TickerTracker
from .valuation import value_portfolio

logger = logging.getLogger(__name__)

TRADES_LIMIT = 100  # GET /api/trades returns at most this many rows, newest first
# Reset deletes these tables' rows (fixed names, never user input), then restores the watchlist.
RESET_TABLES = ("positions", "trades", "portfolio_snapshots", "chat_messages", "watchlist")


class PortfolioService:
    """Reads cash and positions and values them against the shared PriceCache.

    Reset takes the shared state lock and re-syncs tracked tickers through the
    tracker; the read views need no lock.
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

    async def history(self) -> list[dict]:
        """Every portfolio snapshot, oldest first (GET /api/portfolio/history)."""
        return await asyncio.to_thread(self._load_history)

    def _load_history(self) -> list[dict]:
        """Blocking read. One SELECT is atomic, so a concurrent trade's snapshot is either
        fully present or absent; rowid keeps snapshots in the same second in insertion order."""
        with closing(self._db.connect()) as conn:
            return [
                {"total_value": row["total_value"], "recorded_at": row["recorded_at"]}
                for row in conn.execute(
                    "SELECT total_value, recorded_at FROM portfolio_snapshots "
                    "WHERE user_id = ? ORDER BY recorded_at, rowid",
                    (DEFAULT_USER_ID,),
                )
            ]

    async def reset(self) -> None:
        """Restore the seeded account (POST /api/reset, PLAN §8).

        Runs under the shared state lock, like trades and watchlist edits, so it never
        interleaves with them. After the transaction commits, the market source is
        reconciled to the default watchlist (WL-06).
        """
        async with self._lock:
            await asyncio.to_thread(self._reset_tx)
            await self._tracker.reconcile_quietly("reset")
        logger.info("Reset: account restored to defaults")

    def _reset_tx(self) -> None:
        """One BEGIN IMMEDIATE transaction: cash, five tables, default watchlist, snapshot.

        The seed helper is not reused (it inserts the watchlist only for a new user), no
        script runner is used (it commits implicitly), and the snapshot is written with
        insert_snapshot, not SnapshotRecorder (which takes the lock this caller holds).
        """
        now = now_iso()
        with self._db.transaction() as conn:
            conn.execute(
                "INSERT INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET cash_balance = excluded.cash_balance",
                (DEFAULT_USER_ID, DEFAULT_CASH, now),
            )
            for table in RESET_TABLES:
                conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (DEFAULT_USER_ID,))
            # One shared added_at; rowid keeps the default order.
            conn.executemany(
                "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
                [(str(uuid.uuid4()), DEFAULT_USER_ID, t, now) for t in DEFAULT_WATCHLIST],
            )
            insert_snapshot(conn, self._cache)  # the fresh P&L starting point (PF-02)
