"""Tests for portfolio valuation, the snapshot recorder and the 30-second loop (OPS-01)."""

import asyncio
import logging
import re
import sqlite3
import uuid
from contextlib import closing

import pytest

from app.db import Database, now_iso
from app.market import PriceCache
from app.snapshots import SNAPSHOT_INTERVAL, SnapshotRecorder, portfolio_value, run_snapshot_loop

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def snapshot_rows(db: Database) -> list[tuple]:
    with closing(sqlite3.connect(db.path)) as conn:
        return conn.execute(
            "SELECT id, user_id, total_value, recorded_at FROM portfolio_snapshots ORDER BY rowid"
        ).fetchall()


@pytest.fixture
def db(tmp_path) -> Database:
    database = Database(str(tmp_path / "t.db"))
    database.init()
    return database


class TestPortfolioValue:
    def test_cash_only(self):
        assert portfolio_value(10000.0, [], lambda t: None) == 10000.0

    def test_position_at_cached_price(self):
        assert portfolio_value(10000.0, [("AAPL", 2, 100.0)], lambda t: 150.0) == 10300.0

    def test_uncached_ticker_falls_back_to_avg_cost(self):
        prices = {"AAPL": 150.0}
        positions = [("AAPL", 2, 100.0), ("PYPL", 3, 60.0)]
        assert portfolio_value(1000.0, positions, prices.get) == 1000.0 + 300.0 + 180.0

    def test_rounded_to_two_decimals(self):
        assert portfolio_value(0.1, [("X", 0.3333, 3.0)], lambda t: None) == 1.1

    def test_interval_is_thirty_seconds(self):
        assert SNAPSHOT_INTERVAL == 30.0


class TestRecorder:
    async def test_fresh_db_records_cash(self, db):
        recorder = SnapshotRecorder(db, PriceCache(), asyncio.Lock())
        assert await recorder.record() == 10000.0
        rows = snapshot_rows(db)
        assert len(rows) == 1
        row_id, user_id, total, recorded_at = rows[0]
        assert uuid.UUID(row_id)
        assert user_id == "default"
        assert total == 10000.0
        assert ISO_RE.match(recorded_at)

    async def test_values_positions_from_cache(self, db):
        with closing(sqlite3.connect(db.path)) as conn:
            conn.execute(
                "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at) "
                "VALUES ('p1', 'AAPL', 2, 100.0, ?)",
                (now_iso(),),
            )
            conn.commit()
        cache = PriceCache()
        cache.update("AAPL", 150.0)
        assert await SnapshotRecorder(db, cache, asyncio.Lock()).record() == 10300.0

    async def test_waits_for_state_lock(self, db):
        lock = asyncio.Lock()
        recorder = SnapshotRecorder(db, PriceCache(), lock)
        async with lock:
            task = asyncio.create_task(recorder.record())
            await asyncio.sleep(0.05)
            assert not task.done()
            assert snapshot_rows(db) == []
        await task
        assert len(snapshot_rows(db)) == 1


class FlakyRecorder:
    """Raises on its first call, then counts successful records."""

    def __init__(self) -> None:
        self.calls = 0
        self.recorded = 0

    async def record(self) -> float:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("boom")
        self.recorded += 1
        return 0.0


class TestLoop:
    async def test_records_every_interval(self, db):
        recorder = SnapshotRecorder(db, PriceCache(), asyncio.Lock())
        task = asyncio.create_task(run_snapshot_loop(recorder, interval=0.01))
        await asyncio.sleep(0.2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(snapshot_rows(db)) >= 2

    async def test_failure_is_logged_and_loop_continues(self, caplog):
        recorder = FlakyRecorder()
        with caplog.at_level(logging.ERROR, logger="app.snapshots"):
            task = asyncio.create_task(run_snapshot_loop(recorder, interval=0.01))
            await asyncio.sleep(0.15)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        assert recorder.recorded >= 1
        failures = [r for r in caplog.records if r.getMessage() == "Snapshot failed"]
        assert len(failures) == 1
        assert failures[0].exc_info is not None

    async def test_cancel_ends_loop(self):
        task = asyncio.create_task(run_snapshot_loop(FlakyRecorder(), interval=3600))
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert task.cancelled()
