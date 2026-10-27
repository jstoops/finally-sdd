"""Portfolio valuation and snapshots for the P&L chart (PLAN §7 portfolio_snapshots).

A snapshot is recorded at startup, then every SNAPSHOT_INTERVAL seconds by a
background task (and, from Phase 2, after each trade and after a reset).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Callable, Iterable

from .db import DEFAULT_USER_ID, Database, now_iso
from .market import PriceCache

logger = logging.getLogger(__name__)

SNAPSHOT_INTERVAL = 30.0  # seconds (PLAN section 7)


def portfolio_value(
    cash: float,
    positions: Iterable[tuple[str, float, float]],
    price_of: Callable[[str], float | None],
) -> float:
    """Cash plus each `(ticker, quantity, avg_cost)` at its cached price, rounded to 2 dp.

    A ticker with no cached price is valued at its average cost (PLAN §8).
    """
    total = cash
    for ticker, quantity, avg_cost in positions:
        price = price_of(ticker)
        total += quantity * (price if price is not None else avg_cost)
    return round(total, 2)


class SnapshotRecorder:
    """Values the portfolio and inserts one portfolio_snapshots row per call.

    Takes the shared state lock, so a snapshot never sees a half-applied mutation.
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
            (cash,) = conn.execute(
                "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
            ).fetchone()
            positions = [
                (row["ticker"], row["quantity"], row["avg_cost"])
                for row in conn.execute(
                    "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ?",
                    (DEFAULT_USER_ID,),
                )
            ]
            value = portfolio_value(cash, positions, self._cache.get_price)
            conn.execute(
                "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
                "VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), DEFAULT_USER_ID, value, now_iso()),
            )
        return value


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
