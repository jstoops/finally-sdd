"""Tests for the chat action executor: per-item validation, the 10 + 10 caps, idempotent
adds, watchlist-first order, independent execution and the templated failure notes."""

import asyncio
import sqlite3
from contextlib import closing

import pytest

from app.chat.actions import (
    MAX_TRADES,
    MAX_WATCHLIST_CHANGES,
    ActionOutcome,
    execute_actions,
    failure_reason,
)
from app.chat.parsing import ParsedReply
from app.errors import NotFoundError
from app.trading import Trade, TradeResult

TIMEOUT = 5
WARN = "⚠️ "  # U+26A0 U+FE0F then a space


def run_sql(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(db_path)) as conn:
        return conn.execute(sql, params).fetchall()


def count(env, table: str, where: str = "", params: tuple = ()) -> int:
    sql = f"SELECT COUNT(*) FROM {table}" + (f" WHERE {where}" if where else "")
    return run_sql(env.db.path, sql, params)[0][0]


def cash(env) -> float:
    return run_sql(env.db.path, "SELECT cash_balance FROM users_profile")[0][0]


def reply(trades=None, watch=None, bad_lists=()) -> ParsedReply:
    return ParsedReply("Ok.", list(trades or []), list(watch or []), tuple(bad_lists))


def buy(ticker: str, quantity: float) -> dict:
    return {"ticker": ticker, "side": "buy", "quantity": quantity}


async def run(env, parsed: ParsedReply) -> ActionOutcome:
    return await asyncio.wait_for(execute_actions(parsed, env.watchlist, env.trades), TIMEOUT)


class TestCaps:
    def test_cap_constants(self):
        assert MAX_TRADES == 10
        assert MAX_WATCHLIST_CHANGES == 10

    async def test_cap_eleventh_trade_fails_and_never_runs(self, trade_env):
        trade_env.price("AAPL", 190.50)
        outcome = await run(trade_env, reply(trades=[buy("AAPL", 0.01)] * 11))
        records = outcome.actions["trades"]
        assert [r["status"] for r in records] == ["executed"] * 10 + ["failed"]
        assert "too many actions" in records[10]["error"].lower()
        assert records[10]["error"] == "Too many actions (at most 10 trades per reply)."
        assert count(trade_env, "trades") == 10
        assert outcome.notes == [
            f"{WARN}Couldn't buy 0.01 AAPL: too many actions (at most 10 trades per reply)."
        ]

    async def test_cap_eleventh_watchlist_change_fails(self, trade_env):
        tickers = [f"ZZ{i}" for i in range(11)]
        outcome = await run(
            trade_env, reply(watch=[{"ticker": t, "action": "add"} for t in tickers])
        )
        records = outcome.actions["watchlist_changes"]
        assert [r["status"] for r in records] == ["executed"] * 10 + ["failed"]
        assert records[10] == {
            "ticker": "ZZ10",
            "action": "add",
            "status": "failed",
            "error": "Too many actions (at most 10 watchlist changes per reply).",
        }
        assert count(trade_env, "watchlist", "ticker = 'ZZ10'") == 0
        assert count(trade_env, "watchlist", "ticker LIKE 'ZZ%'") == 10

    async def test_cap_counts_malformed_items_by_position(self, trade_env):
        trade_env.price("AAPL", 190.50)
        items = ["junk"] * 10 + [buy("AAPL", 1)]
        records = (await run(trade_env, reply(trades=items))).actions["trades"]
        assert records[10]["error"] == "Too many actions (at most 10 trades per reply)."
        assert count(trade_env, "trades") == 0


class TestIdempotent:
    async def test_idempotent_add_of_watched_ticker_is_executed(self, trade_env):
        outcome = await run(trade_env, reply(watch=[{"ticker": "aapl", "action": "add"}]))
        assert outcome.actions["watchlist_changes"] == [
            {"ticker": "AAPL", "action": "add", "status": "executed"}
        ]
        assert outcome.notes == []
        assert count(trade_env, "watchlist", "ticker = 'AAPL'") == 1

    async def test_idempotent_two_adds_in_one_reply(self, trade_env):
        add = {"ticker": "PYPL", "action": "add"}
        outcome = await run(trade_env, reply(watch=[add, add]))
        assert [r["status"] for r in outcome.actions["watchlist_changes"]] == [
            "executed",
            "executed",
        ]
        assert count(trade_env, "watchlist", "ticker = 'PYPL'") == 1

    async def test_idempotent_remove_of_unwatched_fails(self, trade_env):
        outcome = await run(trade_env, reply(watch=[{"ticker": "PYPL", "action": "remove"}]))
        assert outcome.actions["watchlist_changes"] == [
            {
                "ticker": "PYPL",
                "action": "remove",
                "status": "failed",
                "error": "PYPL is not on your watchlist",
            }
        ]
        assert outcome.notes == [
            f"{WARN}Couldn't remove PYPL from your watchlist: PYPL is not on your watchlist."
        ]


