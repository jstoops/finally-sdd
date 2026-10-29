"""Tests for the chat API: the mock-mode tracer through route, service, executor and storage."""

import dataclasses
import json
import re
import sqlite3
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.chat.mock import GREETING
from app.chat.service import NOT_CONFIGURED
from app.main import create_app

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
MESSAGE_KEYS = ["id", "role", "content", "actions", "created_at"]


def run_sql(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(db_path)) as conn:
        return conn.execute(sql, params).fetchall()


def chat_rows(client: TestClient) -> list[tuple]:
    return run_sql(
        client.app.state.db.path,
        "SELECT role, content, actions FROM chat_messages ORDER BY created_at, rowid",
    )


@pytest.fixture
def mock_client(settings, recording_source):
    """A started app in LLM_MOCK mode on a RecordingSource with AAPL priced at 190.52."""
    source = recording_source()
    app = create_app(
        dataclasses.replace(settings, llm_mock=True), source_factory=lambda cache: source
    )
    with TestClient(app) as client:
        client.app.state.cache.update("AAPL", 190.52)
        yield client


class TestChatTracer:
    def test_buy_executes_trade_and_returns_stored_reply(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": "buy"})
        assert res.status_code == 200
        body = res.json()
        assert list(body) == MESSAGE_KEYS
        assert body["role"] == "assistant"
        assert body["content"] == "Buying 1 share of AAPL."
        assert ISO_RE.match(body["created_at"])
        assert body["actions"] == {
            "trades": [
                {
                    "ticker": "AAPL",
                    "side": "buy",
                    "quantity": 1.0,
                    "status": "executed",
                    "price": 190.52,
                }
            ],
            "watchlist_changes": [],
        }

        portfolio = mock_client.get("/api/portfolio").json()
        assert portfolio["cash_balance"] == 9809.48
        [position] = portfolio["positions"]
        assert position["ticker"] == "AAPL"
        assert position["quantity"] == 1.0

        [user_row, assistant_row] = chat_rows(mock_client)
        assert user_row == ("user", "buy", None)
        assert assistant_row[:2] == ("assistant", "Buying 1 share of AAPL.")
        assert json.loads(assistant_row[2]) == body["actions"]
        [(stored_id, stored_at)] = run_sql(
            mock_client.app.state.db.path,
            "SELECT id, created_at FROM chat_messages WHERE role = 'assistant'",
        )
        assert (stored_id, stored_at) == (body["id"], body["created_at"])

    def test_greeting_has_null_actions(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": "hello"})
        assert res.status_code == 200
        body = res.json()
        assert body["content"] == GREETING
        assert body["actions"] is None
        assert chat_rows(mock_client)[-1] == ("assistant", GREETING, None)

    def test_failed_sell_is_recorded_and_still_200(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": "sell"})
        assert res.status_code == 200
        assert res.json()["actions"] == {
            "trades": [
                {
                    "ticker": "AAPL",
                    "side": "sell",
                    "quantity": 1,
                    "status": "failed",
                    "error": "Insufficient shares (need 1, have 0).",
                }
            ],
            "watchlist_changes": [],
        }
        assert mock_client.get("/api/portfolio").json()["positions"] == []

    def test_non_string_message_is_422(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": 5})
        assert res.status_code == 422
        assert chat_rows(mock_client) == []

    def test_unconfigured_app_returns_503_and_stores_nothing(self, make_app, recording_source):
        source = recording_source()
        with TestClient(make_app(source_factory=lambda cache: source)) as client:
            res = client.post("/api/chat", json={"message": "buy"})
            assert res.status_code == 503
            assert res.json() == {"error": NOT_CONFIGURED}
            assert chat_rows(client) == []
