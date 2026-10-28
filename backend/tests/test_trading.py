"""Tests for TradeService: every PLAN §7 trade rule, cent-exact money, atomic
rejections, snapshots and tracked tickers per fill, and the parallel-buy race."""

import asyncio
import logging
import math
import sqlite3
import uuid
from contextlib import closing
from decimal import ROUND_FLOOR, Decimal

import pytest

from app import trading
from app.errors import DomainError
from app.trading import DUST, TradeResult
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


def position(db_path: str, ticker: str) -> tuple | None:
    rows = run_sql(
        db_path, "SELECT quantity, avg_cost FROM positions WHERE ticker = ?", (ticker.upper(),)
    )
    return rows[0] if rows else None


def state(db_path: str) -> tuple:
    """Everything a trade may change: cash, positions, trades and snapshots."""
    return (
        cash(db_path),
        run_sql(db_path, "SELECT ticker, quantity, avg_cost FROM positions ORDER BY rowid"),
        run_sql(db_path, "SELECT id FROM trades ORDER BY rowid"),
        run_sql(db_path, "SELECT id FROM portfolio_snapshots ORDER BY rowid"),
    )


async def rejected(env, ticker, quantity, side) -> str:
    """Run a trade that must fail; assert it changed nothing and return the message."""
    before = state(env.db.path)
    added, removed = list(env.source.added), list(env.source.removed)
    with pytest.raises(DomainError) as exc_info:
        await bounded(env.trades.execute(ticker, quantity, side))
    assert state(env.db.path) == before
    assert env.source.added == added and env.source.removed == removed
    return exc_info.value.message


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


POSITIVE = "Quantity must be a positive number."


class TestValidation:
    @pytest.mark.parametrize(
        "quantity",
        [math.nan, math.inf, -math.inf, float("1e400"), 0, 0.0, -1, -0.5],
        ids=["nan", "inf", "-inf", "1e400", "zero", "zero-float", "minus-one", "minus-half"],
    )
    async def test_non_finite_or_non_positive_quantity(self, trade_env, quantity):
        trade_env.price("AAPL", 190.0)
        assert await rejected(trade_env, "AAPL", quantity, "buy") == POSITIVE
        assert await rejected(trade_env, "AAPL", quantity, "sell") == POSITIVE

    async def test_quantity_rounding_to_zero(self, trade_env):
        trade_env.price("AAPL", 190.0)
        message = await rejected(trade_env, "AAPL", 0.00004, "buy")
        assert message == "Quantity must be at least 0.0001."

    async def test_quantity_half_up_to_minimum_fills(self, trade_env):
        trade_env.price("AAPL", 190.0)
        result = await bounded(trade_env.trades.execute("AAPL", 0.00005, "buy"))
        assert result.trade.quantity == 0.0001
        assert position(trade_env.db.path, "AAPL")[0] == 0.0001

    async def test_quantity_rounds_half_up_to_four_places(self, trade_env):
        trade_env.price("AAPL", 10.0)
        result = await bounded(trade_env.trades.execute("AAPL", 1.23455, "buy"))
        assert result.trade.quantity == 1.2346
        assert cash(trade_env.db.path) == 9987.65  # 1.2346 x 10.00 = 12.346 -> 12.35

    async def test_bad_side(self, trade_env):
        trade_env.price("AAPL", 190.0)
        assert await rejected(trade_env, "AAPL", 1, "hold") == "Side must be 'buy' or 'sell'."

    async def test_side_is_trimmed_and_case_insensitive(self, trade_env):
        trade_env.price("AAPL", 100.0)
        bought = await bounded(trade_env.trades.execute("AAPL", 2, " buy "))
        sold = await bounded(trade_env.trades.execute("AAPL", 1, "SELL"))
        assert (bought.trade.side, sold.trade.side) == ("buy", "sell")

    async def test_malformed_ticker(self, trade_env):
        message = await rejected(trade_env, "aapl!", 1, "buy")
        assert message.startswith("Invalid ticker 'AAPL!'")

    async def test_check_order_is_ticker_side_quantity(self, trade_env):
        assert (await rejected(trade_env, "aapl!", math.nan, "hold")).startswith("Invalid ticker")
        assert await rejected(trade_env, "AAPL", math.nan, "hold") == (
            "Side must be 'buy' or 'sell'."
        )
        # Quantity is checked before the price: an unpriced ticker still reports quantity
        assert await rejected(trade_env, "ZZZZ", math.nan, "buy") == POSITIVE

    async def test_ticker_is_normalized(self, trade_env):
        trade_env.price("AAPL", 100.0)
        result = await bounded(trade_env.trades.execute("  aapl ", 1, "buy"))
        assert result.trade.ticker == "AAPL"

    async def test_no_price_available(self, trade_env):
        message = await rejected(trade_env, "ZZZZ", 1, "buy")
        assert message == "No price available for ZZZZ. Add it to your watchlist first."


