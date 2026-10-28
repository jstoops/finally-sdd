"""Tests for TradeService: snapshots and tracked tickers per fill (PLAN §6, §7)."""

import asyncio
import logging
import sqlite3
import uuid
from contextlib import closing

import pytest

from app.errors import DomainError
from app.valuation import value_portfolio

TIMEOUT = 5  # every service await is bounded, so a lock re-entry deadlock fails fast


def run_sql(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(db_path)) as conn:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()
    return rows


async def bounded(coro):
    return await asyncio.wait_for(coro, timeout=TIMEOUT)


def snapshots(db_path: str) -> list[tuple]:
    return run_sql(
        db_path, "SELECT id, total_value, recorded_at FROM portfolio_snapshots ORDER BY rowid"
    )


def cash(db_path: str) -> float:
    return run_sql(db_path, "SELECT cash_balance FROM users_profile WHERE id = 'default'")[0][0]


def valued_total(env) -> float:
    """value_portfolio's total for the committed state at the current cache prices."""
    positions = run_sql(
        env.db.path, "SELECT ticker, quantity, avg_cost FROM positions ORDER BY rowid"
    )
    return value_portfolio(cash(env.db.path), positions, env.cache.get_price)["total_value"]


class TestSnapshot:
    async def test_each_fill_adds_one_snapshot_matching_valuation(self, trade_env):
        env = trade_env
        env.price("AAPL", 190.52)
        await bounded(env.trades.execute("AAPL", 10, "buy"))
        rows = snapshots(env.db.path)
        assert len(rows) == 1
        assert rows[-1][1] == valued_total(env) == 10000.0

        env.price("AAPL", 200.00)
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        rows = snapshots(env.db.path)
        assert len(rows) == 2
        # cash 10000 - 1905.20 - 200.00 = 7894.80, plus 11 x 200.00
        assert rows[-1][1] == valued_total(env) == 10094.8

    async def test_sell_adds_one_snapshot(self, trade_env):
        env = trade_env
        env.price("AAPL", 100.0)
        await bounded(env.trades.execute("AAPL", 2, "buy"))
        env.price("AAPL", 110.0)
        await bounded(env.trades.execute("AAPL", 1, "sell"))
        rows = snapshots(env.db.path)
        assert len(rows) == 2
        assert rows[-1][1] == valued_total(env) == 10020.0

    async def test_two_fills_in_one_second_store_two_rows_each(self, trade_env, monkeypatch):
        monkeypatch.setattr("app.trading.now_iso", lambda: "2026-10-09T14:03:22Z")
        monkeypatch.setattr("app.snapshots.now_iso", lambda: "2026-10-09T14:03:22Z")
        env = trade_env
        env.price("AAPL", 190.52)
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        trades = run_sql(env.db.path, "SELECT id, executed_at FROM trades")
        rows = snapshots(env.db.path)
        assert len(trades) == 2 and len(rows) == 2
        assert len({t[0] for t in trades}) == 2
        assert len({r[0] for r in rows}) == 2
        assert all(uuid.UUID(r[0]) for r in rows)
        assert {r[2] for r in rows} == {"2026-10-09T14:03:22Z"}

    async def test_rejected_trade_adds_no_snapshot(self, trade_env):
        env = trade_env
        with pytest.raises(DomainError):
            await bounded(env.trades.execute("ZZZZ", 1, "buy"))
        assert snapshots(env.db.path) == []


class TestTracked:
    async def test_buying_unwatched_ticker_tracks_it(self, trade_env):
        env = trade_env
        env.price("PYPL", 70.0)
        await bounded(env.trades.execute("PYPL", 1, "buy"))
        assert "PYPL" in env.source.get_tickers()
        assert env.source.added == ["PYPL"]

    async def test_removing_held_ticker_from_watchlist_keeps_it_tracked(self, trade_env):
        env = trade_env
        env.price("AAPL", 190.0)
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        await bounded(env.watchlist.remove("AAPL"))
        assert "AAPL" in env.source.get_tickers()
        assert "AAPL" not in env.source.removed

    async def test_selling_unwatched_ticker_to_zero_stops_tracking_it(self, trade_env):
        env = trade_env
        env.price("PYPL", 70.0)
        await bounded(env.trades.execute("PYPL", 2, "buy"))
        await bounded(env.trades.execute("PYPL", 2, "sell"))
        assert env.source.removed == ["PYPL"]
        assert "PYPL" not in env.source.get_tickers()

    async def test_selling_watched_ticker_to_zero_keeps_it_tracked(self, trade_env):
        env = trade_env
        env.price("AAPL", 190.0)
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        await bounded(env.trades.execute("AAPL", 1, "sell"))
        assert "AAPL" in env.source.get_tickers()
        assert env.source.removed == []

    async def test_watched_and_held_ticker_is_tracked_once(self, trade_env):
        env = trade_env
        env.price("AAPL", 190.0)
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        assert env.source.get_tickers().count("AAPL") == 1
        assert env.source.added == []

    async def test_failed_reconcile_after_sell_still_returns_the_fill(self, trade_env, caplog):
        env = trade_env
        env.price("PYPL", 70.0)
        await bounded(env.trades.execute("PYPL", 1, "buy"))
        real_remove = env.source.remove_ticker
        calls = []

        async def failing_remove(ticker):
            calls.append(ticker)
            if len(calls) == 1:
                raise RuntimeError("remove_ticker boom")
            await real_remove(ticker)

        env.source.remove_ticker = failing_remove
        with caplog.at_level(logging.ERROR, logger="app.tracker"):
            result = await bounded(env.trades.execute("PYPL", 1, "sell"))
        assert result.trade.side == "sell" and result.trade.quantity == 1.0
        assert result.portfolio["positions"] == []
        failures = [
            r
            for r in caplog.records
            if r.getMessage() == "Tracker: reconcile failed after sell PYPL"
        ]
        assert len(failures) == 1 and failures[0].exc_info is not None
        assert len(run_sql(env.db.path, "SELECT id FROM trades")) == 2
        assert "PYPL" in env.source.get_tickers()  # stale until the next reconcile
