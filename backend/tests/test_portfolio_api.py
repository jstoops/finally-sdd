"""Tests for the portfolio API: the trade tracer through route, service, transaction and view."""

import re
import sqlite3
import uuid
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
PORTFOLIO_KEYS = ["cash_balance", "positions_value", "total_value", "unrealized_pnl", "positions"]
POSITION_KEYS = [
    "ticker",
    "quantity",
    "avg_cost",
    "current_price",
    "market_value",
    "unrealized_pnl",
    "unrealized_pnl_percent",
    "weight",
]
TRADE_KEYS = ["id", "ticker", "side", "quantity", "price", "executed_at"]
NO_PRICE = "No price available for ZZZZ. Add it to your watchlist first."


def run_sql(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(db_path)) as conn:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()
    return rows


def insert_trade(db_path: str, executed_at: str, ticker: str = "AAPL") -> str:
    """Insert one trade row directly; returns its id."""
    trade_id = str(uuid.uuid4())
    run_sql(
        db_path,
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
        "VALUES (?, 'default', ?, 'buy', 1.0, 100.0, ?)",
        (trade_id, ticker, executed_at),
    )
    return trade_id


@pytest.fixture
def trade_client(make_app, recording_source):
    """A started app on a RecordingSource with AAPL priced at 190.52; yields the client."""
    source = recording_source()
    with TestClient(make_app(source_factory=lambda cache: source)) as client:
        client.app.state.cache.update("AAPL", 190.52)
        yield client


class TestTradeTracer:
    def test_buy_returns_trade_and_committed_portfolio(self, trade_client):
        res = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "buy"}
        )
        assert res.status_code == 200
        body = res.json()
        assert list(body) == ["trade", "portfolio"]

        trade = body["trade"]
        assert list(trade) == TRADE_KEYS
        assert trade["ticker"] == "AAPL"
        assert trade["side"] == "buy"
        assert trade["price"] == 190.52
        assert trade["quantity"] == 10.0
        assert ISO_RE.match(trade["executed_at"])

        portfolio = body["portfolio"]
        assert list(portfolio) == PORTFOLIO_KEYS
        assert portfolio["cash_balance"] == 8094.8
        assert portfolio["positions_value"] == 1905.2
        assert portfolio["total_value"] == 10000.0
        assert portfolio["unrealized_pnl"] == 0.0
        [position] = portfolio["positions"]
        assert list(position) == POSITION_KEYS
        assert position["ticker"] == "AAPL"
        assert position["quantity"] == 10.0
        assert position["avg_cost"] == 190.52
        assert position["current_price"] == 190.52
        assert position["weight"] == 1.0

        assert trade_client.get("/api/portfolio").json() == portfolio

        db_path = trade_client.app.state.db.path
        assert run_sql(db_path, "SELECT ticker, side, quantity, price FROM trades") == [
            ("AAPL", "buy", 10.0, 190.52)
        ]

    def test_sell_all_deletes_position_and_restores_cash(self, trade_client):
        trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "buy"}
        )
        res = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "aapl", "quantity": 10, "side": "SELL"}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["trade"]["side"] == "sell"
        assert body["trade"]["quantity"] == 10.0
        assert body["portfolio"]["positions"] == []
        assert body["portfolio"]["cash_balance"] == 10000.0
        assert run_sql(trade_client.app.state.db.path, "SELECT COUNT(*) FROM positions") == [(0,)]

    @pytest.mark.parametrize(
        "body",
        [{}, {"ticker": "AAPL", "quantity": "abc", "side": "buy"}],
        ids=["missing-fields", "non-numeric-quantity"],
    )
    def test_malformed_body_is_422(self, trade_client, body):
        assert trade_client.post("/api/portfolio/trade", json=body).status_code == 422

    def test_unpriced_ticker_is_400_with_verbatim_message(self, trade_client):
        res = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "ZZZZ", "quantity": 1, "side": "buy"}
        )
        assert res.status_code == 400
        assert res.json() == {"error": NO_PRICE}
        db_path = trade_client.app.state.db.path
        assert run_sql(db_path, "SELECT COUNT(*) FROM trades") == [(0,)]
        assert run_sql(db_path, "SELECT cash_balance FROM users_profile") == [(10000.0,)]

    def test_insufficient_cash_and_shares_are_400_and_change_nothing(self, trade_client):
        res = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 100, "side": "buy"}
        )
        assert res.status_code == 400
        assert res.json() == {"error": "Insufficient cash (need $19,052.00, have $10,000.00)."}

        res = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 1, "side": "sell"}
        )
        assert res.status_code == 400
        assert res.json() == {"error": "Insufficient shares (need 1, have 0)."}

        res = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 1, "side": "hold"}
        )
        assert res.status_code == 400
        assert res.json() == {"error": "Side must be 'buy' or 'sell'."}

        db_path = trade_client.app.state.db.path
        assert run_sql(db_path, "SELECT COUNT(*) FROM trades") == [(0,)]
        assert run_sql(db_path, "SELECT cash_balance FROM users_profile") == [(10000.0,)]


class TestTrades:
    def test_fresh_app_has_no_trades(self, trade_client):
        res = trade_client.get("/api/trades")
        assert res.status_code == 200
        assert res.json() == {"trades": []}

    def test_newest_first_with_trade_keys(self, trade_client):
        buy = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 10, "side": "buy"}
        ).json()["trade"]
        sell = trade_client.post(
            "/api/portfolio/trade", json={"ticker": "AAPL", "quantity": 4, "side": "sell"}
        ).json()["trade"]

        trades = trade_client.get("/api/trades").json()["trades"]
        assert [t["id"] for t in trades] == [sell["id"], buy["id"]]
        assert trades[0] == sell
        for trade in trades:
            assert list(trade) == TRADE_KEYS
            assert ISO_RE.match(trade["executed_at"])

    def test_caps_at_100_and_drops_the_oldest(self, trade_client):
        db_path = trade_client.app.state.db.path
        ids = [
            insert_trade(db_path, f"2026-10-09T14:{i // 60:02d}:{i % 60:02d}Z") for i in range(101)
        ]

        trades = trade_client.get("/api/trades").json()["trades"]
        assert len(trades) == 100
        assert ids[0] not in {t["id"] for t in trades}
        assert trades[0]["id"] == ids[-1]
        assert trades[-1]["id"] == ids[1]

    def test_same_second_trades_keep_execution_order(self, trade_client):
        db_path = trade_client.app.state.db.path
        first = insert_trade(db_path, "2026-10-09T14:00:00Z")
        second = insert_trade(db_path, "2026-10-09T14:00:00Z", ticker="MSFT")
        third = insert_trade(db_path, "2026-10-09T14:00:00Z", ticker="NVDA")

        trades = trade_client.get("/api/trades").json()["trades"]
        assert [t["id"] for t in trades] == [third, second, first]
