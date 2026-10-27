<!-- GSD:project-start source:PROJECT.md -->

## Project

**FinAlly — AI Trading Workstation**

FinAlly (Finance Ally) is a single-container AI trading workstation. It streams live (simulated or real) market prices, lets the user trade a $10,000 simulated portfolio, and has an LLM chat copilot that analyzes positions and executes trades and watchlist changes in plain language. It looks like a dark, data-dense Bloomberg-style terminal. It is a course capstone that shows how orchestrated AI coding agents can build a production-quality full-stack app. Students run it with one Docker command and open `http://localhost:8000`, with no login and no setup.

The full product specification is `planning/PLAN.md`. This document captures the project context; PLAN.md stays the detailed contract for API shapes, schema, and behavior.

**Core Value:** A user can open one URL, watch prices stream live, and trade a simulated portfolio, either manually or by asking the AI copilot, with every number (cash, positions, P&L) staying correct and updating in real time.

### Constraints

- **Tech stack**: FastAPI + uv (Python 3.12), stdlib `sqlite3`, Next.js static export with TypeScript and Tailwind, Lightweight Charts, LiteLLM → OpenRouter — fixed by PLAN.md §3 and §10
- **Deployment**: one container, one port (8000), one origin — no CORS, simple for students
- **Data contracts**: API shapes, status codes, and timestamp conventions (ISO 8601 for REST/DB, Unix float seconds for SSE/history) must match PLAN.md §6–§8 exactly; the frontend and E2E tests depend on them
- **Startup**: all initialization runs in `lifespan` before requests are accepted; nothing is deferred to the first request
- **Testing**: E2E runs with `LLM_MOCK=true` and needs no API keys; each test resets state
- **Visual**: dark theme (`#0d1117` / `#1a1a2e`, no pure black); accent yellow `#ecad0a`, blue `#209dd7`, purple `#753991` for submit buttons; desktop-first, functional on tablet

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Status Summary

## Languages

- Python 3.12+ - All implemented code: `backend/app/market/*.py`, `backend/tests/**/*.py`, `backend/market_data_demo.py`. `requires-python = ">=3.12"` in `backend/pyproject.toml`; Ruff targets `py312`.
- TypeScript / Next.js - Planned only for `frontend/` (not present).
- SQL - Planned `backend/app/db/schema.sql` (not present).
- Shell / PowerShell - Planned `scripts/*.sh` and `scripts/*.ps1` (not present).
- YAML - GitHub Actions workflows in `.github/workflows/claude.yml` and `.github/workflows/claude-code-review.yml`; Docker Compose not yet present.

## Runtime

- CPython 3.12+ (no `.python-version` or `.nvmrc` file present; the `requires-python` constraint is the only pin)
- Node 20 is planned for the frontend build stage in the Dockerfile (not present)
- `uv` (Astral) - project manager for `backend/`
- Lockfile: present - `backend/uv.lock` (lock `revision = 5`, `requires-python = ">=3.12"`)
- Build backend: `hatchling` (`[build-system]` in `backend/pyproject.toml`; wheel packages = `["app"]`)

## Frameworks

- NumPy 2.4.2 (locked) - used by the GBM simulator, `backend/app/market/simulator.py`, for random number generation and correlated draws
- FastAPI 0.128.7 (locked; declared `>=0.115.0`) - used only for the SSE/history router factory `create_stream_router()` in `backend/app/market/stream.py`. No application entry point exists yet.
- Starlette 0.52.1 (locked, transitive via FastAPI) - `StreamingResponse` used by `stream.py`
- Uvicorn 0.40.0 (locked; declared `uvicorn[standard]>=0.32.0`) - declared as the ASGI server; no run command is wired up yet
- Next.js (TypeScript, static export `output: 'export'`) with Tailwind CSS and Lightweight Charts (per `planning/PLAN.md` §10)
- LiteLLM → OpenRouter (model `openrouter/openai/gpt-oss-120b`, Cerebras provider) for chat (`planning/PLAN.md` §9). Not in `pyproject.toml` yet.
- Stdlib `sqlite3` for persistence (no ORM), planned in `backend/app/db/` (`planning/PLAN.md` §7)
- pytest 9.0.2 (locked; declared `>=8.3.0`) - config in `[tool.pytest.ini_options]` of `backend/pyproject.toml` (`testpaths = ["tests"]`, `asyncio_mode = "auto"`)
- pytest-asyncio (declared `>=0.24.0`) - async tests
- pytest-cov (declared `>=5.0.0`) - coverage; config `[tool.coverage.run]` (source `app`)
- httpx 0.28.1 (locked) - FastAPI `TestClient` support in dev extras
- rich (declared `>=13.0.0`) - terminal demo output in `backend/market_data_demo.py`
- Playwright E2E - planned under `test/` (not present)
- React Testing Library - planned for `frontend/` (not present)
- Ruff 0.15.0 (locked; declared `>=0.7.0`) - lint and format. Config: `line-length = 100`, lint rules `E, F, I, N, W`, `E501` ignored. Defined in `backend/pyproject.toml`.
- Hatchling - build backend
- Docker multi-stage build - planned `Dockerfile` (Node 20 slim → Python 3.12 slim) (not present)