class TestBuy:
    async def test_cost_above_cash_is_rejected(self, trade_env):
        trade_env.price("AAPL", 10000.01)
        message = await rejected(trade_env, "AAPL", 1, "buy")
        assert message == "Insufficient cash (need $10,000.01, have $10,000.00)."

    async def test_cost_equal_to_cash_succeeds(self, trade_env):
        trade_env.price("AAPL", 10000.0)
        await bounded(trade_env.trades.execute("AAPL", 1, "buy"))
        assert cash(trade_env.db.path) == 0.0

    async def test_buy_max_always_succeeds(self, trade_env):
        trade_env.price("AAPL", 190.52)
        qty = float((Decimal("10000") / Decimal("190.52")).quantize(Decimal("0.0001"), ROUND_FLOOR))
        result = await bounded(trade_env.trades.execute("AAPL", qty, "buy"))
        assert result.trade.quantity == qty == 52.4879
        assert 0.0 <= cash(trade_env.db.path) < 190.52

    async def test_avg_cost_full_precision_stored_four_places_served(self, trade_env):
        trade_env.price("AAPL", 100.0)
        await bounded(trade_env.trades.execute("AAPL", 10, "buy"))
        trade_env.price("AAPL", 101.0)
        result = await bounded(trade_env.trades.execute("AAPL", 5, "buy"))
        quantity, stored_avg = position(trade_env.db.path, "AAPL")
        assert quantity == 15.0
        assert stored_avg == pytest.approx(1505 / 15, abs=1e-12)
        assert stored_avg != 100.3333
        assert result.portfolio["positions"][0]["avg_cost"] == 100.3333

    async def test_order_value_below_one_cent_is_rejected(self, trade_env):
        trade_env.price("AAPL", 10.0)
        message = await rejected(trade_env, "AAPL", 0.0001, "buy")
        assert message == "Order value must be at least $0.01."
        assert trading.MIN_ORDER_VALUE == 0.01

    async def test_half_cent_notional_debits_rounded_up(self, trade_env):
        trade_env.price("AAPL", 250.0)
        await bounded(trade_env.trades.execute("AAPL", 0.0005, "buy"))
        assert cash(trade_env.db.path) == 9999.87  # 0.125 -> 0.13

    async def test_fill_price_comes_from_the_cache(self, trade_env):
        trade_env.price("AAPL", 190.52)
        result = await bounded(trade_env.trades.execute("AAPL", 10, "buy"))
        assert result.trade.price == 190.52
        assert cash(trade_env.db.path) == 8094.8

    async def test_top_up_keeps_first_purchase_order(self, trade_env):
        trade_env.price("AAPL", 100.0)
        trade_env.price("MSFT", 400.0)
        await bounded(trade_env.trades.execute("AAPL", 1, "buy"))
        await bounded(trade_env.trades.execute("MSFT", 1, "buy"))
        result = await bounded(trade_env.trades.execute("AAPL", 1, "buy"))
        assert [p["ticker"] for p in result.portfolio["positions"]] == ["AAPL", "MSFT"]
        view = await bounded(trade_env.portfolio.view())
        assert [p["ticker"] for p in view["positions"]] == ["AAPL", "MSFT"]


