"""Tests for watchlist add/remove: normalization, status codes, the 50 cap and concurrency."""

import asyncio
import re
import sqlite3
import uuid
from contextlib import closing

import pytest
from fastapi.testclient import TestClient

from app.db import DEFAULT_WATCHLIST, Database, now_iso
from app.errors import DomainError, NotFoundError
from app.market import PriceCache
from app.market.simulator import SimulatorDataSource
from app.tickers import TICKER_RE, normalize_ticker
from app.tracker import TickerTracker
from app.watchlist import WATCHLIST_CAP, WatchlistService

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
ENTRY_KEYS = ["ticker", "price", "open_price", "added_at"]


def run_sql(db_path: str, sql: str, params: tuple = ()) -> list[tuple]:
    with closing(sqlite3.connect(db_path)) as conn:
        rows = conn.execute(sql, params).fetchall()
        conn.commit()
    return rows


def watched(db_path: str) -> list[str]:
    return [r[0] for r in run_sql(db_path, "SELECT ticker FROM watchlist ORDER BY added_at, rowid")]


def insert_tickers(db_path: str, tickers: list[str]) -> None:
    for ticker in tickers:
        run_sql(
            db_path,
            "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, 'default', ?, ?)",
            (str(uuid.uuid4()), ticker, now_iso()),
        )


def fillers(n: int) -> list[str]:
    """`n` valid, distinct tickers that are not in the default watchlist."""
    return [f"T{i:02d}" for i in range(n)]


@pytest.fixture
def recording_client(make_app, recording_source):
    """A started app on a RecordingSource; yields (client, source)."""
    source = recording_source()
    with TestClient(make_app(source_factory=lambda cache: source)) as test_client:
        yield test_client, source


class TestNormalizeTicker:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            (" aapl ", "AAPL"),
            ("AAPL", "AAPL"),
            ("BRK.B", "BRK.B"),
            ("brk.b", "BRK.B"),
            ("A", "A"),
            ("ABCDEFGHIJ", "ABCDEFGHIJ"),
            ("\tmsft\n", "MSFT"),
        ],
    )
    def test_valid(self, raw, expected):
        assert normalize_ticker(raw) == expected

    @pytest.mark.parametrize("raw", ["", "   ", "\t"])
    def test_empty_is_required(self, raw):
        with pytest.raises(DomainError) as exc:
            normalize_ticker(raw)
        assert exc.value.message == "Ticker is required."

    @pytest.mark.parametrize("raw", ["1ABC", "AAPL!", "TOOLONGTICK", "A-B", ".A", "A B"])
    def test_malformed(self, raw):
        with pytest.raises(DomainError) as exc:
            normalize_ticker(raw)
        assert "Invalid ticker" in exc.value.message

    @pytest.mark.parametrize("raw", ["ß", "aß", "ÄPPL", "ＡＡＰＬ"])
    def test_non_ascii_rejected_before_uppercasing(self, raw):
        # "aß".upper() == "ASS" would pass the regex if uppercased first
        with pytest.raises(DomainError):
            normalize_ticker(raw)

    def test_regex_is_plan_rule(self):
        assert TICKER_RE.pattern == r"^[A-Z][A-Z0-9.]{0,9}$"


class TestAdd:
    def test_new_ticker_created_and_priced(self, client, settings):
        resp = client.post("/api/watchlist", json={"ticker": "pypl"})
        assert resp.status_code == 201
        entry = resp.json()
        assert list(entry.keys()) == ENTRY_KEYS
        assert entry["ticker"] == "PYPL"
        assert isinstance(entry["price"], float)
        assert isinstance(entry["open_price"], float)
        assert ISO_RE.match(entry["added_at"])
        tickers = client.get("/api/watchlist").json()["tickers"]
        assert tickers[-1]["ticker"] == "PYPL"
        assert "PYPL" in client.app.state.source.get_tickers()

    def test_duplicate_returns_existing_with_200(self, client, settings):
        first = client.post("/api/watchlist", json={"ticker": "PYPL"}).json()
        resp = client.post("/api/watchlist", json={"ticker": " pypl "})
        assert resp.status_code == 200
        assert resp.json()["ticker"] == "PYPL"
        assert resp.json()["added_at"] == first["added_at"]
        assert watched(settings.db_path).count("PYPL") == 1
        assert len(watched(settings.db_path)) == len(DEFAULT_WATCHLIST) + 1

    def test_default_ticker_readd_is_200(self, recording_client, settings):
        client, source = recording_client
        resp = client.post("/api/watchlist", json={"ticker": "aapl"})
        assert resp.status_code == 200
        assert resp.json()["ticker"] == "AAPL"
        assert source.added == []

    @pytest.mark.parametrize("ticker", ["AAPL!", "1ABC", "TOOLONGTICK", "", "   ", "aß"])
    def test_malformed_is_400(self, recording_client, settings, ticker):
        client, _ = recording_client
        resp = client.post("/api/watchlist", json={"ticker": ticker})
        assert resp.status_code == 400
        body = resp.json()
        assert list(body.keys()) == ["error"]
        assert isinstance(body["error"], str) and body["error"]
        assert len(watched(settings.db_path)) == len(DEFAULT_WATCHLIST)

    @pytest.mark.parametrize("body", [{}, {"ticker": 5}, {"ticker": None}, {"symbol": "AAPL"}])
    def test_missing_or_wrong_type_is_422(self, recording_client, body):
        client, _ = recording_client
        assert client.post("/api/watchlist", json=body).status_code == 422


