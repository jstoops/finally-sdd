"""Tests for the app factory: lifespan startup, seed-once, watchlist and static serving."""

import asyncio
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT
from app.db import DEFAULT_WATCHLIST, Database

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SIX_TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}


@pytest.fixture
def recording(make_app, recording_source):
    """Build an app with a fresh RecordingSource; returns (app, source)."""

    def _build(**kwargs):
        source = recording_source()
        return make_app(source_factory=lambda cache: source, **kwargs), source

    return _build


def run_sql(tmp_path: Path, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()
    return rows


class TestWatchlist:
    def test_defaults_in_plan_order_with_prices(self, client):
        resp = client.get("/api/watchlist")
        assert resp.status_code == 200
        tickers = resp.json()["tickers"]
        assert [t["ticker"] for t in tickers] == list(DEFAULT_WATCHLIST)
        for entry in tickers:
            assert list(entry.keys()) == ["ticker", "price", "open_price", "added_at"]
            assert isinstance(entry["price"], float)
            assert isinstance(entry["open_price"], float)
            assert ISO_RE.match(entry["added_at"])

    def test_prices_match_cache_without_rerounding(self, recording):
        app, _ = recording()
        with TestClient(app) as client:
            app.state.cache.update("AAPL", 190.123)  # cache rounds to 190.12
            entry = client.get("/api/watchlist").json()["tickers"][0]
        assert entry["ticker"] == "AAPL"
        assert entry["price"] == app.state.cache.get("AAPL").price == 190.12
        assert entry["open_price"] == 190.12

    def test_unpriced_tickers_have_null_prices(self, recording):
        app, _ = recording()
        with TestClient(app) as client:
            tickers = client.get("/api/watchlist").json()["tickers"]
        assert len(tickers) == 10
        assert all(t["price"] is None and t["open_price"] is None for t in tickers)


class TestLifespan:
    def test_seeds_default_user(self, tmp_path, recording):
        app, _ = recording()
        with TestClient(app):
            pass
        rows = run_sql(tmp_path, "SELECT id, cash_balance FROM users_profile")
        assert rows == [("default", 10000.0)]

    def test_creates_all_six_tables(self, tmp_path, recording):
        app, _ = recording()
        with TestClient(app):
            pass
        names = {
            r[0] for r in run_sql(tmp_path, "SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert SIX_TABLES <= names

    def test_starts_source_with_watchlist_and_stops_it(self, recording):
        app, source = recording()
        with TestClient(app):
            assert source.started == [list(DEFAULT_WATCHLIST)]
        assert source.stopped == 1

    def test_seed_once_removed_default_stays_removed(self, tmp_path, recording):
        app, _ = recording()
        with TestClient(app):
            pass
        run_sql(tmp_path, "DELETE FROM watchlist WHERE ticker = ?", ("AAPL",))

        app2, source2 = recording()
        with TestClient(app2) as client:
            tickers = [t["ticker"] for t in client.get("/api/watchlist").json()["tickers"]]
        assert tickers == [t for t in DEFAULT_WATCHLIST if t != "AAPL"]
        assert source2.started == [tickers]
        assert run_sql(tmp_path, "SELECT COUNT(*) FROM users_profile") == [(1,)]
        names = {
            r[0] for r in run_sql(tmp_path, "SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert SIX_TABLES <= names

    def test_empty_watchlist_starts_with_no_tickers(self, tmp_path, recording):
        app, _ = recording()
        with TestClient(app):
            pass
        run_sql(tmp_path, "DELETE FROM watchlist")

        app2, source2 = recording()
        with TestClient(app2) as client:
            resp = client.get("/api/watchlist")
        assert source2.started == [[]]
        assert resp.json() == {"tickers": []}

    def test_held_ticker_on_watchlist_tracked_once(self, tmp_path, recording):
        app, _ = recording()
        with TestClient(app):
            pass
        run_sql(
            tmp_path,
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at) "
            "VALUES ('p1', 'AAPL', 1, 190.0, '2026-10-09T14:00:00Z')",
        )
        run_sql(
            tmp_path,
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at) "
            "VALUES ('p2', 'PYPL', 2, 60.0, '2026-10-09T14:00:00Z')",
        )

        app2, source2 = recording()
        with TestClient(app2):
            pass
        started = source2.started[0]
        assert started.count("AAPL") == 1
        assert started == [*DEFAULT_WATCHLIST, "PYPL"]


class TestSnapshotLifespan:
    def test_initial_snapshot_recorded_before_first_request(
        self, tmp_path, make_app, recording_source
    ):
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, snapshot_interval=3600)
        with TestClient(app) as client:
            rows = run_sql(tmp_path, "SELECT total_value, recorded_at FROM portfolio_snapshots")
            assert len(rows) == 1
            assert rows[0][0] == 10000.0
            assert ISO_RE.match(rows[0][1])
            assert source.started == [list(DEFAULT_WATCHLIST)]
            assert client.get("/api/health").status_code == 200
            assert run_sql(tmp_path, "SELECT COUNT(*) FROM portfolio_snapshots") == [(1,)]

    def test_state_lock_and_named_task_on_app_state(self, make_app, recording_source):
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, snapshot_interval=3600)
        with TestClient(app):
            assert isinstance(app.state.state_lock, asyncio.Lock)
            assert app.state.snapshot_task.get_name() == "snapshot-loop"
            assert not app.state.snapshot_task.done()

    def test_periodic_snapshots(self, tmp_path, make_app, recording_source):
        source = recording_source()
        app = make_app(source_factory=lambda cache: source, snapshot_interval=0.05)
        with TestClient(app):
            time.sleep(0.4)
        (count,) = run_sql(tmp_path, "SELECT COUNT(*) FROM portfolio_snapshots")[0]
        assert count >= 3

    def test_shutdown_cancels_snapshot_task_before_source_stop(self, make_app, recording_source):
        observed: list[bool] = []

        class StopProbe(recording_source):
            async def stop(self) -> None:
                observed.append(app.state.snapshot_task.done())
                await super().stop()

        source = StopProbe()
        app = make_app(source_factory=lambda cache: source, snapshot_interval=3600)
        with TestClient(app):
            pass
        assert observed == [True]
        assert app.state.snapshot_task.cancelled()
        assert source.stopped == 1


class TestDatabase:
    def test_init_twice_is_idempotent(self, tmp_path):
        db = Database(str(tmp_path / "t.db"))
        db.init()
        db.init()
        assert run_sql(tmp_path, "SELECT COUNT(*), MAX(cash_balance) FROM users_profile") == [
            (1, 10000.0)
        ]
        counts = run_sql(tmp_path, "SELECT ticker, COUNT(*) FROM watchlist GROUP BY ticker")
        assert sorted(counts) == sorted((t, 1) for t in DEFAULT_WATCHLIST)

    def test_init_creates_missing_parent_directory(self, tmp_path):
        db = Database(str(tmp_path / "nested" / "dir" / "f.db"))
        db.init()
        assert (tmp_path / "nested" / "dir" / "f.db").is_file()


class TestStatic:
    def test_serves_index_html_when_present(self, tmp_path, recording):
        static = tmp_path / "static"
        static.mkdir()
        (static / "index.html").write_text("<html><body>FinAlly test</body></html>")
        app, _ = recording(static_dir=str(static))
        with TestClient(app) as client:
            resp = client.get("/")
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/html")
            assert "FinAlly test" in resp.text
            assert client.get("/api/watchlist").status_code == 200

    def test_api_only_without_build(self, recording):
        app, _ = recording()
        with TestClient(app) as client:
            assert client.get("/api/watchlist").status_code == 200
            assert client.get("/").status_code == 404

    def test_serves_built_frontend(self, recording):
        out = REPO_ROOT / "frontend" / "out"
        if not (out / "index.html").is_file():
            pytest.skip("frontend/out not built; run `npm --prefix frontend run build`")
        app, _ = recording(static_dir=str(out))
        with TestClient(app) as client:
            resp = client.get("/")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        assert "FinAlly" in resp.text


class TestImport:
    def test_main_has_no_module_level_app(self):
        import app.main as main

        assert not hasattr(main, "app")


METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"]


def static_dir_with_index(tmp_path: Path) -> str:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<html><body>FinAlly test</body></html>")
    return str(static)


class TestHealth:
    def test_health_ok(self, recording):
        app, _ = recording()
        with TestClient(app) as client:
            resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


class TestApiNotFound:
    @pytest.mark.parametrize("method", METHODS)
    def test_unknown_api_path_is_json_404(self, recording, method):
        app, _ = recording()
        with TestClient(app) as client:
            resp = client.request(method, "/api/nope")
        assert resp.status_code == 404
        assert resp.headers["content-type"].startswith("application/json")
        assert resp.json() == {"error": "Not found"}

    @pytest.mark.parametrize("method", METHODS)
    def test_unknown_api_path_is_json_404_with_static(self, tmp_path, recording, method):
        app, _ = recording(static_dir=static_dir_with_index(tmp_path))
        with TestClient(app) as client:
            resp = client.request(method, "/api/nope")
        assert resp.status_code == 404
        assert resp.headers["content-type"].startswith("application/json")
        assert resp.json() == {"error": "Not found"}

    def test_static_index_still_served(self, tmp_path, recording):
        app, _ = recording(static_dir=static_dir_with_index(tmp_path))
        with TestClient(app) as client:
            resp = client.get("/")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")

    def test_real_routes_still_resolve(self, tmp_path, recording):
        app, _ = recording(static_dir=static_dir_with_index(tmp_path))
        with TestClient(app) as client:
            assert client.get("/api/watchlist").status_code == 200
            assert client.get("/api/health").status_code == 200
            history = client.get("/api/prices/AAPL/history")
        assert history.status_code == 200
        assert history.json() == {"ticker": "AAPL", "points": []}


class TestDevCors:
    def test_no_cors_headers_by_default(self, recording):
        app, _ = recording()
        with TestClient(app) as client:
            resp = client.get("/api/watchlist", headers={"Origin": "http://localhost:3000"})
        assert resp.status_code == 200
        assert "access-control-allow-origin" not in resp.headers

    def test_preflight_allowed_when_configured(self, recording):
        app, _ = recording(dev_cors_origin="http://localhost:3000")
        with TestClient(app) as client:
            resp = client.options(
                "/api/watchlist/AAPL",
                headers={
                    "Origin": "http://localhost:3000",
                    "Access-Control-Request-Method": "DELETE",
                },
            )
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:3000"
