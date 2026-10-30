"""Tests for the account reset (PF-09, PF-02, WL-06): one transaction under the shared lock,
tracked-ticker re-sync, and the PLAN §8 POST /api/reset contract (user decision U-1)."""

import asyncio
import sqlite3
import uuid
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.chat import MockLLMClient
from app.db import DEFAULT_WATCHLIST
from app.trading import TradeResult

TIMEOUT = 5  # every service await is bounded, so a lock re-entry deadlock fails fast


def run_sql(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(db_path)) as conn:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()
    return rows


async def bounded(coro):
    return await asyncio.wait_for(coro, timeout=TIMEOUT)


def insert_chat_message(db_path: str) -> None:
    run_sql(
        db_path,
        "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
        "VALUES (?, 'default', 'user', 'Buy 5 NVDA', NULL, '2026-10-09T14:00:00Z')",
        (str(uuid.uuid4()),),
    )


def count(db_path: str, table: str) -> int:
    return run_sql(db_path, f"SELECT COUNT(*) FROM {table}")[0][0]


def watchlist(db_path: str) -> list[str]:
    return [
        row[0] for row in run_sql(db_path, "SELECT ticker FROM watchlist ORDER BY added_at, rowid")
    ]


def assert_default_account(db_path: str) -> None:
    assert run_sql(db_path, "SELECT cash_balance FROM users_profile") == [(10000.0,)]
    assert count(db_path, "positions") == 0
    assert count(db_path, "trades") == 0
    assert count(db_path, "chat_messages") == 0
    assert run_sql(db_path, "SELECT total_value FROM portfolio_snapshots") == [(10000.0,)]
    assert watchlist(db_path) == list(DEFAULT_WATCHLIST)


async def dirty_account(env) -> None:
    """Buy AAPL and TSLA, drop TSLA and NVDA from the watchlist, add PYPL, store a chat row."""
    env.price("AAPL", 190.0)
    env.price("TSLA", 250.0)
    await bounded(env.trades.execute("AAPL", 3, "buy"))
    await bounded(env.trades.execute("TSLA", 2, "buy"))
    await bounded(env.watchlist.remove("TSLA"))
    await bounded(env.watchlist.remove("NVDA"))
    await bounded(env.watchlist.add("PYPL"))
    insert_chat_message(env.db.path)


class TestResetService:
    async def test_reset_restores_the_default_account(self, trade_env):
        env = trade_env
        await dirty_account(env)
        assert count(env.db.path, "trades") == 2

        await bounded(env.portfolio.reset())

        assert_default_account(env.db.path)

    async def test_reset_resyncs_tracked_tickers_to_the_defaults(self, trade_env):
        env = trade_env
        await dirty_account(env)
        assert "PYPL" in env.source.get_tickers()
        assert "NVDA" not in env.source.get_tickers()
        added_before = len(env.source.added)

        await bounded(env.portfolio.reset())

        assert set(env.source.get_tickers()) == set(DEFAULT_WATCHLIST)
        assert "PYPL" in env.source.removed
        assert env.source.added[added_before:] == ["NVDA"]

    async def test_reset_of_a_default_account_makes_no_source_calls(self, trade_env):
        env = trade_env
        await bounded(env.portfolio.reset())
        assert env.source.added == []
        assert env.source.removed == []
        assert_default_account(env.db.path)

    async def test_reset_waits_for_the_shared_lock(self, trade_env):
        env = trade_env
        await env.lock.acquire()
        task = asyncio.create_task(env.portfolio.reset())
        await asyncio.sleep(0.05)
        assert not task.done()
        env.lock.release()
        await bounded(task)
        assert_default_account(env.db.path)

    async def test_reset_concurrent_with_buys_leaves_a_consistent_account(self, trade_env):
        env = trade_env
        env.price("AAPL", 100.0)
        await bounded(env.trades.execute("AAPL", 7, "buy"))

        results = await asyncio.wait_for(
            asyncio.gather(
                env.trades.execute("AAPL", 1, "buy"),
                env.trades.execute("AAPL", 1, "buy"),
                env.portfolio.reset(),
                env.trades.execute("AAPL", 1, "buy"),
                env.trades.execute("AAPL", 1, "buy"),
                env.trades.execute("AAPL", 1, "buy"),
                return_exceptions=True,
            ),
            timeout=TIMEOUT,
        )
        assert sum(isinstance(r, TradeResult) for r in results) == 5
        assert results[2] is None

        db_path = env.db.path
        # The reset snapshot is the first remaining row; every later fill added one more.
        snaps = run_sql(db_path, "SELECT recorded_at FROM portfolio_snapshots ORDER BY rowid")
        reset_at = snaps[0][0]
        trades = run_sql(db_path, "SELECT quantity, price, executed_at FROM trades")
        assert len(snaps) == len(trades) + 1
        assert all(executed_at >= reset_at for _, _, executed_at in trades)
        spent = sum(quantity * price for quantity, price, _ in trades)
        assert run_sql(db_path, "SELECT cash_balance FROM users_profile") == [(10000.0 - spent,)]
        held = sum(quantity for quantity, _, _ in trades)
        positions = run_sql(db_path, "SELECT ticker, quantity FROM positions")
        assert positions == ([("AAPL", held)] if trades else [])


@pytest.fixture
def reset_client(make_app, recording_source):
    """A started app on a RecordingSource with AAPL priced; yields (client, source)."""
    source = recording_source()
    with TestClient(make_app(source_factory=lambda cache: source)) as client:
        client.app.state.cache.update("AAPL", 190.52)
        yield client, source


def buy_and_dirty(client: TestClient) -> None:
    res = client.post(
        "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "buy"}
    )
    assert res.status_code == 200
    assert client.post("/api/watchlist", json={"ticker": "PYPL"}).status_code == 201
    assert client.get("/api/portfolio").json()["cash_balance"] == 8094.8


class TestResetRoute:
    def test_json_post_resets_and_returns_ok(self, reset_client):
        client, source = reset_client
        buy_and_dirty(client)

        res = client.post("/api/reset", json={})
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

        assert_default_account(client.app.state.db.path)
        assert set(source.get_tickers()) == set(DEFAULT_WATCHLIST)
        portfolio = client.get("/api/portfolio").json()
        assert portfolio["cash_balance"] == 10000.0
        assert portfolio["positions"] == []
        assert client.get("/api/trades").json() == {"trades": []}
        [snapshot] = client.get("/api/portfolio/history").json()["snapshots"]
        assert snapshot["total_value"] == 10000.0
        tickers = [e["ticker"] for e in client.get("/api/watchlist").json()["tickers"]]
        assert tickers == list(DEFAULT_WATCHLIST)

    def test_bodyless_post_without_content_type_resets(self, reset_client):
        client, _ = reset_client
        buy_and_dirty(client)

        res = client.post("/api/reset")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}
        assert_default_account(client.app.state.db.path)

    def test_text_plain_post_resets(self, reset_client):
        client, _ = reset_client
        buy_and_dirty(client)

        res = client.post("/api/reset", content="x", headers={"Content-Type": "text/plain"})
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}
        assert_default_account(client.app.state.db.path)

    def test_chat_history_is_empty_after_reset(self, make_app, recording_source):
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, llm_client=MockLLMClient())
        with TestClient(app) as client:
            client.app.state.cache.update("AAPL", 190.52)
            assert client.post("/api/chat", json={"message": "buy"}).status_code == 200
            assert len(client.get("/api/chat/history").json()["messages"]) == 2

            assert client.post("/api/reset").status_code == 200

            res = client.get("/api/chat/history")
            assert res.status_code == 200
            assert res.json() == {"messages": []}