## Key Dependencies

- `massive` (declared `>=1.0.0`, locked **2.2.0**) - Massive (formerly Polygon.io) Python SDK. Used in `backend/app/market/massive_client.py` for `massive.RESTClient`, `massive.exceptions.BadResponse`, and `massive.rest.models` (`SnapshotMarketType`, `TickerSnapshot`). Only used when `MASSIVE_API_KEY` is set.
- `numpy` (declared `>=2.0.0`, locked 2.4.2) - simulator math in `backend/app/market/simulator.py`
- `fastapi` (declared `>=0.115.0`, locked 0.128.7) - see Frameworks above
- `uvicorn[standard]` (declared `>=0.32.0`, locked 0.40.0) - ASGI server
- `httpx`, `pytest`, `pytest-asyncio`, `pytest-cov`, `rich`, `ruff` (see Testing / Build above)
- `python-dotenv` - planned to load `../.env` in local dev (`planning/PLAN.md` §5). Not in `pyproject.toml`.
- LiteLLM - planned for LLM calls (`planning/PLAN.md` §9). Not in `pyproject.toml`.

## Configuration

- `MASSIVE_API_KEY` - read in `backend/app/market/factory.py`. Non-empty value selects `MassiveDataSource`; otherwise `SimulatorDataSource`.
- `MASSIVE_POLL_INTERVAL` - read in `backend/app/market/factory.py` (`_poll_interval()`). Default 15s, minimum 1s; invalid or non-finite values fall back to the default.
- `OPENROUTER_API_KEY` - enables real LLM chat; absence yields `503` on `POST /api/chat`
- `LLM_MOCK` - `true` enables deterministic mock LLM responses
- `DB_PATH` - SQLite file path (default `db/finally.db` locally; `/app/db/finally.db` in Docker)
- `.env` at the repo root is gitignored (`.gitignore`); `.env.example` is **not present** in the repo. `backend/README.md` and the root `README.md` document the variables. The `.env` file was not read for this analysis.
- Local dev loading via `python-dotenv` is planned, not implemented.
- `backend/pyproject.toml` - project metadata, dependencies, Ruff, pytest, coverage config
- `backend/uv.lock` - locked dependency graph
- No `tsconfig.json`, `package.json` (for the app), `next.config.*`, `Dockerfile`, or `docker-compose.yml` exist yet.

## Platform Requirements

- Python 3.12+ and `uv`
- Install and test: `cd backend && uv sync --extra dev && uv run --extra dev pytest -v`
- Lint: `uv run --extra dev ruff check .` / format: `uv run --extra dev ruff format .`
- Demo: `uv run market_data_demo.py` (from `backend/`)
- Docker (planned): `docker compose up -d --build` on port 8000
- Single Docker container: Node 20 slim build stage, Python 3.12 slim runtime, uvicorn on port 8000, SQLite at `/app/db/finally.db` on named volume `finally-data`. Target hosts per `planning/PLAN.md` §11: Docker, AWS App Runner, or Render.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Scope of Current Code

## Naming Patterns

