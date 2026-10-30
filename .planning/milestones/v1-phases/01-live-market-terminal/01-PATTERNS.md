# Phase 1: Live Market Terminal - Pattern Map

**Mapped:** 2026-10-26
**Files analyzed:** ~45 (backend ~20, frontend ~22, packaging 6)
**Analogs found:** 18 / ~45 (all backend; frontend and packaging have no in-repo analog: `frontend/`, `test/`, `scripts/` are empty/untracked)

All analog paths below are git-tracked (`git ls-files backend/app backend/tests` verified).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `backend/pyproject.toml` / `uv.lock` (modify: fastapi>=0.135, python-dotenv, starlette upgrade) | config | - | itself | exact |
| `backend/app/main.py` (`create_app` + `lifespan`) | entry/provider | request-response + background | `backend/app/market/stream.py` (factory, no module state) + `simulator.py` start/stop | role-match |
| `backend/app/config.py` (`Settings.from_env`) | config | env read | `backend/app/market/factory.py` (`_poll_interval`, env `.strip()`) | exact |
| `backend/app/errors.py` | utility | request-response | none (RESEARCH Pattern 6) | none |
| `backend/app/db/__init__.py` (`Database`) | utility/model | CRUD | none (RESEARCH Pattern 3) | none |
| `backend/app/db/schema.sql` | migration | - | none (PLAN §7) | none |
| `backend/app/db/seed.py` | config/data | batch | `backend/app/market/seed_prices.py` (module-level constants) | partial |
| `backend/app/tickers.py` | utility | transform | `simulator._normalize` / `stream.py:54` | partial |
| `backend/app/tracker.py` (`TickerTracker.reconcile`) | service | event-driven | `backend/app/market/interface.py` contract + `simulator.py` add/remove | role-match |
| `backend/app/snapshots.py` (loop) | service | background | `SimulatorDataSource._run_loop` / `stop` (simulator.py:234-289) | exact |
| `backend/app/watchlist/repo.py` | model | CRUD | none | none |
| `backend/app/watchlist/service.py` | service | CRUD | `backend/app/market/cache.py` (lock-guarded state) | partial |
| `backend/app/api/watchlist.py` | route | request-response | `backend/app/market/stream.py` `create_stream_router` | exact |
| `backend/app/api/system.py` | route | request-response | `backend/app/market/stream.py` | exact |
| `backend/tests/conftest.py` (modify: settings/app/client fixtures) | test | - | `backend/tests/conftest.py` (docstring only) | - |
| `backend/tests/test_config.py` | test | - | `backend/tests/market/test_factory.py` (`patch.dict`) | exact |
| `backend/tests/test_db.py`, `test_tracker.py`, `test_snapshots.py` | test | - | `backend/tests/market/test_simulator_source.py` | role-match |
| `backend/tests/api/test_watchlist.py`, `test_system.py`, `test_static.py` | test | request-response | `backend/tests/market/test_stream.py` `TestHistoryEndpoint` | exact |
| `frontend/**` (Next.js scaffold, stores, stream, components, Vitest) | component/store/hook | streaming + request-response | none | none |
| `Dockerfile`, `docker-compose.yml`, `scripts/*.sh`, `scripts/*.ps1` | config | - | none (`.dockerignore`, `.gitattributes`, `.env.example` exist as constraints) | none |
| `.env.example` (modify: commented `DEV_CORS_ORIGIN`) | config | - | itself | exact |

## Pattern Assignments

### `backend/app/api/watchlist.py`, `backend/app/api/system.py` (route, request-response)

**Analog:** `backend/app/market/stream.py`

Module header + imports (lines 1-16):
```python
"""SSE price stream and price-history endpoint."""

from __future__ import annotations

import asyncio
import json
import logging
...
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .cache import PriceCache

logger = logging.getLogger(__name__)
```
Router factory (lines 22-27, 51-60) - copy this shape for `create_watchlist_router(service, cache)` and `create_system_router()`:
```python
def create_stream_router(price_cache: PriceCache) -> APIRouter:
    """Create the market data router (SSE stream + price history).

    Builds a new router per call, bound to `price_cache` (no module-level state).
    """
    router = APIRouter(tags=["market"])

    @router.get("/api/prices/{ticker}/history")
    async def price_history(ticker: str) -> dict:
        """Last ~5 minutes of prices for one ticker (empty for untracked)."""
        symbol = ticker.strip().upper()
        return {...}

    return router
```
Phase-specific: routes are `async def`; POST returns `JSONResponse(entry, status_code=201 if created else 200)`; DELETE returns `Response(status_code=204)`; body model `WatchlistAdd(BaseModel): ticker: str` with NO `pattern=` (malformed must be 400 via `DomainError`, not 422). Price/open come from `PriceCache.get()` -> `PriceUpdate | None` (RESEARCH Pattern 5 `_entry`).

