"""Tests for the OpenRouter LLM client and the strict reply schema (plan 03-04, AI-01).

Every test injects a fake completion function, so this file never imports litellm
and never reaches the network.
"""

import asyncio
import json
import sqlite3
import sys
import threading
import time
from contextlib import closing
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.chat import LLMError, LLMReply, OpenRouterLLMClient
from app.chat.llm import EXTRA_BODY, LLM_TIMEOUT, MODEL
from app.chat.service import LLM_BAD_REPLY, LLM_CALL_FAILED

KEY = "sk-test-key"
MESSAGES = [{"role": "user", "content": "hello"}]
REPLY = json.dumps({"message": "Hi.", "trades": [], "watchlist_changes": []})
FORBIDDEN_KEYWORDS = {
    "pattern",
    "format",
    "minItems",
    "maxItems",
    "minLength",
    "maxLength",
    "oneOf",
    "allOf",
    "not",
}


def response(content: str | None) -> SimpleNamespace:
    """A litellm-shaped response carrying `content` as the first choice's message."""
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeCompletion:
    """Records each call's kwargs and thread, then returns `content` or raises `error`."""

    def __init__(self, content: str | None = REPLY, error: Exception | None = None) -> None:
        self.content = content
        self.error = error
        self.calls: list[dict] = []
        self.threads: list[int] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        self.threads.append(threading.get_ident())
        if self.error is not None:
            raise self.error
        return response(self.content)


def chat_row_count(client: TestClient) -> int:
    with closing(sqlite3.connect(client.app.state.db.path)) as conn:
        return conn.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0]


class TestOpenRouterClient:
    async def test_sends_the_skill_call_off_the_loop_thread(self):
        fake = FakeCompletion()
        client = OpenRouterLLMClient(KEY, completion=fake)

        result = await client.complete(MESSAGES)

        assert result == REPLY
        assert fake.calls == [
            {
                "model": MODEL,
                "messages": MESSAGES,
                "response_format": LLMReply,
                "reasoning_effort": "low",
                "extra_body": EXTRA_BODY,
                "api_key": KEY,
                "timeout": LLM_TIMEOUT,
            }
        ]
        assert fake.threads[0] != threading.get_ident()

    def test_constants_follow_the_skill_with_strict_routing(self):
        assert MODEL == "openrouter/openai/gpt-oss-120b"
        assert EXTRA_BODY == {
            "provider": {
                "order": ["cerebras"],
                "require_parameters": True,
                "allow_fallbacks": False,
            }
        }
        assert LLM_TIMEOUT == 30.0

    async def test_none_content_becomes_empty_string(self):
        client = OpenRouterLLMClient(KEY, completion=FakeCompletion(content=None))
        assert await client.complete(MESSAGES) == ""

    async def test_provider_error_becomes_llm_error_without_detail_or_key(self, caplog):
        fake = FakeCompletion(error=RuntimeError(f"boom {KEY}"))
        client = OpenRouterLLMClient(KEY, completion=fake)

        with caplog.at_level("DEBUG"), pytest.raises(LLMError) as info:
            await client.complete(MESSAGES)

        assert "boom" not in str(info.value)
        assert KEY not in str(info.value)
        assert str(info.value) == "RuntimeError"
        assert all(KEY not in record.getMessage() for record in caplog.records)
        assert any("OpenRouter call failed" in record.getMessage() for record in caplog.records)

    async def test_malformed_response_becomes_llm_error(self):
        client = OpenRouterLLMClient(KEY, completion=lambda **kwargs: SimpleNamespace())
        with pytest.raises(LLMError):
            await client.complete(MESSAGES)

    async def test_injected_completion_never_imports_litellm(self):
        client = OpenRouterLLMClient(KEY, completion=FakeCompletion())
        client.warm()
        await client.complete(MESSAGES)
        assert "litellm" not in sys.modules

    def test_key_not_in_repr(self):
        assert KEY not in repr(OpenRouterLLMClient(KEY, completion=FakeCompletion()))


class TestChatEndpointWithClient:
    def test_none_content_answers_502_bad_reply_with_only_user_row(
        self, make_app, recording_source
    ):
        client = OpenRouterLLMClient(KEY, completion=FakeCompletion(content=None))
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, llm_client=client)
        with TestClient(app) as http:
            res = http.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 502
            assert res.json() == {"error": LLM_BAD_REPLY}
            assert chat_row_count(http) == 1

    def test_provider_error_answers_502_call_failed_without_key(self, make_app, recording_source):
        fake = FakeCompletion(error=RuntimeError(f"boom {KEY}"))
        client = OpenRouterLLMClient(KEY, completion=fake)
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, llm_client=client)
        with TestClient(app) as http:
            res = http.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 502
            assert res.json() == {"error": LLM_CALL_FAILED}
            assert KEY not in res.text
            assert "boom" not in res.text
            assert chat_row_count(http) == 1


def _walk(node):
    """Yield every dict in a JSON schema tree."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value)


class TestSchema:
    def test_every_object_is_closed_and_fully_required(self):
        schema = LLMReply.model_json_schema()
        objects = [node for node in _walk(schema) if "properties" in node]
        assert len(objects) == 3  # LLMReply, LLMTrade, LLMWatchlistChange
        for node in objects:
            assert node.get("additionalProperties") is False
            assert sorted(node.get("required", [])) == sorted(node["properties"])

    def test_no_keyword_cerebras_strict_mode_rejects(self):
        schema = LLMReply.model_json_schema()
        for node in _walk(schema):
            keywords = set(node) - {"properties", "$defs"}
            assert not keywords & FORBIDDEN_KEYWORDS, node

    def test_schema_text_is_under_5000_characters(self):
        assert len(json.dumps(LLMReply.model_json_schema())) < 5000

    def test_validates_a_full_reply_and_rejects_extra_keys(self):
        reply = LLMReply.model_validate_json(
            json.dumps(
                {
                    "message": "Done.",
                    "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}],
                    "watchlist_changes": [{"ticker": "PYPL", "action": "add"}],
                }
            )
        )
        assert reply.trades[0].side == "buy"
        assert reply.watchlist_changes[0].action == "add"
        with pytest.raises(ValueError):
            LLMReply.model_validate_json(
                json.dumps({"message": "x", "trades": [], "watchlist_changes": [], "extra": 1})
            )


class TestLoop:
    async def test_blocked_completion_does_not_block_the_loop(self):
        release = threading.Event()

        def blocked(**kwargs):
            release.wait(5)
            return response(REPLY)

        client = OpenRouterLLMClient(KEY, completion=blocked)
        task = asyncio.create_task(client.complete(MESSAGES))
        started = time.monotonic()
        await asyncio.sleep(0.05)
        elapsed = time.monotonic() - started
        try:
            assert elapsed < 1.0
            assert not task.done()
        finally:
            release.set()
        assert await task == REPLY

    async def test_two_concurrent_calls_both_run_off_the_loop_thread(self):
        barrier = threading.Barrier(2, timeout=5)
        threads: list[int] = []

        def meet(**kwargs):
            threads.append(threading.get_ident())
            barrier.wait()  # deadlocks (BrokenBarrierError) unless both run at once
            return response(REPLY)

        client = OpenRouterLLMClient(KEY, completion=meet)
        results = await asyncio.gather(client.complete(MESSAGES), client.complete(MESSAGES))

        assert results == [REPLY, REPLY]
        assert len(threads) == 2
        assert threading.get_ident() not in threads