- Lowercase snake_case modules, one concern per file: `backend/app/market/cache.py`, `simulator.py`, `massive_client.py`, `stream.py`, `factory.py`, `interface.py`, `models.py`, `seed_prices.py`.
- Test files mirror source names with a `test_` prefix: `backend/tests/market/test_cache.py`, `test_simulator.py`, `test_simulator_source.py`, `test_massive.py`, `test_stream.py`, `test_factory.py`, `test_models.py`.
- Package `__init__.py` is the public API surface and declares `__all__`: `backend/app/market/__init__.py`.
- snake_case. Public verbs for operations: `update`, `get`, `get_price`, `get_all`, `get_history`, `remove`, `add_ticker`, `remove_ticker`, `get_tickers`.
- Module-private helpers are prefixed with a single underscore: `_normalize` in `backend/app/market/simulator.py`, `_poll_interval` in `backend/app/market/factory.py`, `_generate_events` in `backend/app/market/stream.py`, `_fetch_live` / `_fetch_eod` in `backend/app/market/massive_client.py`.
- Module-level pure helpers that are part of a module's testable surface are public without underscore: `pick_price` and `is_not_entitled` in `backend/app/market/massive_client.py`.
- Internal methods on a class that must not be called from outside use a leading underscore: `GBMSimulator._add_ticker_internal`, `GBMSimulator._rebuild_cholesky`, `MassiveDataSource._poll_once`.
- snake_case. Private instance attributes use a single leading underscore: `self._lock`, `self._prices`, `self._history`, `self._task`, `self._api_key`.
- Loop/scratch names are short (`t`, `i`, `n`, `snap`). Domain names are spelled out (`previous_price`, `open_price`, `change_percent`).
- PascalCase. Data types are frozen dataclasses with slots: `PriceUpdate`, `PricePoint` in `backend/app/market/models.py`.
- Abstract base class named for the role: `MarketDataSource(ABC)` in `backend/app/market/interface.py`; concrete implementations are `SimulatorDataSource` and `MassiveDataSource`, and the engine class is `GBMSimulator`.
- Test classes are `Test*` and grouped by unit under test (`TestPriceCache`, `TestSessionOpen`, `TestGBMSimulator`, `TestLiveMode`, `TestEodMode`, `TestTickerManagement`).
- UPPER_SNAKE_CASE at module scope with a unit comment when non-obvious: `SSE_INTERVAL = 0.5  # seconds between change checks (PLAN §6)`, `DEFAULT_POLL_INTERVAL = 15.0  # suits the free tier's 5 calls/min`, `MIN_POLL_INTERVAL = 1.0` in `backend/app/market/factory.py`.
- Class-level constants on a class: `GBMSimulator.TRADING_SECONDS_PER_YEAR`, `GBMSimulator.DEFAULT_DT`.
- Stored uppercase and trimmed. Normalization is done at the boundary of each source (`_normalize` in `backend/app/market/simulator.py`, `ticker.strip().upper()` in `backend/app/market/stream.py` for the history endpoint). Cache keys are stored as given, so callers must pass normalized tickers (`backend/CLAUDE.md`).

## Type Hints

- Every module that uses modern annotations starts with `from __future__ import annotations` (all files under `backend/app/market/`).
- Use PEP 604 unions and builtin generics: `float | None`, `dict[str, PriceUpdate]`, `list[str]`, `set[str]`. Do not import `typing.Optional` or `typing.List`.
- Use `collections.abc` for callables and iterators: `Callable` in `backend/app/market/cache.py`, `AsyncGenerator` in `backend/app/market/stream.py`.
- Public methods are fully annotated, including return types (`-> PriceUpdate`, `-> None`, `-> dict`).
- `Literal` is used for closed string sets: `Mode = Literal[...]` in `backend/app/market/massive_client.py`; direction is returned as a plain `str` (`"up"`, `"down"`, `"flat"`) in `backend/app/market/models.py`.

## Code Style

