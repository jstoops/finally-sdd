---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
<!-- refreshed: 2026-10-23 -->

# Architecture

**Analysis Date:** 2026-10-23

## Status Summary

The repository is at an early stage. Only the market data subsystem exists as code: `backend/app/market/`. Everything else in the target architecture described in `planning/PLAN.md` is **planned but absent**:

| Planned component (PLAN.md) | Current state |
|---|---|
| FastAPI application entry point (`lifespan`, static mount, `/api/*`) | Absent. `backend/app/__init__.py` is a docstring only; no `main.py` or `app` object exists |
| `backend/app/db/` (`schema.sql`, seed, connection helpers) | Absent |
| Portfolio, trade execution, watchlist, chat, reset routes | Absent |
| LLM integration (LiteLLM → OpenRouter) | Absent |
| Portfolio snapshot timer (30 s) | Absent |
| `frontend/` Next.js static export | Absent (directory exists but is empty; not tracked by git) |
| `test/` Playwright E2E suite | Absent (directory exists but is empty; not tracked by git) |
| `Dockerfile`, `docker-compose.yml`, `scripts/`, `db/` | Absent |
| Market data subsystem (`backend/app/market/`) | Built and tested (see `planning/MARKET_DATA_SUMMARY.md`) |

Sections below describe the pattern that the existing code establishes and how the planned pieces are expected to attach to it. Items marked **(planned)** are not in the repository.

## Pattern Overview

**Overall:** Layered async service (FastAPI + asyncio) with an in-process background producer and an in-memory cache as the shared data plane. Single origin, single process, no external services at runtime.

**Key Characteristics:**
- One Python package (`app`) inside a self-contained uv project at `backend/`.
- Producer/consumer split: a single background task (simulator loop or Massive poller) writes prices into `PriceCache`; readers (SSE stream, history endpoint, later portfolio valuation and trade execution) only read from the cache.
- Abstraction at the data source: `MarketDataSource` ABC has two implementations selected by a factory from environment variables. Downstream code does not know which is active.
- Router factories instead of module-level routers: `create_stream_router(price_cache)` returns a new `APIRouter` bound to an injected cache, so there is no module-level state in the HTTP layer.
- Dependency injection by constructor: `PriceCache` takes an injectable `clock` and history limits; sources take the cache; tests inject fakes.
- Stdlib-first persistence direction: SQLite via stdlib `sqlite3` with no ORM is planned (PLAN §3, §7); no DB code exists yet.

## Layers

**Market Data Model (`backend/app/market/models.py`):**
- Purpose: Immutable value objects for prices.
- Location: `backend/app/market/models.py`
- Contains: `PriceUpdate` (frozen dataclass with `change`, `change_percent`, `session_change_percent`, `direction`, `to_dict()`), `PricePoint` (`timestamp`, `price`, `to_dict()`).
- Depends on: stdlib only.
- Used by: `cache.py`, `simulator.py`, `massive_client.py`, `stream.py`.

**Market Data Source Interface (`backend/app/market/interface.py`):**
- Purpose: Contract for any price provider.
- Location: `backend/app/market/interface.py`
- Contains: `MarketDataSource(ABC)` with async `start(tickers)`, `stop()`, `add_ticker(ticker)`, `remove_ticker(ticker)`, and sync `get_tickers()`.
- Depends on: nothing inside the package.
- Used by: `factory.py`, `simulator.py`, `massive_client.py`, and (planned) the watchlist and trade code paths in the API layer.

**Market Data Sources (producers):**
- Purpose: Produce price ticks and write them to the cache on a background task.
- Location: `backend/app/market/simulator.py` (`GBMSimulator`, `SimulatorDataSource`), `backend/app/market/massive_client.py` (`MassiveDataSource`), `backend/app/market/seed_prices.py` (seed prices and per-ticker drift/volatility).
- Contains: GBM math with correlated moves via Cholesky decomposition and random events (simulator); REST polling with `asyncio.to_thread` around a blocking `massive` client call, with LIVE and EOD modes (Massive).
- Depends on: `PriceCache`, `MarketDataSource`; `numpy` (simulator); `massive` SDK (Massive client).
- Used by: `factory.py` only. The app entry point (planned) will call the factory during `lifespan`.

**Shared Price Cache (`backend/app/market/cache.py`):**
- Purpose: Single source of truth for latest prices, session open prices, a 5-minute history ring buffer per ticker, and a monotonic change counter.
- Location: `backend/app/market/cache.py`
- Contains: `PriceCache` with `update()`, `remove()`, `get()`, `get_price()`, `get_all()`, `get_history()`, `version`.
- Depends on: `models.py`.
- Used by: sources (writers); `stream.py` (readers). Planned readers: portfolio valuation, trade execution, watchlist response, LLM context.
- Concurrency: guarded by a `threading.Lock`, because the Massive poller performs fetches in a worker thread via `asyncio.to_thread` and the cache is shared across threads and the event loop.

