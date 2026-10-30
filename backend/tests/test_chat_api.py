"""Tests for the chat API: the mock-mode tracer, the message gate (400/422), LLM
failures (502), GET /api/chat/history and the chat-only turn lock."""

import asyncio
import dataclasses
import json
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager

import pytest
from fastapi.testclient import TestClient

from app.chat import LLMError
from app.chat.mock import GREETING
from app.chat.service import (
    EMPTY_MESSAGE,
    LLM_BAD_REPLY,
    LLM_CALL_FAILED,
    MAX_MESSAGE_CHARS,
    MESSAGE_TOO_LONG,
    NOT_CONFIGURED,
    ChatService,
)
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


@pytest.fixture
def llm_app(make_app, recording_source):
    """Factory: a started app whose chat uses the given LLM client; AAPL priced at 190.52."""

    @contextmanager
    def _start(llm_client):
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, llm_client=llm_client)
        with TestClient(app) as client:
            client.app.state.cache.update("AAPL", 190.52)
            yield client

    return _start


class TestValidation:
    @pytest.mark.parametrize("message", ["", "   \n", "\t"])
    def test_empty_or_whitespace_is_400_and_stores_nothing(self, mock_client, message):
        res = mock_client.post("/api/chat", json={"message": message})
        assert res.status_code == 400
        assert res.json() == {"error": "Message cannot be empty."}
        assert EMPTY_MESSAGE == "Message cannot be empty."
        assert chat_rows(mock_client) == []

    def test_2001_chars_is_400_and_stores_nothing(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": "a" * 2001})
        assert res.status_code == 400
        assert res.json() == {"error": "Message is too long (max 2,000 characters)."}
        assert MESSAGE_TOO_LONG == "Message is too long (max 2,000 characters)."
        assert chat_rows(mock_client) == []

    def test_2001_emoji_is_400(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": "\U0001f642" * 2001})
        assert res.status_code == 400
        assert chat_rows(mock_client) == []

    def test_2000_emoji_is_not_400(self, mock_client):
        assert MAX_MESSAGE_CHARS == 2000
        res = mock_client.post("/api/chat", json={"message": "\U0001f642" * 2000})
        assert res.status_code == 200
        assert chat_rows(mock_client)[0][1] == "\U0001f642" * 2000

    def test_padding_does_not_count_and_is_not_400(self, mock_client):
        res = mock_client.post("/api/chat", json={"message": " " + "a" * 2000 + " "})
        assert res.status_code == 200
        assert chat_rows(mock_client)[0] == ("user", "a" * 2000, None)

    @pytest.mark.parametrize("body", [{}, {"message": 5}, {"message": None}, {"text": "hi"}])
    def test_malformed_body_is_422(self, mock_client, body):
        res = mock_client.post("/api/chat", json=body)
        assert res.status_code == 422
        assert chat_rows(mock_client) == []


class TestLLMFailures:
    @pytest.mark.parametrize(
        "raw", ["not json", "", "[1]", '{"message": ""}', '{"message": 5}', "Sure, buying now"]
    )
    def test_unreadable_reply_is_502_with_user_row_only(self, llm_app, fake_llm, raw):
        with llm_app(fake_llm(replies=[raw])) as client:
            res = client.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 502
            assert res.json() == {"error": LLM_BAD_REPLY}
            if raw:
                assert raw not in res.text
            assert chat_rows(client) == [("user", "hello", None)]

    def test_llm_error_is_502_with_user_row_only(self, llm_app, fake_llm):
        with llm_app(fake_llm(error=LLMError("provider exploded: secret detail"))) as client:
            res = client.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 502
            assert res.json() == {"error": LLM_CALL_FAILED}
            assert "secret detail" not in res.text
            assert chat_rows(client) == [("user", "hello", None)]

    def test_fenced_reply_with_bad_trades_list_is_200_not_502(self, llm_app, fake_llm):
        raw = '```json\n{"message": "Ok.", "trades": "AAPL"}\n```'
        with llm_app(fake_llm(replies=[raw])) as client:
            res = client.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 200
            body = res.json()
            assert body["actions"]["trades"][0]["error"] == "Invalid trades list."
            assert body["content"] == (
                "Ok.\n\n⚠️ Couldn't run a requested trade: invalid trades list."
            )


SELL_NOTE = "⚠️ Couldn't sell 1 AAPL: insufficient shares (need 1, have 0)."
SELL_CONTENT = "Selling 1 share of AAPL.\n\n" + SELL_NOTE


class TestHistory:
    def test_history_empty(self, mock_client):
        res = mock_client.get("/api/chat/history")
        assert res.status_code == 200
        assert res.json() == {"messages": []}

    def test_history_last_50_of_52_oldest_first(self, mock_client):
        for _ in range(26):
            assert mock_client.post("/api/chat", json={"message": "hello"}).status_code == 200
        messages = mock_client.get("/api/chat/history").json()["messages"]
        stored = run_sql(
            mock_client.app.state.db.path,
            "SELECT id FROM chat_messages ORDER BY created_at, rowid",
        )
        assert len(stored) == 52
        assert len(messages) == 50
        assert [m["id"] for m in messages] == [row[0] for row in stored[2:]]
        assert [m["role"] for m in messages[:2]] == ["user", "assistant"]
        assert all(list(m) == MESSAGE_KEYS for m in messages)

    def test_history_sell_entry_equals_post_response(self, mock_client):
        posted = mock_client.post("/api/chat", json={"message": "sell"}).json()
        assert posted["content"] == SELL_CONTENT
        [user, assistant] = mock_client.get("/api/chat/history").json()["messages"]
        assert assistant == posted
        assert (user["role"], user["content"], user["actions"]) == ("user", "sell", None)
        assert chat_rows(mock_client)[1][1] == SELL_CONTENT

    def test_history_without_failure_content_is_message_exactly(self, mock_client):
        posted = mock_client.post("/api/chat", json={"message": "buy"}).json()
        assert posted["content"] == "Buying 1 share of AAPL."
        assert mock_client.get("/api/chat/history").json()["messages"][1] == posted

    def test_history_unicode_round_trip(self, mock_client):
        text = "Achète 5 NVDA — merci \U0001f642"
        mock_client.post("/api/chat", json={"message": text})
        [user, _] = mock_client.get("/api/chat/history").json()["messages"]
        assert user["content"] == text
        assert user["content"].encode("utf-8") == text.encode("utf-8")


class GatedLLMClient:
    """Holds its first reply until `release` is set; records every messages list."""

    def __init__(self) -> None:
        self.release = asyncio.Event()
        self.calls: list[list[dict[str, str]]] = []

    async def complete(self, messages: list[dict[str, str]]) -> str:
        self.calls.append([dict(m) for m in messages])
        if len(self.calls) == 1:
            await self.release.wait()
            return json.dumps({"message": "First answer."})
        return json.dumps({"message": "Second answer."})


class TestTurnLock:
    async def test_second_turn_sees_the_first_turn(self, trade_env):
        client = GatedLLMClient()
        service = ChatService(
            trade_env.db, trade_env.portfolio, trade_env.watchlist, trade_env.trades, client
        )

        async def release_later() -> None:
            await asyncio.sleep(0.05)
            client.release.set()

        first, second, _ = await asyncio.wait_for(
            asyncio.gather(service.handle("first q"), service.handle("second q"), release_later()),
            5,
        )
        assert first["content"] == "First answer."
        assert second["content"] == "Second answer."
        contents = [m["content"] for m in client.calls[1]]
        assert contents[2:] == ["first q", "First answer.", "second q"]


BUY_AAPL_REPLY = json.dumps(
    {"message": "Buying 1 AAPL.", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}]}
)