- Tool: `ruff format` (Black-compatible).
- Line length: 100 (`[tool.ruff] line-length = 100` in `backend/pyproject.toml`).
- Target version: Python 3.12 (`requires-python = ">=3.12"`, `target-version = "py312"`).
- Use double quotes and trailing commas in multi-line calls and literals, as the formatter produces.
- Verified state: `ruff format --check app/ tests/` reports all 20 files already formatted.
- Tool: `ruff check` with rule sets `E`, `F`, `I`, `N`, `W` (`[tool.ruff.lint] select` in `backend/pyproject.toml`).
- `E501` (line length) is ignored because the formatter owns line length.
- Verified state: `ruff check app/ tests/` passes.
- Import order is enforced by the `I` rules: standard library, then third-party (`fastapi`, `massive`, `numpy`), then first-party relative imports (`from .cache import PriceCache`).
- Inside the package, use relative imports (`from .models import PricePoint, PriceUpdate`). Tests import absolute paths from the `app` package (`from app.market.cache import PriceCache`).
- No `.editorconfig`, `.prettierrc`, or `eslint` config exists for the backend. Ruff configuration in `backend/pyproject.toml` is the only style source.

## Import Organization

- None configured. Use explicit relative imports inside `app/` and `app.*` absolute imports in tests.
- Re-export the public API in `backend/app/market/__init__.py` with an explicit `__all__`. Downstream code imports from `app.market`, not from submodules: `from app.market import PriceCache, PricePoint, PriceUpdate, MarketDataSource, create_market_data_source`.
- Internal modules (`seed_prices`, `simulator`, `massive_client`) are imported by path only in tests or by the factory.

## Module Header Docstrings

## Docstrings and Comments

- Triple double quotes, imperative or descriptive summary line, blank line, then details. No type-annotated `Args:`/`Returns:` sections are used; types live in annotations.
- Public classes describe their contract and lifecycle. `MarketDataSource` shows the lifecycle as a usage example in its class docstring (`backend/app/market/interface.py`).
- Abstract methods document the contract (for example "Must be called exactly once", "Safe to call multiple times", "No-op if already present").
- Math and rationale go in docstrings: `GBMSimulator` docstring gives the GBM equation and the `dt` derivation (`backend/app/market/simulator.py`).
- Inline comments explain units, sources of constants, or non-obvious ordering, often with a PLAN section reference: `# PLAN §6`, `# PLAN §6: tracked tickers are watchlist ∪ held positions`.
- Comments explain *why*, not *what*: `# Re-read: tickers may have been removed while the call was in flight` in `backend/app/market/massive_client.py`.
- Use `# --- Public API ---` / `# --- Internals ---` section banners to separate groups of methods in a class (`backend/app/market/simulator.py`).
- Not applicable (Python only so far).

## Dataclasses and Value Objects

- Immutable value types use `@dataclass(frozen=True, slots=True)`: `PriceUpdate`, `PricePoint` (`backend/app/market/models.py`).
- Derived values are `@property` methods computed from fields, not stored: `change`, `change_percent`, `session_change_percent`, `direction`.
- Serialization is an explicit `to_dict()` method that returns exactly the wire fields, in a fixed order. Do not use `dataclasses.asdict` for API payloads, because field sets must match PLAN §6 exactly.
- Round money/prices at construction or at the boundary, not in every consumer: `PriceCache.update` rounds to 2 dp (`price = round(float(price), 2)`), and `change` rounds to 4 dp.

## Concurrency Conventions

- Shared state accessed from both the asyncio loop and worker threads is guarded by `threading.Lock`: `self._lock = Lock()` in `PriceCache` (`backend/app/market/cache.py`). Every mutator and reader takes the lock with `with self._lock:`.
- Blocking I/O is pushed off the event loop with `asyncio.to_thread`, for example the synchronous Massive REST client in `MassiveDataSource._poll_once` (`backend/app/market/massive_client.py`).
- Background work is an `asyncio.Task` created with a `name=` argument (`asyncio.create_task(self._run_loop(), name="simulator-loop")`). Stop it by cancelling and awaiting, swallowing `CancelledError` only at that call site, and set the handle to `None` (`SimulatorDataSource.stop`).
- Background loops catch `Exception` per iteration, log with `logger.exception`, and keep running. `CancelledError` is not caught inside loops (it is a `BaseException` in Python 3.8+).
- Reference the shared resource through constructor injection, not module globals. `create_stream_router(price_cache)` builds a new router per call with "no module-level state" (`backend/app/market/stream.py`).

