"""Tests for TickerTracker: tracked tickers = watchlist ∪ held positions (PLAN §6)."""

import sqlite3
import threading
from contextlib import closing

import pytest

from app.db import DEFAULT_WATCHLIST, Database, now_iso
from app.tracker import TickerTracker


def run_sql(db: Database, sql: str, params: tuple = ()) -> None:
    with closing(sqlite3.connect(db.path)) as conn:
        conn.execute(sql, params)
        conn.commit()


@pytest.fixture
def db(tmp_path) -> Database:
    database = Database(str(tmp_path / "t.db"))
    database.init()
    return database


class TestReconcile:
    async def test_adds_missing_and_removes_extra(self, db, recording_source):
        source = recording_source()
        await source.start(["AAPL", "MSFT", "XYZ"])
        await TickerTracker(db, source).reconcile()
        assert source.added == sorted(set(DEFAULT_WATCHLIST) - {"AAPL", "MSFT"})
        assert source.removed == ["XYZ"]
        assert set(source.get_tickers()) == set(DEFAULT_WATCHLIST)

    async def test_second_reconcile_makes_no_calls(self, db, recording_source):
        source = recording_source()
        await source.start([])
        tracker = TickerTracker(db, source)
        await tracker.reconcile()
        calls = (list(source.added), list(source.removed))
        await tracker.reconcile()
        assert (source.added, source.removed) == calls

    async def test_held_ticker_stays_tracked_after_leaving_watchlist(self, db, recording_source):
        source = recording_source()
        await source.start(list(DEFAULT_WATCHLIST))
        tracker = TickerTracker(db, source)
        run_sql(
            db,
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at) "
            "VALUES ('p1', 'TSLA', 3, 250.0, ?)",
            (now_iso(),),
        )
        run_sql(db, "DELETE FROM watchlist WHERE ticker = 'TSLA'")
        await tracker.reconcile()
        assert "TSLA" in source.get_tickers()
        assert source.removed == []

        run_sql(db, "DELETE FROM positions WHERE ticker = 'TSLA'")
        await tracker.reconcile()
        assert "TSLA" not in source.get_tickers()
        assert source.removed == ["TSLA"]

    async def test_held_unwatched_ticker_is_added(self, db, recording_source):
        source = recording_source()
        await source.start(list(DEFAULT_WATCHLIST))
        run_sql(
            db,
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at) "
            "VALUES ('p1', 'PYPL', 1, 60.0, ?)",
            (now_iso(),),
        )
        await TickerTracker(db, source).reconcile()
        assert source.added == ["PYPL"]

    async def test_source_calls_run_on_event_loop_thread(self, db, recording_source):
        source = recording_source()
        await source.start(["XYZ"])
        await TickerTracker(db, source).reconcile()
        assert source.call_threads == {threading.get_ident()}