---

### `backend/app/config.py` (config, env read)

**Analog:** `backend/app/market/factory.py`

Env read at point of use (line 29): `api_key = os.environ.get("MASSIVE_API_KEY", "").strip()`

Validating helper with warning fallback (lines 44-65):
```python
def _poll_interval() -> float:
    """Read MASSIVE_POLL_INTERVAL (seconds).

    Blank → default. Invalid, NaN or infinite → default with a warning.
    """
    raw = os.environ.get("MASSIVE_POLL_INTERVAL", "").strip()
    if not raw:
        return DEFAULT_POLL_INTERVAL
    ...
        logger.warning("Invalid MASSIVE_POLL_INTERVAL %r; using %ss", raw, DEFAULT_POLL_INTERVAL)
```
Constants with unit comments (lines 16-17): `DEFAULT_POLL_INTERVAL = 15.0  # suits the free tier's 5 calls/min`.
Phase-specific: frozen dataclass; `load_dotenv(REPO_ROOT / ".env", override=False)` must run inside `from_env()` BEFORE `create_market_data_source` (factory reads env at line 29). `DB_PATH`, `STATIC_DIR`, `DEV_CORS_ORIGIN` empty -> unset. Secrets later `field(repr=False)`. Configure `logging.basicConfig` once (RESEARCH Pattern 2).

---

### `backend/app/snapshots.py` (service, background loop) and lifespan task handling in `main.py`

**Analog:** `backend/app/market/simulator.py`

Task creation (line 245): `self._task = asyncio.create_task(self._run_loop(), name="simulator-loop")` -> use `name="snapshot-loop"`.

Stop/cancel (lines 248-256):
```python
    async def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None
        logger.info("Simulator stopped")
```
Loop body (lines 279-289): `while True:` ... `except Exception: logger.exception("Simulator step failed")` then `await asyncio.sleep(self._interval)`. Do not catch `CancelledError` inside the loop. For snapshots: sleep first, then `record()`; log `"Snapshot failed"`. Valuation stays a pure function (Phase 2 reuse).

---

### `backend/app/main.py` (entry, lifespan)

**Analogs:** `stream.py` (factory, constructor injection) + `simulator.py` (start/stop). Assemble per RESEARCH Pattern 1 (`create_app(settings=None, *, source_factory=None)`, run `uvicorn app.main:create_app --factory --workers 1`). No module-level `app`. Router order: stream -> watchlist -> system -> `/api/{path:path}` catch-all (all methods) -> `StaticFiles(html=True)` mounted last only if `index.html` exists. CORS only when `settings.dev_cors_origin`. No GZip (buffers SSE).

Public import surface to use (`backend/app/market/__init__.py`): `from app.market import PriceCache, MarketDataSource, create_market_data_source, create_stream_router` (inside package: `from .market import ...`).

---

### `backend/app/tracker.py` (service, reconcile)

**Analog:** `backend/app/market/interface.py` + `simulator.py:258-277`. Simulator `add_ticker` seeds cache immediately; `remove_ticker` calls `cache.remove`; `get_tickers()` returns `[]` before start. `reconcile()`: `desired = set(await asyncio.to_thread(db.tracked_tickers))`, `current = set(source.get_tickers())`; await add/remove on the event loop (never in `to_thread` - simulator is not thread-safe). Tracker is the only caller of `add_ticker`/`remove_ticker`.

---

### `backend/app/tickers.py` (utility)

**Analog:** normalization in `stream.py:54` (`ticker.strip().upper()`) and `simulator._normalize`. Add `TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")` and `normalize_ticker(raw) -> str` raising `DomainError` (400).

---

### `backend/app/db/seed.py`