## Error Handling

- Recoverable domain conditions return `None` or empty collections rather than raising: `PriceCache.get` returns `None` for unknown tickers; `get_history` returns `[]`; `remove` on a missing ticker is a no-op; `add_ticker` on a present ticker is a no-op.
- Input parsing with a safe fallback logs a warning and uses a default. See `_poll_interval` in `backend/app/market/factory.py`: blank → default, invalid/NaN/inf → default with `logger.warning`, below minimum → clamped with a warning.
- Background tasks never raise into the event loop. Use a broad `except Exception` plus `logger.exception(...)` at the loop boundary (`SimulatorDataSource._run_loop`, `MassiveDataSource._poll_once`).
- Specific third-party exceptions are caught before the broad handler and given specific handling. Example in `_poll_once`: `except BadResponse as e:` branches on `is_not_entitled(e)` for a plan-level fallback, then falls through to `except Exception:`.
- Helper predicates on exceptions are module-level functions so they can be unit-tested: `is_not_entitled(err: BadResponse) -> bool` in `backend/app/market/massive_client.py`.
- Stream-level errors are not surfaced to clients as HTTP errors; the SSE generator logs connect/disconnect (`logger.info("SSE client connected: %s", client_ip)`) and uses `try/finally` for cleanup.
- Business-rule failures return `400` with `{"error": "<message>"}`; malformed bodies use FastAPI's default `422`; not-found returns `404` with `{"error": "..."}`; LLM failures return `502` (`PLAN.md` §8).
- Trade failures must roll back the SQLite transaction (`PLAN.md` §7).

## Logging

- Use `%s`-style lazy formatting in log calls, never f-strings: `logger.info("Simulator: added ticker %s", ticker)`.
- Prefix messages with the component name: `"Massive poll failed: %s"`, `"Simulator stopped"`, `"Massive EOD: using closes for %s"`.
- `logger.info` for lifecycle (start, stop, add/remove ticker, client connect/disconnect); `logger.warning` for degraded but continuing states (missing price for a ticker, plan downgrade, invalid env value); `logger.error` for an expected failed operation with a message; `logger.exception` inside broad `except` blocks to capture the traceback.
- `logger.debug` for per-event detail, such as random market events in the simulator.
- Warnings that could repeat every cycle are de-duplicated with a set: `self._warned_missing` in `MassiveDataSource`.
- No `print` in library code. `backend/market_data_demo.py` is the only script-style output and is not part of the `app` package.

## Configuration and Environment

- Environment variables are read at the point of use with `os.environ.get(NAME, "")`, then `.strip()`. Empty or whitespace-only values are treated as unset: `MASSIVE_API_KEY` (`backend/app/market/factory.py`).
- Parse numeric env vars through a helper that validates and clamps (see `_poll_interval`), not inline `float(...)`.
- PLAN-derived: `.env` is loaded by the backend with `python-dotenv` for local dev if the file exists; do not add secrets to code or tests. Tests patch the environment with `patch.dict(os.environ, {...}, clear=True)`.

## Function and Class Design

- Keyword-only options are passed by name at call sites for anything beyond one or two arguments: `SimulatorDataSource(price_cache=cache, update_interval=0.05)`, `MassiveDataSource("k", cache, poll_interval=60, client=client)`.
- Injection points for testing are constructor parameters with defaults, not monkeypatching: `PriceCache(clock=...)`, `MassiveDataSource(..., client=...)`, `_generate_events(price_cache, request, interval=..., keepalive=...)`, `SimulatorDataSource(update_interval=..., event_probability=...)`.
- Return the updated value from mutators where callers need it: `PriceCache.update` returns the new `PriceUpdate`.
- Use `Optional` as `X | None` and document the `None` meaning in the docstring.
- New market sources subclass `MarketDataSource` and implement `start`, `stop`, `add_ticker`, `remove_ticker`, `get_tickers`. Downstream code reads prices only from `PriceCache`, never from a source.

## Module Design

## Dependency and Data-Model Conventions