**Transport / HTTP Adapter (`backend/app/market/stream.py`):**
- Purpose: Expose the cache over HTTP.
- Location: `backend/app/market/stream.py`
- Contains: `create_stream_router(price_cache) -> APIRouter` with `GET /api/stream/prices` (SSE) and `GET /api/prices/{ticker}/history`.
- Depends on: `PriceCache`, FastAPI.
- Used by: the app entry point (planned), which must `include_router` it. Note: nothing mounts this router yet because no app object exists.

**Application Layer (planned):**
- Purpose: Lifespan startup, routes for portfolio, trades, watchlist, chat, reset, health; static file serving of the Next.js export.
- Location: **(planned)** `backend/app/main.py` or similar; `backend/app/db/` for schema and seed.
- Depends on: market subsystem, sqlite3, LiteLLM.

**Presentation (planned):**
- Purpose: Terminal-style UI consuming `/api/*` and `/api/stream/*`.
- Location: **(planned)** `frontend/` (Next.js, TypeScript, Tailwind, `output: 'export'`).
- Depends on: REST and SSE endpoints only; no Python knowledge.

## Data Flow

### Price Tick Path (implemented)

1. `SimulatorDataSource._run_loop` (`backend/app/market/simulator.py`) calls `GBMSimulator.step()` every ~500 ms, producing a price per tracked ticker.
2. Each price is written with `PriceCache.update(ticker, price)` (`backend/app/market/cache.py`), which sets previous price, establishes the session open price on first sight, appends to the history deque (trimmed to 300 s / 600 points), and bumps `version`.
3. Massive path: `MassiveDataSource._poll_loop` sleeps `poll_interval`, runs `_poll_once`, which calls `asyncio.to_thread(self._fetch, tickers)` (`backend/app/market/massive_client.py`), then writes results into the cache on the event loop thread.
4. `_generate_events` in `backend/app/market/stream.py` polls `price_cache.version` every 0.5 s per connected client. On change it serializes `get_all()` into one JSON object keyed by ticker and yields `data: ...`. A `: keep-alive` comment is sent after 15 s of silence. The first frame is `retry: 1000`.
5. The browser's `EventSource` (planned frontend) receives the frame.

### Price History Path (implemented)

1. Client calls `GET /api/prices/{ticker}/history`.
2. Handler normalizes the symbol (`strip().upper()`), calls `PriceCache.get_history()` (`backend/app/market/cache.py`), returns `{"ticker", "points"}`. Unknown tickers yield empty `points`.

### Tracked-Ticker Lifecycle (contract, partly implemented)

- Source is started with the tracked set (watchlist ∪ held positions, PLAN §6). `add_ticker` and `remove_ticker` are implemented on both sources; `remove_ticker` also clears session open and history in the cache.
- Callers must only call `remove_ticker` when no position is held (documented in `backend/CLAUDE.md`). The enforcing caller is **(planned)**.

### Planned Request Paths (from PLAN.md, not implemented)

- Startup (`lifespan`): create schema and seed (idempotent), start market source with watchlist ∪ positions, record initial snapshot, start 30 s snapshot task.
- Trade: validate ticker and quantity, read price from cache, transactional update of cash, position, and trade log, then snapshot, then return updated portfolio.
- Chat: store user message, build portfolio context from cache and DB, call LLM via LiteLLM/OpenRouter with structured output, execute watchlist changes then trades independently, append failure notes, store assistant message, return it.

**State Management:**
- Server-side market state lives only in the process: `PriceCache` (prices, history, versions) and each source's internal state (`GBMSimulator` tickers and Cholesky matrix, Massive EOD cache).
- Persistent state (cash, positions, trades, snapshots, chat) is planned for SQLite at `DB_PATH`. Not implemented.
- Client state is planned to be computed client-side from SSE plus `/api/portfolio`.

## Key Abstractions

**`MarketDataSource`:**
- Purpose: Swappable price provider.
- Examples: `backend/app/market/interface.py`, `backend/app/market/simulator.py` (`SimulatorDataSource`), `backend/app/market/massive_client.py` (`MassiveDataSource`).
- Pattern: Abstract base class with async lifecycle methods; implementations own one background `asyncio.Task` named `simulator-loop` or `massive-poller`, cancelled in `stop()`.

**`PriceCache`:**
- Purpose: Concurrency-safe shared store with change detection.
- Examples: `backend/app/market/cache.py`.
- Pattern: Lock-guarded dicts plus `deque(maxlen)` per ticker; `version` counter as a cheap change signal for SSE. Timestamps are forced strictly increasing per ticker.

**`PriceUpdate` / `PricePoint`:**
- Purpose: Immutable transport objects with wire format defined in `to_dict()`.
- Examples: `backend/app/market/models.py`.
- Pattern: Frozen dataclasses; `timestamp` is Unix seconds (float) on the SSE and history wire, while REST and DB timestamps are ISO 8601 per PLAN §7.

