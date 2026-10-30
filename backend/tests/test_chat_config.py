"""Tests for real-mode chat wiring: the key setting, client selection, 503 and warm-up (AI-09).

The environment is patched with `clear=True` and a nonexistent env file, so the real
repo-root `.env` is never read. No test reaches OpenRouter: `warm` is patched, and the
litellm-import check runs the app in mock and unconfigured modes only.
"""

import dataclasses
import json
import os
import sqlite3
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.chat import MockLLMClient, OpenRouterLLMClient
from app.chat.factory import create_llm_client
from app.chat.service import NOT_CONFIGURED
from app.config import Settings
from app.main import create_app

KEY = "sk-or-test-secret-0042"
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPLY = json.dumps({"message": "Hi.", "trades": [], "watchlist_changes": []})


def from_env(tmp_path, env: dict[str, str]) -> Settings:
    with patch.dict(os.environ, env, clear=True):
        return Settings.from_env(env_file=tmp_path / "missing.env")


def chat_row_count(client: TestClient) -> int:
    with closing(sqlite3.connect(client.app.state.db.path)) as conn:
        return conn.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0]


@pytest.fixture
def build(settings, recording_source):
    """Build an app on the test settings with overrides, backed by a RecordingSource."""

    def _build(**overrides):
        source = recording_source()
        return create_app(
            dataclasses.replace(settings, **overrides), source_factory=lambda cache: source
        )

    return _build


class TestSettingsFromEnv:
    @pytest.mark.parametrize("value", ["true", "TRUE", " true "])
    def test_llm_mock_true_values(self, tmp_path, value):
        assert from_env(tmp_path, {"LLM_MOCK": value}).llm_mock is True

    @pytest.mark.parametrize("env", [{"LLM_MOCK": "false"}, {"LLM_MOCK": "1"}, {}])
    def test_llm_mock_false_values(self, tmp_path, env):
        assert from_env(tmp_path, env).llm_mock is False

    def test_blank_key_is_none(self, tmp_path):
        assert from_env(tmp_path, {"OPENROUTER_API_KEY": "  "}).openrouter_api_key is None

    def test_unset_key_is_none(self, tmp_path):
        assert from_env(tmp_path, {}).openrouter_api_key is None

    def test_key_is_read_and_hidden_from_repr(self, tmp_path):
        settings = from_env(tmp_path, {"OPENROUTER_API_KEY": f" {KEY} "})
        assert settings.openrouter_api_key == KEY
        assert KEY not in repr(settings)


class TestCreateLLMClient:
    def test_mock_wins_over_key(self, settings):
        client = create_llm_client(
            dataclasses.replace(settings, llm_mock=True, openrouter_api_key=KEY)
        )
        assert isinstance(client, MockLLMClient)

    def test_key_only_gives_openrouter(self, settings):
        client = create_llm_client(dataclasses.replace(settings, openrouter_api_key=KEY))
        assert isinstance(client, OpenRouterLLMClient)

    def test_neither_gives_none(self, settings):
        assert create_llm_client(settings) is None


class TestUnconfigured:
    def test_app_starts_and_chat_is_503_storing_nothing(self, build):
        with TestClient(build()) as client:
            assert client.get("/api/health").status_code == 200
            res = client.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 503
            assert res.json() == {"error": NOT_CONFIGURED}
            assert NOT_CONFIGURED == "AI assistant is not configured. Set OPENROUTER_API_KEY in .env."
            assert chat_row_count(client) == 0

    def test_two_concurrent_posts_are_both_503(self, build):
        with TestClient(build()) as client, ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(client.post, "/api/chat", json={"message": "hello"}) for _ in range(2)
            ]
            statuses = [future.result().status_code for future in futures]
            assert statuses == [503, 503]
            assert chat_row_count(client) == 0


class TestMockMode:
    def test_mock_without_key_answers(self, build):
        with TestClient(build(llm_mock=True)) as client:
            res = client.post("/api/chat", json={"message": "hello"})
            assert res.status_code == 200


class TestNoLitellmImport:
    def test_mock_and_unconfigured_modes_never_import_litellm(self, tmp_path):
        code = f"""
import os, sys
from fastapi.testclient import TestClient
from app.config import Settings
from app.main import create_app
from app.market.simulator import SimulatorDataSource

root = {str(tmp_path)!r}
for mode, mock in (("mock", True), ("unconfigured", False)):
    settings = Settings(
        db_path=os.path.join(root, mode + ".db"),
        static_dir=os.path.join(root, "no-static"),
        llm_mock=mock,
    )
    app = create_app(settings, source_factory=lambda cache: SimulatorDataSource(price_cache=cache))
    with TestClient(app) as client:
        status = client.post("/api/chat", json={{"message": "hello"}}).status_code
        assert status == (200 if mock else 503), (mode, status)
    assert "litellm" not in sys.modules, mode
print("ok")
"""
        env = {k: v for k, v in os.environ.items() if k != "OPENROUTER_API_KEY"}
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=BACKEND_DIR,
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert result.stdout.strip().endswith("ok")


class TestWarmUp:
    def test_lifespan_warms_the_openrouter_client_once(self, build, monkeypatch, caplog):
        calls: list[OpenRouterLLMClient] = []
        monkeypatch.setattr(OpenRouterLLMClient, "warm", lambda self: calls.append(self))
        with caplog.at_level("INFO"):
            app = build(openrouter_api_key=KEY)
            with TestClient(app) as client:
                assert client.get("/api/health").status_code == 200
        assert len(calls) == 1
        assert any("chat mode openrouter" in r.getMessage() for r in caplog.records)

    def test_warm_failure_is_logged_and_app_still_serves(self, build, monkeypatch, caplog):
        def boom(self):
            raise RuntimeError("cannot import")

        monkeypatch.setattr(OpenRouterLLMClient, "warm", boom)
        with caplog.at_level("INFO"), TestClient(build(openrouter_api_key=KEY)) as client:
            assert client.get("/api/health").status_code == 200
        assert any("LLM warm-up failed" in r.getMessage() for r in caplog.records)

    def test_key_never_logged_during_startup_or_chat(self, build, monkeypatch, caplog):
        def fake_warm(self):
            self._completion = lambda **kwargs: SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=REPLY))]
            )

        monkeypatch.setattr(OpenRouterLLMClient, "warm", fake_warm)
        with caplog.at_level("DEBUG"):
            with TestClient(build(openrouter_api_key=KEY)) as client:
                res = client.post("/api/chat", json={"message": "hello"})
                assert res.status_code == 200
                assert KEY not in res.text
        assert caplog.records
        for record in caplog.records:
            assert KEY not in record.getMessage()
            assert KEY not in str(record.args)
