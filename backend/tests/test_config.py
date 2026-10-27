"""Tests for Settings.from_env: precedence, empty values and .env ordering (OPS-03).

Every test uses a temporary .env file and a cleared environment; the real repo
.env is never read and no real keys appear here.
"""

import dataclasses
import os
import sqlite3
from contextlib import closing
from pathlib import Path, PurePosixPath
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.config import (
    DEFAULT_DB_PATH,
    DEFAULT_STATIC_DIR,
    REPO_ROOT,
    Settings,
    default_db_path,
)
from app.main import create_app
from app.market import PriceCache, create_market_data_source
from app.market.massive_client import MassiveDataSource


def write_env(tmp_path, text: str):
    path = tmp_path / ".env"
    path.write_text(text, encoding="utf-8")
    return path


class TestPrecedence:
    def test_environment_beats_env_file(self, tmp_path):
        env_file = write_env(tmp_path, "DB_PATH=/from/file.db\n")
        with patch.dict(os.environ, {"DB_PATH": "/from/env.db"}, clear=True):
            assert Settings.from_env(env_file=env_file).db_path == "/from/env.db"

    def test_value_only_in_env_file_is_loaded(self, tmp_path):
        env_file = write_env(tmp_path, "DB_PATH=/from/file.db\nDEV_CORS_ORIGIN=http://x:3000\n")
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings.from_env(env_file=env_file)
        assert settings.db_path == "/from/file.db"
        assert settings.dev_cors_origin == "http://x:3000"

    def test_missing_env_file_is_not_an_error(self, tmp_path):
        with patch.dict(os.environ, {}, clear=True):
            settings = Settings.from_env(env_file=tmp_path / "does-not-exist.env")
        assert settings.db_path == str(DEFAULT_DB_PATH)


class TestEmptyValues:
    @pytest.mark.parametrize("value", ["", "   ", "\t"])
    def test_blank_db_path_uses_default(self, tmp_path, value):
        with patch.dict(os.environ, {"DB_PATH": value}, clear=True):
            settings = Settings.from_env(env_file=tmp_path / "none.env")
        assert settings.db_path == str(REPO_ROOT / "db" / "finally.db")

    def test_blank_db_path_in_env_file_uses_default(self, tmp_path):
        env_file = write_env(tmp_path, "DB_PATH=\n")
        with patch.dict(os.environ, {}, clear=True):
            assert Settings.from_env(env_file=env_file).db_path == str(DEFAULT_DB_PATH)

    @pytest.mark.parametrize("value", ["", "  "])
    def test_blank_static_dir_uses_default(self, tmp_path, value):
        with patch.dict(os.environ, {"STATIC_DIR": value}, clear=True):
            settings = Settings.from_env(env_file=tmp_path / "none.env")
        assert settings.static_dir == str(DEFAULT_STATIC_DIR)

    @pytest.mark.parametrize("value", ["", "  "])
    def test_blank_dev_cors_origin_is_none(self, tmp_path, value):
        with patch.dict(os.environ, {"DEV_CORS_ORIGIN": value}, clear=True):
            settings = Settings.from_env(env_file=tmp_path / "none.env")
        assert settings.dev_cors_origin is None


class TestDockerDbPath:
    """CR-01: a blank DB_PATH must never move the Docker database off the volume."""

    def test_local_layout_uses_repo_db_dir(self, tmp_path):
        config_file = tmp_path / "repo" / "backend" / "app" / "config.py"
        assert default_db_path(config_file) == tmp_path / "repo" / "db" / "finally.db"

    def test_container_layout_uses_volume_path(self):
        # In the image the module is /app/app/config.py, so the "repo root" is "/".
        anchor = Path(Path.cwd().anchor)
        config_file = anchor / "app" / "app" / "config.py"
        assert default_db_path(config_file) == anchor / "app" / "db" / "finally.db"

    def test_compose_pins_db_path_under_environment(self):
        yaml = pytest.importorskip("yaml")
        compose = yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
        app = compose["services"]["app"]
        db_path = app["environment"]["DB_PATH"]
        volume_target = PurePosixPath(app["volumes"][0].split(":")[1])
        assert PurePosixPath(db_path).parent == volume_target


class TestOrdering:
    def test_massive_key_only_in_env_file_selects_massive(self, tmp_path):
        env_file = write_env(tmp_path, "MASSIVE_API_KEY=test-key\n")
        with patch.dict(os.environ, {}, clear=True):
            Settings.from_env(env_file=env_file)
            source = create_market_data_source(PriceCache())  # constructed, never started
        assert isinstance(source, MassiveDataSource)


class TestIsolation:
    def test_settings_is_frozen(self, settings):
        with pytest.raises(dataclasses.FrozenInstanceError):
            settings.db_path = "/elsewhere.db"

    def test_two_apps_use_their_own_database_files(self, tmp_path, recording_source):
        settings_a = Settings(db_path=str(tmp_path / "a.db"), static_dir=str(tmp_path / "x"))
        settings_b = Settings(db_path=str(tmp_path / "b.db"), static_dir=str(tmp_path / "x"))
        src_a, src_b = recording_source(), recording_source()
        app_a = create_app(settings_a, source_factory=lambda c: src_a, snapshot_interval=3600)
        app_b = create_app(settings_b, source_factory=lambda c: src_b, snapshot_interval=3600)
        with TestClient(app_a) as client_a, TestClient(app_b):
            assert client_a.post("/api/watchlist", json={"ticker": "PYPL"}).status_code == 201

        def tickers(path):
            with closing(sqlite3.connect(path)) as conn:
                return {r[0] for r in conn.execute("SELECT ticker FROM watchlist")}

        assert "PYPL" in tickers(tmp_path / "a.db")
        assert "PYPL" not in tickers(tmp_path / "b.db")