**Router factory:**
- Purpose: Mount market routes onto any app with an injected cache.
- Examples: `create_stream_router` in `backend/app/market/stream.py`.
- Pattern: `create_*_router(dependency) -> APIRouter`, with no module-level state. Apply the same pattern to the planned portfolio, watchlist, and chat routers.

**Source factory:**
- Purpose: Environment-driven selection.
- Examples: `create_market_data_source` in `backend/app/market/factory.py`.
- Pattern: `MASSIVE_API_KEY` non-empty selects Massive, polling at `MASSIVE_POLL_INTERVAL` (default 15, minimum 1, invalid values fall back with a warning); otherwise the simulator. Returns an unstarted source; the caller awaits `start(tickers)`.

## Entry Points

**Market subsystem public API:**
- Location: `backend/app/market/__init__.py`
- Exports: `PricePoint`, `PriceUpdate`, `PriceCache`, `MarketDataSource`, `create_market_data_source`, `create_stream_router`.
- Triggers: imported by the app entry point (planned) and tests.

**Standalone demo:**
- Location: `backend/market_data_demo.py`
- Triggers: `uv run --extra dev market_data_demo.py` from `backend/`.
- Responsibilities: runs a simulator-backed terminal dashboard; the only runnable program in the repo.

**Application server (planned):**
- Location: **(planned)** `backend/app/main.py`, to be run by `uvicorn` in the Dockerfile CMD (PLAN §11).
- Responsibilities: lifespan startup, router mounting, static file serving on port 8000.

## Architectural Constraints

- **Threading:** The event loop runs the simulator loop, SSE generators, and cache writes from Massive polls. Massive network I/O runs in a worker thread (`asyncio.to_thread`). `PriceCache` is therefore accessed from multiple threads and uses a `threading.Lock`. Any new blocking SDK or DB call inside an async route must be moved off the loop the same way.
- **Global state:** None at module level in `app/market/`. Routers are built per call. Keep it that way for planned routers.
- **Single process, single cache:** `PriceCache` is process-local. Multiple uvicorn workers would each run their own market source and price stream, so the server must run with one worker. This is consistent with PLAN §3's single-container design.
- **Circular imports:** None detected. Dependency direction inside `app/market/` is `models` ← `cache` ← `{simulator, massive_client, stream}` ← `factory` ← `__init__`. `interface` is imported by sources and factory.
- **Test-only clock:** `PriceCache` accepts `clock` for tests; production uses `time.time`.
- **Trade-side price rule (planned):** trades must read from `PriceCache`, not from the source, so one price path serves both SSE and execution.

## Anti-Patterns

### Module-level app or router state

**What happens:** Not present today. The risk is that the planned API layer creates one global `PriceCache` and a global router at import time.
**Why it's wrong:** Tests and future multi-user work need isolated instances. Import-time side effects also start background tasks in the wrong place.
**Do this instead:** Build the cache and source in the lifespan hook and pass them into `create_stream_router(price_cache)` and the other router factories (see `backend/app/market/stream.py`).

### Blocking calls on the event loop

**What happens:** Not present in market code, which correctly uses `asyncio.to_thread` in `backend/app/market/massive_client.py`.
**Why it's wrong:** A blocking `sqlite3` or HTTP call on the loop stalls SSE streams and the simulator.
**Do this instead:** Use `asyncio.to_thread` for blocking work, or keep DB calls in short synchronous functions called from sync route handlers (FastAPI runs those in a threadpool).

### Writing to `PriceCache` from routes

**What happens:** Not present. Only sources should call `update()` and `remove()`.
**Why it's wrong:** It bypasses the source's tick model and the tracked-ticker invariants.
**Do this instead:** Call `source.add_ticker()` and `source.remove_ticker()` from watchlist and trade code, as PLAN §6 specifies.

## Error Handling

**Strategy (market subsystem):** Log and continue. Simulator step failures are caught in `_run_loop` and logged with `logger.exception`, so the loop survives. Massive poll failures are handled inside `_poll_once` with per-poll logging, and EOD fallback is used for keys without snapshot entitlement (`is_not_entitled` in `massive_client.py`). `stream.py` ends the generator on client disconnect via `request.is_disconnected()` and a `finally` block.

**Strategy (planned API):** Business-rule failures return `400 {"error": ...}`, not-found returns `404`, malformed bodies use FastAPI's `422`, LLM failures return `502`, and missing `OPENROUTER_API_KEY` returns `503` (PLAN §5, §8).

## Cross-Cutting Concerns

**Logging:** Standard library `logging`, one logger per module via `logging.getLogger(__name__)`. Info-level on source selection and SSE client connect/disconnect.
**Validation:** Ticker normalization in sources and `/api/prices/{ticker}/history`. Ticker regex `^[A-Z][A-Z0-9.]{0,9}$` and quantity rules are planned for trade code (PLAN §7).
**Authentication:** None by design (single-user, no login, PLAN §1).
**Configuration:** Environment variables read via `os.environ` in `factory.py`. `python-dotenv` loading from `../.env` is planned for local dev. Not yet wired.

---

*Architecture analysis: 2026-10-23*
