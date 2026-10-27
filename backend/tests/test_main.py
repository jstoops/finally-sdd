"""Tests for the app factory: lifespan startup, seed-once, watchlist and static serving."""

import re
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.db import DEFAULT_WATCHLIST, Database
from app.main import create_app
from app.market import MarketDataSource, PriceCache
from app.market.simulator import SimulatorDataSource

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
SIX_TABLES = {
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
}


class RecordingSource(MarketDataSource):
    """Fake source: records lifecycle calls and never writes the cache."""

    def __init__(self) -> None:
        self.started: list[list[str]] = []
        self.stopped = 0
        self._tickers: list[str] = []

    async def start(self, tickers: list[str]) -> None:
        self.started.append(list(tickers))
        self._tickers = list(tickers)

    async def stop(self) -> None:
        self.stopped += 1

    async def add_ticker(self, ticker: str) -> None:
        if ticker not in self._tickers:
            self._tickers.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        if ticker in self._tickers:
            self._tickers.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)


def make_app(tmp_path: Path, *, static_dir: str | None = None, source_factory=None):
    settings = Settings(
        db_path=str(tmp_path / "t.db"),
        static_dir=static_dir or str(tmp_path / "no-static"),
        dev_cors_origin=None,
    )
    if source_factory is None:

        def source_factory(cache: PriceCache) -> MarketDataSource:
            return SimulatorDataSource(price_cache=cache, update_interval=0.05)

    return create_app(settings, source_factory=source_factory)


def recording(tmp_path: Path, **kwargs):
    """Build an app with a RecordingSource; returns (app, source)."""
    source = RecordingSource()
    app = make_app(tmp_path, source_factory=lambda cache: source, **kwargs)
    return app, source


def run_sql(tmp_path: Path, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(tmp_path / "t.db")) as conn:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()
    return rows


class TestWatchlist:
    def test_defaults_in_plan_order_with_prices(self, tmp_path):
        with TestClient(make_app(tmp_path)) as client:
            resp = client.get("/api/watchlist")
        assert resp.status_code == 200
        tickers = resp.json()["tickers"]
        assert [t["ticker"] for t in tickers] == list(DEFAULT_WATCHLIST)
        for entry in tickers:
            assert list(entry.keys()) == ["ticker", "price", "open_price", "added_at"]
            assert isinstance(entry["price"], float)
            assert isinstance(entry["open_price"], float)
            assert ISO_RE.match(entry["added_at"])

    def test_prices_match_cache_without_rerounding(self, tmp_path):
        source = RecordingSource()
        app = make_app(tmp_path, source_factory=lambda cache: source)
        with TestClient(app) as client:
            app.state.cache.update("AAPL", 190.123)  # cache rounds to 190.12
            entry = client.get("/api/watchlist").json()["tickers"][0]
        assert entry["ticker"] == "AAPL"
        assert entry["price"] == app.state.cache.get("AAPL").price == 190.12
        assert entry["open_price"] == 190.12

    def test_unpriced_tickers_have_null_prices(self, tmp_path):
        app, _ = recording(tmp_path)
        with TestClient(app) as client:
            tickers = client.get("/api/watchlist").json()["tickers"]
        assert len(tickers) == 10
        assert all(t["price"] is None and t["open_price"] is None for t in tickers)


class TestLifespan:
    def test_seeds_default_user(self, tmp_path):
        app, _ = recording(tmp_path)
        with TestClient(app):
            pass
        rows = run_sql(tmp_path, "SELECT id, cash_balance FROM users_profile")
        assert rows == [("default", 10000.0)]

    def test_creates_all_six_tables(self, tmp_path):
        app, _ = recording(tmp_path)
        with TestClient(app):
            pass
        names = {
            r[0] for r in run_sql(tmp_path, "SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert SIX_TABLES <= names

    def test_starts_source_with_watchlist_and_stops_it(self, tmp_path):
        app, source = recording(tmp_path)
        with TestClient(app):
            assert source.started == [list(DEFAULT_WATCHLIST)]
        assert source.stopped == 1

    def test_seed_once_removed_default_stays_removed(self, tmp_path):
        app, _ = recording(tmp_path)
        with TestClient(app):
            pass
        run_sql(tmp_path, "DELETE FROM watchlist WHERE ticker = ?", ("AAPL",))

        app2, source2 = recording(tmp_path)
        with TestClient(app2) as client:
            tickers = [t["ticker"] for t in client.get("/api/watchlist").json()["tickers"]]
        assert tickers == [t for t in DEFAULT_WATCHLIST if t != "AAPL"]
        assert source2.started == [tickers]
        assert run_sql(tmp_path, "SELECT COUNT(*) FROM users_profile") == [(1,)]
        names = {
            r[0] for r in run_sql(tmp_path, "SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert SIX_TABLES <= names

    def test_empty_watchlist_starts_with_no_tickers(self, tmp_path):
        app, _ = recording(tmp_path)
        with TestClient(app):
            pass
        run_sql(tmp_path, "DELETE FROM watchlist")

        app2, source2 = recording(tmp_path)
        with TestClient(app2) as client:
            resp = client.get("/api/watchlist")
        assert source2.started == [[]]
        assert resp.json() == {"tickers": []}

    def test_held_ticker_on_watchlist_tracked_once(self, tmp_path):
        app, _ = recording(tmp_path)
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

        app2, source2 = recording(tmp_path)
        with TestClient(app2):
            pass
        started = source2.started[0]
        assert started.count("AAPL") == 1
        assert started == [*DEFAULT_WATCHLIST, "PYPL"]


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
    def test_serves_index_html_when_present(self, tmp_path):
        static = tmp_path / "static"
        static.mkdir()
        (static / "index.html").write_text("<html><body>FinAlly test</body></html>")
        app, _ = recording(tmp_path, static_dir=str(static))
        with TestClient(app) as client:
            resp = client.get("/")
            assert resp.status_code == 200
            assert resp.headers["content-type"].startswith("text/html")
            assert "FinAlly test" in resp.text
            assert client.get("/api/watchlist").status_code == 200

    def test_api_only_without_build(self, tmp_path):
        app, _ = recording(tmp_path)
        with TestClient(app) as client:
            assert client.get("/api/watchlist").status_code == 200
            assert client.get("/").status_code == 404

    def test_serves_built_frontend(self, tmp_path):
        out = REPO_ROOT / "frontend" / "out"
        if not (out / "index.html").is_file():
            pytest.skip("frontend/out not built; run `npm --prefix frontend run build`")
        app, _ = recording(tmp_path, static_dir=str(out))
        with TestClient(app) as client:
            resp = client.get("/")
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/html")
        assert "FinAlly" in resp.text


class TestImport:
    def test_main_has_no_module_level_app(self):
        import app.main as main

        assert not hasattr(main, "app")