class TestNotes:
    async def test_note_plan_section_9_example_exactly(self, trade_env):
        trade_env.price("AAPL", 190.50)
        await trade_env.trades.execute("AAPL", 10, "buy")
        trade_env.price("TSLA", 249.00)
        outcome = await run(trade_env, reply(trades=[buy("TSLA", 50)]))
        assert outcome.notes == [
            "⚠️ Couldn't buy 50 TSLA: insufficient cash (need $12,450.00, have $8,095.00)."
        ]
        assert outcome.notes[0].startswith("⚠️")
        assert cash(trade_env) == 8095.0

    async def test_note_order_watchlist_first(self, trade_env):
        outcome = await run(
            trade_env,
            reply(
                trades=[{"ticker": "AAPL", "side": "sell", "quantity": 1}],
                watch=[{"ticker": "PYPL", "action": "remove"}],
            ),
        )
        assert outcome.notes == [
            f"{WARN}Couldn't remove PYPL from your watchlist: PYPL is not on your watchlist.",
            f"{WARN}Couldn't sell 1 AAPL: no price available for AAPL. "
            "Add it to your watchlist first.",
        ]

    async def test_note_generic_forms_for_malformed_items(self, trade_env):
        outcome = await run(
            trade_env,
            reply(trades=[{"ticker": "AAPL"}], watch=[{"ticker": 5, "action": "add"}]),
        )
        assert outcome.notes == [
            f"{WARN}Couldn't run a requested watchlist change: "
            "invalid watchlist change (expected ticker and action).",
            f"{WARN}Couldn't run a requested trade: "
            "invalid trade (expected ticker, side and quantity).",
        ]

    async def test_note_bad_lists(self, trade_env):
        outcome = await run(trade_env, reply(bad_lists=("trades", "watchlist_changes")))
        assert outcome.actions == {
            "trades": [
                {
                    "ticker": None,
                    "side": None,
                    "quantity": None,
                    "status": "failed",
                    "error": "Invalid trades list.",
                }
            ],
            "watchlist_changes": [
                {
                    "ticker": None,
                    "action": None,
                    "status": "failed",
                    "error": "Invalid watchlist_changes list.",
                }
            ],
        }
        assert outcome.notes == [
            f"{WARN}Couldn't run a requested watchlist change: invalid watchlist_changes list.",
            f"{WARN}Couldn't run a requested trade: invalid trades list.",
        ]

    async def test_no_notes_when_nothing_failed(self, trade_env):
        trade_env.price("AAPL", 190.50)
        outcome = await run(trade_env, reply(trades=[buy("AAPL", 1)]))
        assert outcome.notes == []

    def test_failure_reason(self):
        assert failure_reason("PYPL is not on your watchlist") == "PYPL is not on your watchlist"
        assert (
            failure_reason("Insufficient cash (need $1.00, have $0.50).")
            == "insufficient cash (need $1.00, have $0.50)"
        )
        assert failure_reason("  A.  ") == "A"


class RecordingWatchlist:
    def __init__(self, calls: list) -> None:
        self.calls = calls

    async def add(self, raw: str):
        self.calls.append(("add", raw))
        return {"ticker": raw.strip().upper()}, True

    async def remove(self, raw: str) -> None:
        self.calls.append(("remove", raw))
        if raw == "MISSING":
            raise NotFoundError("MISSING is not on your watchlist")


class RecordingTrades:
    def __init__(self, calls: list) -> None:
        self.calls = calls

    async def execute(self, ticker: str, quantity: float, side: str) -> TradeResult:
        self.calls.append(("trade", ticker))
        trade = Trade("id", ticker.upper(), side, float(quantity), 10.0, "2026-01-01T00:00:00Z")
        return TradeResult(trade=trade, portfolio={})