- The `massive` SDK model classes are used as-is in code paths that consume API responses; construct test fixtures with `TickerSnapshot.from_dict(...)` rather than mocks (`backend/CLAUDE.md`).
- Timestamps in the market subsystem are Unix seconds as `float`, sourced from `time.time()` via an injectable clock (`PriceCache(clock=...)`). PLAN-derived: REST/DB timestamps are ISO 8601 UTC strings; SSE and history timestamps are Unix seconds.
- PLAN-derived: use the stdlib `sqlite3` module directly with no ORM for the database layer.

## Summary of Prescriptive Rules for New Code

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## Status Summary

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

## Pattern Overview

- One Python package (`app`) inside a self-contained uv project at `backend/`.
- Producer/consumer split: a single background task (simulator loop or Massive poller) writes prices into `PriceCache`; readers (SSE stream, history endpoint, later portfolio valuation and trade execution) only read from the cache.
- Abstraction at the data source: `MarketDataSource` ABC has two implementations selected by a factory from environment variables. Downstream code does not know which is active.
- Router factories instead of module-level routers: `create_stream_router(price_cache)` returns a new `APIRouter` bound to an injected cache, so there is no module-level state in the HTTP layer.
- Dependency injection by constructor: `PriceCache` takes an injectable `clock` and history limits; sources take the cache; tests inject fakes.
- Stdlib-first persistence direction: SQLite via stdlib `sqlite3` with no ORM is planned (PLAN §3, §7); no DB code exists yet.

## Layers

- Purpose: Immutable value objects for prices.
- Location: `backend/app/market/models.py`
- Contains: `PriceUpdate` (frozen dataclass with `change`, `change_percent`, `session_change_percent`, `direction`, `to_dict()`), `PricePoint` (`timestamp`, `price`, `to_dict()`).
- Depends on: stdlib only.
- Used by: `cache.py`, `simulator.py`, `massive_client.py`, `stream.py`.
- Purpose: Contract for any price provider.
- Location: `backend/app/market/interface.py`
- Contains: `MarketDataSource(ABC)` with async `start(tickers)`, `stop()`, `add_ticker(ticker)`, `remove_ticker(ticker)`, and sync `get_tickers()`.
- Depends on: nothing inside the package.
- Used by: `factory.py`, `simulator.py`, `massive_client.py`, and (planned) the watchlist and trade code paths in the API layer.
- Purpose: Produce price ticks and write them to the cache on a background task.
- Location: `backend/app/market/simulator.py` (`GBMSimulator`, `SimulatorDataSource`), `backend/app/market/massive_client.py` (`MassiveDataSource`), `backend/app/market/seed_prices.py` (seed prices and per-ticker drift/volatility).
- Contains: GBM math with correlated moves via Cholesky decomposition and random events (simulator); REST polling with `asyncio.to_thread` around a blocking `massive` client call, with LIVE and EOD modes (Massive).
- Depends on: `PriceCache`, `MarketDataSource`; `numpy` (simulator); `massive` SDK (Massive client).
- Used by: `factory.py` only. The app entry point (planned) will call the factory during `lifespan`.
- Purpose: Single source of truth for latest prices, session open prices, a 5-minute history ring buffer per ticker, and a monotonic change counter.
- Location: `backend/app/market/cache.py`
- Contains: `PriceCache` with `update()`, `remove()`, `get()`, `get_price()`, `get_all()`, `get_history()`, `version`.
- Depends on: `models.py`.
- Used by: sources (writers); `stream.py` (readers). Planned readers: portfolio valuation, trade execution, watchlist response, LLM context.
- Concurrency: guarded by a `threading.Lock`, because the Massive poller performs fetches in a worker thread via `asyncio.to_thread` and the cache is shared across threads and the event loop.
- Purpose: Expose the cache over HTTP.
- Location: `backend/app/market/stream.py`
- Contains: `create_stream_router(price_cache) -> APIRouter` with `GET /api/stream/prices` (SSE) and `GET /api/prices/{ticker}/history`.
- Depends on: `PriceCache`, FastAPI.
- Used by: the app entry point (planned), which must `include_router` it. Note: nothing mounts this router yet because no app object exists.
- Purpose: Lifespan startup, routes for portfolio, trades, watchlist, chat, reset, health; static file serving of the Next.js export.
- Location: **(planned)** `backend/app/main.py` or similar; `backend/app/db/` for schema and seed.
- Depends on: market subsystem, sqlite3, LiteLLM.
- Purpose: Terminal-style UI consuming `/api/*` and `/api/stream/*`.
- Location: **(planned)** `frontend/` (Next.js, TypeScript, Tailwind, `output: 'export'`).
- Depends on: REST and SSE endpoints only; no Python knowledge.