**Analog:** `backend/app/market/seed_prices.py` (UPPER_SNAKE module constants). Constants: `DEFAULT_USER_ID = "default"`, `DEFAULT_CASH = 10000.0`, `DEFAULT_WATCHLIST = [AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX]`. Seed watchlist ONLY when the user row is newly inserted (RESEARCH Pitfall 1), else removed defaults come back on restart.

---

### `backend/app/db/__init__.py`, `schema.sql`, `watchlist/repo.py`, `errors.py`, `watchlist/service.py`

No in-repo analog; copy RESEARCH Patterns 3, 5, 6 verbatim (connection-per-unit-of-work, `BEGIN IMMEDIATE` transaction, `isolation_level=None`, WAL, ISO `"%Y-%m-%dT%H:%M:%SZ"`; service `asyncio.Lock`, dup check before 50-cap check). Lock-guarded style mirrors `PriceCache` (`backend/app/market/cache.py`, `with self._lock:`), but use `asyncio.Lock` here. Wire shapes: explicit dicts/`to_dict()` in fixed order like `models.py:53-64`.

---

### Backend tests

**API tests analog:** `backend/tests/market/test_stream.py` lines 119-123:
```python
class TestHistoryEndpoint:
    def _client(self, cache):
        app = FastAPI()
        app.include_router(create_stream_router(cache))
        return TestClient(app)
```
For full-app tests use `with TestClient(create_app(Settings(db_path=tmp_path/...), source_factory=...)) as c:` so lifespan runs.

**Env tests analog:** `backend/tests/market/test_factory.py` line 19: `with patch.dict(os.environ, {}, clear=True):`.

**Fakes analog:** `FakeRequest` class in `test_stream.py:14-31` - hand-written fakes over mocks; tests import absolute `from app.xxx import ...`; classes named `Test*`.

## Shared Patterns

### Module header / typing (all backend files)
Source: every `backend/app/market/*.py`. One-line module docstring, blank line, `from __future__ import annotations`, stdlib / third-party / relative imports (ruff `I`), `logger = logging.getLogger(__name__)`. PEP 604 unions, `collections.abc` types.

### Logging
`%s` lazy format with component prefix, e.g. `logger.info("SSE client connected: %s", client_ip)` (stream.py:80); `logger.exception` in broad excepts; never log key values.

### No module-level state / constructor injection
Source: `stream.py:22-27` docstring "no module-level state". Applies to all routers, services, `create_app`.

### Blocking work off the loop
`await asyncio.to_thread(...)` for all sqlite calls (convention from `massive_client._poll_once`). Market source calls stay on the loop.

### Error envelope
400 `{"error": msg}` via `DomainError`, 404 via `NotFoundError` and the `/api/*` catch-all; leave default 422. (RESEARCH Pattern 6.)

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `frontend/` entire project (`next.config.ts`, `postcss.config.mjs`, `vitest.config.mts`, `src/app/*`, `src/api/{client,types,ticker,watchlist}.ts`, `src/stream/priceStream.ts`, `src/store/{prices,watchlist,ui}.ts`, `src/domain/*`, `src/components/**`, `src/test/FakeEventSource.ts`, `frontend/CLAUDE.md`, `.env.development`) | component/store/stream | SSE streaming + REST | `frontend/` is empty and untracked. Use RESEARCH Patterns 7-12 (state machine, replace-not-merge store, keyed-span flash, sparkPoints, Lightweight Charts AreaSeries v5) |
| `Dockerfile`, `docker-compose.yml` | config | - | Not present; follow RESEARCH Dockerfile/compose examples; respect existing `.dockerignore` |
| `scripts/start_mac.sh`, `stop_mac.sh`, `start_windows.ps1`, `stop_windows.ps1` | config/script | - | Not present; `.sh` needs `git update-index --chmod=+x`; `.ps1` ASCII-only, CRLF per `.gitattributes` |
| `backend/app/db/*`, `errors.py`, `watchlist/repo.py` | model/utility | CRUD | No DB/error code exists; use RESEARCH Patterns 3, 6 |

## Metadata

**Analog search scope:** `backend/app/`, `backend/tests/` (only tracked source in repo)
**Files scanned:** 8
**Pattern extraction date:** 2026-10-26