class TestOrderAndIndependence:
    async def test_watchlist_runs_before_trades_when_trades_come_first(self):
        calls: list = []
        parsed = ParsedReply(
            "Ok.",
            [buy("AAPL", 1), buy("MSFT", 1)],
            [{"ticker": "PYPL", "action": "add"}, {"ticker": "MISSING", "action": "remove"}],
        )
        outcome = await execute_actions(parsed, RecordingWatchlist(calls), RecordingTrades(calls))
        assert calls == [
            ("add", "PYPL"),
            ("remove", "MISSING"),
            ("trade", "AAPL"),
            ("trade", "MSFT"),
        ]
        assert [r["status"] for r in outcome.actions["watchlist_changes"]] == [
            "executed",
            "failed",
        ]

    async def test_malformed_item_fails_alone_in_input_order(self, trade_env):
        trade_env.price("AAPL", 190.50)
        trade_env.price("MSFT", 410.00)
        outcome = await run(
            trade_env,
            reply(
                trades=[buy("AAPL", 1), {"ticker": 5, "side": "buy", "quantity": 1}, buy("MSFT", 1)]
            ),
        )
        records = outcome.actions["trades"]
        assert [r["status"] for r in records] == ["executed", "failed", "executed"]
        assert records[1] == {
            "ticker": None,
            "side": "buy",
            "quantity": 1,
            "status": "failed",
            "error": "Invalid trade (expected ticker, side and quantity).",
        }

    @pytest.mark.parametrize(
        "item",
        [{"ticker": 5, "side": "buy", "quantity": 1}, {"ticker": "AAPL"}, "AAPL", None, [1]],
    )
    async def test_each_malformed_shape_fails_with_invalid_trade(self, trade_env, item):
        trade_env.price("AAPL", 190.50)
        records = (await run(trade_env, reply(trades=[item, buy("AAPL", 1)]))).actions["trades"]
        assert records[0]["status"] == "failed"
        assert records[0]["error"] == "Invalid trade (expected ticker, side and quantity)."
        assert records[1]["status"] == "executed"

    async def test_non_finite_quantity_recorded_as_null(self, trade_env):
        trade_env.price("AAPL", 190.50)
        [record] = (await run(trade_env, reply(trades=[buy("AAPL", float("nan"))]))).actions[
            "trades"
        ]
        assert record["status"] == "failed"
        assert record["quantity"] is None
        assert record["error"] == "Quantity must be a positive number."

    async def test_bool_quantity_is_invalid(self, trade_env):
        trade_env.price("AAPL", 190.50)
        [record] = (await run(trade_env, reply(trades=[buy("AAPL", True)]))).actions["trades"]
        assert record["status"] == "failed"
        assert record["quantity"] is None
        assert count(trade_env, "trades") == 0

    async def test_bad_watchlist_action(self, trade_env):
        [record] = (
            await run(trade_env, reply(watch=[{"ticker": "PYPL", "action": "watch"}]))
        ).actions["watchlist_changes"]
        assert record == {
            "ticker": "PYPL",
            "action": "watch",
            "status": "failed",
            "error": "Action must be 'add' or 'remove'.",
        }

    async def test_exact_cash_buy_executes_and_leaves_zero(self, trade_env):
        trade_env.price("AAPL", 100.00)
        [record] = (await run(trade_env, reply(trades=[buy("AAPL", 100)]))).actions["trades"]
        assert record["status"] == "executed"
        assert cash(trade_env) == 0.0

    async def test_tiny_quantity_fails(self, trade_env):
        trade_env.price("AAPL", 190.50)
        [record] = (await run(trade_env, reply(trades=[buy("AAPL", 0.00004)]))).actions["trades"]
        assert record["status"] == "failed"
        assert record["error"] == "Quantity must be at least 0.0001."

    async def test_executed_quantity_rounds_half_up(self, trade_env):
        trade_env.price("AAPL", 10.00)
        [record] = (await run(trade_env, reply(trades=[buy("AAPL", 1.23455)]))).actions["trades"]
        assert record == {
            "ticker": "AAPL",
            "side": "buy",
            "quantity": 1.2346,
            "status": "executed",
            "price": 10.0,
        }

    async def test_add_then_buy_in_one_reply(self, trade_env):
        original = trade_env.source.add_ticker

        async def add_and_price(ticker: str) -> None:
            await original(ticker)
            trade_env.price(ticker, 61.25)  # like the simulator: priced on add

        trade_env.source.add_ticker = add_and_price
        outcome = await run(
            trade_env,
            reply(trades=[buy("PYPL", 2)], watch=[{"ticker": "PYPL", "action": "add"}]),
        )
        assert outcome.actions["watchlist_changes"][0]["status"] == "executed"
        assert outcome.actions["trades"][0] == {
            "ticker": "PYPL",
            "side": "buy",
            "quantity": 2.0,
            "status": "executed",
            "price": 61.25,
        }

    @pytest.mark.parametrize("parsed", [ParsedReply("Hi", [], []), reply()])
    async def test_no_actions_gives_none(self, trade_env, parsed):
        assert await run(trade_env, parsed) == ActionOutcome(None, [])


class TestConcurrency:
    async def test_chat_actions_and_manual_trade_do_not_deadlock(self, trade_env):
        trade_env.price("AAPL", 100.00)
        trade_env.price("MSFT", 200.00)
        trade_env.price("PYPL", 50.00)
        parsed = reply(trades=[buy("AAPL", 1)], watch=[{"ticker": "PYPL", "action": "add"}])
        outcome, manual = await asyncio.wait_for(
            asyncio.gather(
                execute_actions(parsed, trade_env.watchlist, trade_env.trades),
                trade_env.trades.execute("MSFT", 1, "buy"),
            ),
            5,
        )
        assert outcome.actions["trades"][0]["status"] == "executed"
        assert manual.trade.ticker == "MSFT"
        assert cash(trade_env) == 9700.0