class TestRemove:
    def test_remove_then_404(self, client):
        client.post("/api/watchlist", json={"ticker": "PYPL"})
        resp = client.delete("/api/watchlist/PYPL")
        assert resp.status_code == 204
        assert resp.content == b""
        assert "PYPL" not in client.app.state.source.get_tickers()
        assert client.app.state.cache.get("PYPL") is None
        tickers = [t["ticker"] for t in client.get("/api/watchlist").json()["tickers"]]
        assert "PYPL" not in tickers

        again = client.delete("/api/watchlist/PYPL")
        assert again.status_code == 404
        assert again.json() == {"error": "PYPL is not on your watchlist"}

    def test_path_ticker_is_normalized(self, recording_client):
        client, source = recording_client
        assert client.delete("/api/watchlist/aapl").status_code == 204
        assert "AAPL" not in source.get_tickers()
        assert source.removed == ["AAPL"]

    def test_unwatched_ticker_is_404(self, recording_client):
        client, _ = recording_client
        resp = client.delete("/api/watchlist/ZZZZ")
        assert resp.status_code == 404
        assert resp.json() == {"error": "ZZZZ is not on your watchlist"}

    def test_malformed_path_ticker_is_400(self, recording_client):
        client, _ = recording_client
        resp = client.delete("/api/watchlist/bad!")
        assert resp.status_code == 400
        assert "error" in resp.json()

    def test_held_ticker_stays_tracked(self, client, settings):
        run_sql(
            settings.db_path,
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at) "
            "VALUES ('p1', 'AAPL', 1, 190.0, ?)",
            (now_iso(),),
        )
        assert client.delete("/api/watchlist/AAPL").status_code == 204
        assert "AAPL" in client.app.state.source.get_tickers()
        assert client.app.state.cache.get("AAPL") is not None
        assert "AAPL" not in watched(settings.db_path)


class TestCap:
    def test_cap_is_fifty(self):
        assert WATCHLIST_CAP == 50

    def test_boundary_49_then_50_then_full(self, recording_client, settings):
        client, _ = recording_client
        insert_tickers(settings.db_path, fillers(WATCHLIST_CAP - len(DEFAULT_WATCHLIST) - 1))
        assert len(watched(settings.db_path)) == 49

        assert client.post("/api/watchlist", json={"ticker": "PYPL"}).status_code == 201
        assert len(watched(settings.db_path)) == 50

        full = client.post("/api/watchlist", json={"ticker": "SQ"})
        assert full.status_code == 400
        assert "50" in full.json()["error"]
        assert len(watched(settings.db_path)) == 50

        # duplicate check runs before the cap check
        assert client.post("/api/watchlist", json={"ticker": "AAPL"}).status_code == 200
        assert client.post("/api/watchlist", json={"ticker": "pypl"}).status_code == 200


@pytest.fixture
async def service(tmp_path):
    """A WatchlistService on a started simulator; yields (service, db, source, cache)."""
    db = Database(str(tmp_path / "c.db"))
    db.init()
    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.05)
    await source.start(db.tracked_tickers())
    tracker = TickerTracker(db, source)
    svc = WatchlistService(db, cache, tracker, asyncio.Lock())
    try:
        yield svc, db, source, cache
    finally:
        await source.stop()


class TestConcurrency:
    async def test_concurrent_adds_of_same_ticker_insert_one_row(self, service):
        svc, db, source, _ = service
        results = await asyncio.gather(svc.add("ZZZ"), svc.add(" zzz "))
        assert sorted(created for _, created in results) == [False, True]
        assert all(entry["ticker"] == "ZZZ" for entry, _ in results)
        assert watched(db.path).count("ZZZ") == 1
        assert "ZZZ" in source.get_tickers()

    async def test_concurrent_adds_cannot_exceed_cap(self, service):
        svc, db, _, _ = service
        insert_tickers(db.path, fillers(WATCHLIST_CAP - len(DEFAULT_WATCHLIST) - 2))
        new = ["NEWA", "NEWB", "NEWC", "NEWD", "NEWE"]
        results = await asyncio.gather(*(svc.add(t) for t in new), return_exceptions=True)
        created = [r for r in results if not isinstance(r, BaseException)]
        failed = [r for r in results if isinstance(r, BaseException)]
        assert len(created) == 2
        assert all(isinstance(e, DomainError) for e in failed)
        assert len(watched(db.path)) == WATCHLIST_CAP

    async def test_remove_racing_add_leaves_consistent_state(self, service):
        svc, db, source, cache = service
        await asyncio.gather(svc.add("ZZZ"), svc.remove("ZZZ"), return_exceptions=True)
        is_watched = "ZZZ" in watched(db.path)
        assert ("ZZZ" in source.get_tickers()) == is_watched
        assert (cache.get("ZZZ") is not None) == is_watched
        assert set(source.get_tickers()) == set(db.tracked_tickers())

    async def test_remove_twice_raises_not_found_second_time(self, service):
        svc, _, _, _ = service
        await svc.remove("AAPL")
        with pytest.raises(NotFoundError) as exc:
            await svc.remove("aapl")
        assert exc.value.message == "AAPL is not on your watchlist"

    async def test_list_during_mutation_has_no_duplicates(self, service):
        svc, _, _, _ = service
        results = await asyncio.gather(
            svc.list_entries(), svc.add("ZZZ"), svc.list_entries(), svc.remove("MSFT")
        )
        for listing in (results[0], results[2]):
            tickers = [e["ticker"] for e in listing]
            assert len(tickers) == len(set(tickers))

    async def test_service_exposes_its_lock(self, service):
        svc, _, _, _ = service
        assert isinstance(svc.lock, asyncio.Lock)
