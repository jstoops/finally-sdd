"""Shared pytest fixtures: settings, app builders, a live client and a fake market source.

Fixtures only; tests never import this module directly.
"""

from __future__ import annotations

import dataclasses
import threading
from collections.abc import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.market import MarketDataSource, PriceCache
from app.market.simulator import SimulatorDataSource


class RecordingSource(MarketDataSource):
    """Fake source: records lifecycle and ticker calls and never writes the cache."""

    def __init__(self) -> None:
        self.started: list[list[str]] = []
        self.stopped = 0
        self.added: list[str] = []
        self.removed: list[str] = []
        self.call_threads: set[int] = set()
        self._tickers: list[str] = []

    async def start(self, tickers: list[str]) -> None:
        self.started.append(list(tickers))
        self._tickers = list(tickers)

    async def stop(self) -> None:
        self.stopped += 1

    async def add_ticker(self, ticker: str) -> None:
        self.call_threads.add(threading.get_ident())
        self.added.append(ticker)
        if ticker not in self._tickers:
            self._tickers.append(ticker)

    async def remove_ticker(self, ticker: str) -> None:
        self.call_threads.add(threading.get_ident())
        self.removed.append(ticker)
        if ticker in self._tickers:
            self._tickers.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)


def simulator_factory(cache: PriceCache) -> MarketDataSource:
    """A fast simulator source for tests (50 ms ticks)."""
    return SimulatorDataSource(price_cache=cache, update_interval=0.05)


@pytest.fixture
def settings(tmp_path) -> Settings:
    """Settings on a per-test SQLite file with no frontend build."""
    return Settings(db_path=str(tmp_path / "t.db"), static_dir=str(tmp_path / "no-static"))


@pytest.fixture
def make_app(settings) -> Callable[..., FastAPI]:
    """Factory: build an app on the test settings. Defaults to the fast simulator.

    Extra keyword arguments pass through to `create_app` (e.g. `snapshot_interval`).
    """

    def _make(
        *,
        static_dir: str | None = None,
        source_factory: Callable[[PriceCache], MarketDataSource] | None = None,
        dev_cors_origin: str | None = None,
        **kwargs,
    ) -> FastAPI:
        app_settings = dataclasses.replace(
            settings,
            static_dir=static_dir or settings.static_dir,
            dev_cors_origin=dev_cors_origin,
        )
        return create_app(app_settings, source_factory=source_factory or simulator_factory, **kwargs)

    return _make


@pytest.fixture
def client(make_app) -> Iterator[TestClient]:
    """A started app (lifespan run) backed by the fast simulator; `client.app` is the app."""
    with TestClient(make_app()) as test_client:
        yield test_client


@pytest.fixture
def recording_source() -> type[RecordingSource]:
    """The RecordingSource class: call it to build a fresh fake source."""
    return RecordingSource
