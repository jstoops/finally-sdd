"""Portfolio valuation and snapshots for the P&L chart (PLAN §7 portfolio_snapshots).

A snapshot is recorded at startup, every SNAPSHOT_INTERVAL seconds by a background
task, after each trade and after a reset. Every snapshot values the portfolio with
`value_portfolio`, the same function as GET /api/portfolio, so they never differ.

Trades and reset call `insert_snapshot` on their own open transaction, while they
already hold the shared state lock. `SnapshotRecorder` takes that lock itself and
serves only the lifespan startup snapshot and the 30-second loop: `asyncio.Lock` is
not reentrant, so calling the recorder from a lock holder would deadlock.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import uuid
from collections.abc import Callable, Iterable

from .db import DEFAULT_USER_ID, Database, now_iso
from .market import PriceCache
from .valuation import value_portfolio

logger = logging.getLogger(__name__)

SNAPSHOT_INTERVAL = 30.0  # seconds (PLAN section 7)


def portfolio_value(
    cash: float,
    positions: Iterable[tuple[str, float, float]],
    price_of: Callable[[str], float | None],
) -> float:
    """Cash plus each `(ticker, quantity, avg_cost)` at its cached price, in cents.

    Delegates to `value_portfolio`, so an uncached ticker is valued at its served
    avg_cost (PLAN §8) and money is rounded half-up exactly as the API serves it.
    """
    return value_portfolio(cash, positions, price_of)["total_value"]


def insert_snapshot(conn: sqlite3.Connection, cache: PriceCache) -> float:
    """Value the portfolio on `conn` and insert one portfolio_snapshots row.

    Runs on the caller's open transaction and takes no lock, so a trade or reset
    writes its snapshot atomically with its own changes. Returns the value stored.
    """
    (cash,) = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    ).fetchone()
    positions = [
        (row["ticker"], row["quantity"], row["avg_cost"])
        for row in conn.execute(
            "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ? ORDER BY rowid",
            (DEFAULT_USER_ID,),
        )
    ]
    value = portfolio_value(cash, positions, cache.get_price)
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, value, now_iso()),
    )
    return value


class SnapshotRecorder:
    """Records one snapshot per call under the shared state lock.

    For lifespan startup and the 30-second loop only; lock holders (trades, reset)
    call `insert_snapshot` inside their own transaction instead.
    """

    def __init__(self, db: Database, cache: PriceCache, lock: asyncio.Lock) -> None:
        self._db = db
        self._cache = cache
        self._lock = lock

    async def record(self) -> float:
        """Insert a snapshot of the current total value and return that value."""
        async with self._lock:
            return await asyncio.to_thread(self._record_tx)

    def _record_tx(self) -> float:
        with self._db.transaction() as conn:
            return insert_snapshot(conn, self._cache)


async def run_snapshot_loop(
    recorder: SnapshotRecorder, interval: float = SNAPSHOT_INTERVAL
) -> None:
    """Record a snapshot every `interval` seconds until cancelled.

    A failing iteration is logged and the loop keeps running. CancelledError is
    not caught, so cancelling the task ends the loop.
    """
    while True:
        await asyncio.sleep(interval)
        try:
            await recorder.record()
        except Exception:
            logger.exception("Snapshot failed")