class ThreadGatedLLMClient:
    """Holds its reply until the test thread sets `release`; sets `entered` once called.

    threading events, not asyncio ones: the test drives the app from other threads.
    """

    def __init__(self, reply: str) -> None:
        self.reply = reply
        self.entered = threading.Event()
        self.release = threading.Event()

    async def complete(self, messages: list[dict[str, str]]) -> str:
        self.entered.set()
        await asyncio.to_thread(self.release.wait, 5)
        return self.reply


class TestResetDuringTurn:
    def test_reset_waits_for_the_turn_and_no_trade_lands_in_the_fresh_account(self, llm_app):
        gate = ThreadGatedLLMClient(BUY_AAPL_REPLY)
        with llm_app(gate) as client, ThreadPoolExecutor(max_workers=2) as pool:
            chat = pool.submit(client.post, "/api/chat", json={"message": "buy one"})
            assert gate.entered.wait(5), "the chat turn never reached the LLM call"
            reset = pool.submit(client.post, "/api/reset")
            time.sleep(0.2)
            assert not reset.done(), "reset must wait for the in-flight chat turn"

            gate.release.set()
            chat_res = chat.result(timeout=5)
            reset_res = reset.result(timeout=5)

            assert chat_res.status_code == 200
            assert chat_res.json()["actions"]["trades"][0]["status"] == "executed"
            assert reset_res.status_code == 200
            assert reset_res.json() == {"status": "ok"}
            # The turn ran against the old account, then reset wiped it: a fresh account.
            portfolio = client.get("/api/portfolio").json()
            assert portfolio["cash_balance"] == 10000.0
            assert portfolio["positions"] == []
            assert chat_rows(client) == []
            assert run_sql(client.app.state.db.path, "SELECT COUNT(*) FROM trades") == [(0,)]


class FixedLLMClient:
    """Always answers with the same raw reply."""

    def __init__(self, reply: str) -> None:
        self.reply = reply

    async def complete(self, messages: list[dict[str, str]]) -> str:
        return self.reply


class TestStoreFailureAfterActions:
    async def test_actions_are_still_returned_when_the_assistant_insert_fails(self, trade_env):
        trade_env.price("AAPL", 190.0)
        service = ChatService(
            trade_env.db,
            trade_env.portfolio,
            trade_env.watchlist,
            trade_env.trades,
            FixedLLMClient(BUY_AAPL_REPLY),
        )

        real_write = service._write

        def locked_for_assistant(row: dict) -> None:
            if row["role"] == "assistant":
                raise sqlite3.OperationalError("database is locked")
            real_write(row)

        service._write = locked_for_assistant

        row = await asyncio.wait_for(service.handle("buy one"), 5)

        assert row["role"] == "assistant"
        assert row["actions"]["trades"][0]["status"] == "executed"
        # The trade really committed, so the client must refresh: it gets the actions back.
        view = await trade_env.portfolio.view()
        assert [p["ticker"] for p in view["positions"]] == ["AAPL"]
        roles = run_sql(trade_env.db.path, "SELECT role FROM chat_messages ORDER BY rowid")
        assert roles == [("user",)]