class TestSell:
    async def test_sell_within_tolerance_closes_the_position(self, trade_env):
        trade_env.price("AAPL", 100.0)
        await bounded(trade_env.trades.execute("AAPL", 10, "buy"))
        result = await bounded(trade_env.trades.execute("AAPL", 10.000001, "sell"))
        assert result.trade.quantity == 10.0
        logged = run_sql(trade_env.db.path, "SELECT quantity FROM trades WHERE side = 'sell'")
        assert logged == [(10.0,)]
        assert position(trade_env.db.path, "AAPL") is None
        assert result.portfolio["positions"] == []
        assert cash(trade_env.db.path) == 10000.0
        assert DUST == 1e-6

    async def test_sell_beyond_holding_is_rejected(self, trade_env):
        trade_env.price("AAPL", 100.0)
        await bounded(trade_env.trades.execute("AAPL", 10, "buy"))
        message = await rejected(trade_env, "AAPL", 10.01, "sell")
        assert message == "Insufficient shares (need 10.01, have 10)."

    async def test_partial_sell_keeps_avg_cost(self, trade_env):
        trade_env.price("AAPL", 100.0)
        await bounded(trade_env.trades.execute("AAPL", 10, "buy"))
        trade_env.price("AAPL", 101.0)
        await bounded(trade_env.trades.execute("AAPL", 5, "buy"))
        _, avg_before = position(trade_env.db.path, "AAPL")
        trade_env.price("AAPL", 120.0)
        await bounded(trade_env.trades.execute("AAPL", 4, "sell"))
        assert position(trade_env.db.path, "AAPL") == (11.0, avg_before)

    async def test_selling_at_a_loss(self, trade_env):
        trade_env.price("AAPL", 200.0)
        await bounded(trade_env.trades.execute("AAPL", 10, "buy"))
        trade_env.price("AAPL", 150.0)
        await bounded(trade_env.trades.execute("AAPL", 10, "sell"))
        assert cash(trade_env.db.path) == 9500.0
        assert position(trade_env.db.path, "AAPL") is None

    async def test_selling_a_ticker_never_held(self, trade_env):
        trade_env.price("AAPL", 100.0)
        message = await rejected(trade_env, "AAPL", 1, "sell")
        assert message == "Insufficient shares (need 1, have 0)."

    async def test_tiny_sell_with_zero_proceeds_is_allowed(self, trade_env):
        # Sells have no minimum order value, so a tiny remainder can always be closed
        trade_env.price("AAPL", 10.0)
        await bounded(trade_env.trades.execute("AAPL", 1.0001, "buy"))
        await bounded(trade_env.trades.execute("AAPL", 0.0001, "sell"))
        assert position(trade_env.db.path, "AAPL")[0] == 1.0


class TestRounding:
    async def test_hundred_small_buys_stay_cent_exact(self, trade_env):
        trade_env.price("AAPL", 33.33)
        for _ in range(100):
            await bounded(trade_env.trades.execute("AAPL", 0.1, "buy"))
        assert cash(trade_env.db.path) == 9667.0
        assert position(trade_env.db.path, "AAPL")[0] == 10.0

    async def test_quantities_sum_without_float_noise(self, trade_env):
        trade_env.price("AAPL", 100.0)
        await bounded(trade_env.trades.execute("AAPL", 0.1, "buy"))
        await bounded(trade_env.trades.execute("AAPL", 0.2, "buy"))
        assert position(trade_env.db.path, "AAPL")[0] == 0.3


class TestAtomicity:
    async def test_every_rejection_changes_nothing(self, trade_env):
        env = trade_env
        env.price("AAPL", 100.0)
        env.price("PYPL", 10.0)
        await bounded(env.trades.execute("AAPL", 1, "buy"))
        cases = [
            ("AAPL", 1000, "buy"),  # insufficient cash
            ("AAPL", 2, "sell"),  # insufficient shares
            ("PYPL", 1, "sell"),  # never held, unwatched
            ("ZZZZ", 1, "buy"),  # no price
            ("bad!", 1, "buy"),  # malformed ticker
            ("AAPL", 1, "hold"),  # bad side
            ("AAPL", math.nan, "buy"),
            ("AAPL", 0, "buy"),
            ("AAPL", 0.00004, "buy"),
            ("AAPL", 0.00001, "sell"),
            ("PYPL", 0.0001, "buy"),  # order value below one cent
        ]
        for ticker, quantity, side in cases:
            await rejected(env, ticker, quantity, side)
        assert env.source.added == [] and env.source.removed == []

    async def test_every_fill_adds_exactly_one_trade_row(self, trade_env):
        env = trade_env
        env.price("AAPL", 100.0)
        for n, (quantity, side) in enumerate([(3, "buy"), (1, "sell"), (2, "sell")], start=1):
            await bounded(env.trades.execute("AAPL", quantity, side))
            assert len(run_sql(env.db.path, "SELECT id FROM trades")) == n
            assert len(snapshots(env.db.path)) == n


class TestConcurrency:
    async def test_concurrent_buys_never_overspend(self, trade_env):
        env = trade_env
        env.price("AAPL", 600.0)
        results = await asyncio.wait_for(
            asyncio.gather(
                *(env.trades.execute("AAPL", 1, "buy") for _ in range(20)),
                return_exceptions=True,
            ),
            timeout=TIMEOUT,
        )
        fills = [r for r in results if isinstance(r, TradeResult)]
        errors = [r for r in results if isinstance(r, DomainError)]
        assert len(fills) == 16 and len(errors) == 4
        assert all(e.message.startswith("Insufficient cash") for e in errors)
        assert cash(env.db.path) == 400.0
        assert len(run_sql(env.db.path, "SELECT id FROM trades")) == 16
        assert len(snapshots(env.db.path)) == 16
        assert position(env.db.path, "AAPL")[0] == 16.0