## Data Flow

### Price Tick Path (implemented)

### Price History Path (implemented)

### Tracked-Ticker Lifecycle (contract, partly implemented)

- Source is started with the tracked set (watchlist ∪ held positions, PLAN §6). `add_ticker` and `remove_ticker` are implemented on both sources; `remove_ticker` also clears session open and history in the cache.
- Callers must only call `remove_ticker` when no position is held (documented in `backend/CLAUDE.md`). The enforcing caller is **(planned)**.

### Planned Request Paths (from PLAN.md, not implemented)

- Startup (`lifespan`): create schema and seed (idempotent), start market source with watchlist ∪ positions, record initial snapshot, start 30 s snapshot task.
- Trade: validate ticker and quantity, read price from cache, transactional update of cash, position, and trade log, then snapshot, then return updated portfolio.
- Chat: store user message, build portfolio context from cache and DB, call LLM via LiteLLM/OpenRouter with structured output, execute watchlist changes then trades independently, append failure notes, store assistant message, return it.
- Server-side market state lives only in the process: `PriceCache` (prices, history, versions) and each source's internal state (`GBMSimulator` tickers and Cholesky matrix, Massive EOD cache).
- Persistent state (cash, positions, trades, snapshots, chat) is planned for SQLite at `DB_PATH`. Not implemented.
- Client state is planned to be computed client-side from SSE plus `/api/portfolio`.

## Key Abstractions

- Purpose: Swappable price provider.
- Examples: `backend/app/market/interface.py`, `backend/app/market/simulator.py` (`SimulatorDataSource`), `backend/app/market/massive_client.py` (`MassiveDataSource`).
- Pattern: Abstract base class with async lifecycle methods; implementations own one background `asyncio.Task` named `simulator-loop` or `massive-poller`, cancelled in `stop()`.
- Purpose: Concurrency-safe shared store with change detection.
- Examples: `backend/app/market/cache.py`.
- Pattern: Lock-guarded dicts plus `deque(maxlen)` per ticker; `version` counter as a cheap change signal for SSE. Timestamps are forced strictly increasing per ticker.
- Purpose: Immutable transport objects with wire format defined in `to_dict()`.
- Examples: `backend/app/market/models.py`.
- Pattern: Frozen dataclasses; `timestamp` is Unix seconds (float) on the SSE and history wire, while REST and DB timestamps are ISO 8601 per PLAN §7.
- Purpose: Mount market routes onto any app with an injected cache.
- Examples: `create_stream_router` in `backend/app/market/stream.py`.
- Pattern: `create_*_router(dependency) -> APIRouter`, with no module-level state. Apply the same pattern to the planned portfolio, watchlist, and chat routers.
- Purpose: Environment-driven selection.
- Examples: `create_market_data_source` in `backend/app/market/factory.py`.
- Pattern: `MASSIVE_API_KEY` non-empty selects Massive, polling at `MASSIVE_POLL_INTERVAL` (default 15, minimum 1, invalid values fall back with a warning); otherwise the simulator. Returns an unstarted source; the caller awaits `start(tickers)`.

## Entry Points

- Location: `backend/app/market/__init__.py`
- Exports: `PricePoint`, `PriceUpdate`, `PriceCache`, `MarketDataSource`, `create_market_data_source`, `create_stream_router`.
- Triggers: imported by the app entry point (planned) and tests.
- Location: `backend/market_data_demo.py`
- Triggers: `uv run --extra dev market_data_demo.py` from `backend/`.
- Responsibilities: runs a simulator-backed terminal dashboard; the only runnable program in the repo.
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

### Blocking calls on the event loop

### Writing to `PriceCache` from routes

## Error Handling

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| cerebras-inference | Use this to write code to call an LLM using LiteLLM and OpenRouter with the Cerebras inference provider | `.claude/skills/cerebras/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
