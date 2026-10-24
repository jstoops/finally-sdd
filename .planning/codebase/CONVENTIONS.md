---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
# Coding Conventions

**Analysis Date:** 2026-10-23

## Scope of Current Code

Only the Python market data subsystem exists so far: `backend/app/market/` (plus `backend/app/__init__.py`, the demo script `backend/market_data_demo.py`, and tests under `backend/tests/`). There is no `frontend/`, no `backend/app/db/`, no routes module, and no LLM code yet. Conventions below are derived from that code and from `backend/pyproject.toml` and `backend/CLAUDE.md`. Where a rule is for future code (for example the planned SQLite layer) it is marked as a PLAN-derived rule.

## Naming Patterns

**Files:**
- Lowercase snake_case modules, one concern per file: `backend/app/market/cache.py`, `simulator.py`, `massive_client.py`, `stream.py`, `factory.py`, `interface.py`, `models.py`, `seed_prices.py`.
- Test files mirror source names with a `test_` prefix: `backend/tests/market/test_cache.py`, `test_simulator.py`, `test_simulator_source.py`, `test_massive.py`, `test_stream.py`, `test_factory.py`, `test_models.py`.
- Package `__init__.py` is the public API surface and declares `__all__`: `backend/app/market/__init__.py`.

**Functions:**
- snake_case. Public verbs for operations: `update`, `get`, `get_price`, `get_all`, `get_history`, `remove`, `add_ticker`, `remove_ticker`, `get_tickers`.
- Module-private helpers are prefixed with a single underscore: `_normalize` in `backend/app/market/simulator.py`, `_poll_interval` in `backend/app/market/factory.py`, `_generate_events` in `backend/app/market/stream.py`, `_fetch_live` / `_fetch_eod` in `backend/app/market/massive_client.py`.
- Module-level pure helpers that are part of a module's testable surface are public without underscore: `pick_price` and `is_not_entitled` in `backend/app/market/massive_client.py`.
- Internal methods on a class that must not be called from outside use a leading underscore: `GBMSimulator._add_ticker_internal`, `GBMSimulator._rebuild_cholesky`, `MassiveDataSource._poll_once`.

**Variables:**
- snake_case. Private instance attributes use a single leading underscore: `self._lock`, `self._prices`, `self._history`, `self._task`, `self._api_key`.
- Loop/scratch names are short (`t`, `i`, `n`, `snap`). Domain names are spelled out (`previous_price`, `open_price`, `change_percent`).

**Types and Classes:**
- PascalCase. Data types are frozen dataclasses with slots: `PriceUpdate`, `PricePoint` in `backend/app/market/models.py`.
- Abstract base class named for the role: `MarketDataSource(ABC)` in `backend/app/market/interface.py`; concrete implementations are `SimulatorDataSource` and `MassiveDataSource`, and the engine class is `GBMSimulator`.
- Test classes are `Test*` and grouped by unit under test (`TestPriceCache`, `TestSessionOpen`, `TestGBMSimulator`, `TestLiveMode`, `TestEodMode`, `TestTickerManagement`).

**Constants:**
- UPPER_SNAKE_CASE at module scope with a unit comment when non-obvious: `SSE_INTERVAL = 0.5  # seconds between change checks (PLAN §6)`, `DEFAULT_POLL_INTERVAL = 15.0  # suits the free tier's 5 calls/min`, `MIN_POLL_INTERVAL = 1.0` in `backend/app/market/factory.py`.
- Class-level constants on a class: `GBMSimulator.TRADING_SECONDS_PER_YEAR`, `GBMSimulator.DEFAULT_DT`.

**Tickers:**
- Stored uppercase and trimmed. Normalization is done at the boundary of each source (`_normalize` in `backend/app/market/simulator.py`, `ticker.strip().upper()` in `backend/app/market/stream.py` for the history endpoint). Cache keys are stored as given, so callers must pass normalized tickers (`backend/CLAUDE.md`).

## Type Hints

- Every module that uses modern annotations starts with `from __future__ import annotations` (all files under `backend/app/market/`).
- Use PEP 604 unions and builtin generics: `float | None`, `dict[str, PriceUpdate]`, `list[str]`, `set[str]`. Do not import `typing.Optional` or `typing.List`.
- Use `collections.abc` for callables and iterators: `Callable` in `backend/app/market/cache.py`, `AsyncGenerator` in `backend/app/market/stream.py`.
- Public methods are fully annotated, including return types (`-> PriceUpdate`, `-> None`, `-> dict`).
- `Literal` is used for closed string sets: `Mode = Literal[...]` in `backend/app/market/massive_client.py`; direction is returned as a plain `str` (`"up"`, `"down"`, `"flat"`) in `backend/app/market/models.py`.

## Code Style

**Formatting:**
- Tool: `ruff format` (Black-compatible).
- Line length: 100 (`[tool.ruff] line-length = 100` in `backend/pyproject.toml`).
- Target version: Python 3.12 (`requires-python = ">=3.12"`, `target-version = "py312"`).
- Use double quotes and trailing commas in multi-line calls and literals, as the formatter produces.
- Verified state: `ruff format --check app/ tests/` reports all 20 files already formatted.

**Linting:**
- Tool: `ruff check` with rule sets `E`, `F`, `I`, `N`, `W` (`[tool.ruff.lint] select` in `backend/pyproject.toml`).
- `E501` (line length) is ignored because the formatter owns line length.
- Verified state: `ruff check app/ tests/` passes.
- Import order is enforced by the `I` rules: standard library, then third-party (`fastapi`, `massive`, `numpy`), then first-party relative imports (`from .cache import PriceCache`).
- Inside the package, use relative imports (`from .models import PricePoint, PriceUpdate`). Tests import absolute paths from the `app` package (`from app.market.cache import PriceCache`).

**Editor/formatter config files:**
- No `.editorconfig`, `.prettierrc`, or `eslint` config exists for the backend. Ruff configuration in `backend/pyproject.toml` is the only style source.

## Import Organization

**Order:**
1. `from __future__ import annotations` (when used)
2. Standard library (`asyncio`, `logging`, `math`, `random`, `time`, `collections`, `threading`, `datetime`)
3. Third-party (`fastapi`, `numpy`, `massive`, `massive.rest.models`, `massive.exceptions`)
4. Package-relative (`from .cache import PriceCache`, `from .interface import MarketDataSource`)

Blank lines separate the groups. Example from `backend/app/market/stream.py`:

```python
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .cache import PriceCache
```

**Path Aliases:**
- None configured. Use explicit relative imports inside `app/` and `app.*` absolute imports in tests.

**Package exports:**
- Re-export the public API in `backend/app/market/__init__.py` with an explicit `__all__`. Downstream code imports from `app.market`, not from submodules: `from app.market import PriceCache, PricePoint, PriceUpdate, MarketDataSource, create_market_data_source`.
- Internal modules (`seed_prices`, `simulator`, `massive_client`) are imported by path only in tests or by the factory.

## Module Header Docstrings

Every module begins with a one-line docstring describing its role, sometimes followed by a longer explanation:

```python
"""Abstract interface for market data sources."""
```

```python
"""Tests for PriceCache."""
```

Longer module docstrings explain why a choice was made, for example the rationale for using real `massive` model classes in tests in `backend/tests/market/test_massive.py`.

## Docstrings and Comments

**Docstring style:**
- Triple double quotes, imperative or descriptive summary line, blank line, then details. No type-annotated `Args:`/`Returns:` sections are used; types live in annotations.
- Public classes describe their contract and lifecycle. `MarketDataSource` shows the lifecycle as a usage example in its class docstring (`backend/app/market/interface.py`).
- Abstract methods document the contract (for example "Must be called exactly once", "Safe to call multiple times", "No-op if already present").
- Math and rationale go in docstrings: `GBMSimulator` docstring gives the GBM equation and the `dt` derivation (`backend/app/market/simulator.py`).

**Comments:**
- Inline comments explain units, sources of constants, or non-obvious ordering, often with a PLAN section reference: `# PLAN §6`, `# PLAN §6: tracked tickers are watchlist ∪ held positions`.
- Comments explain *why*, not *what*: `# Re-read: tickers may have been removed while the call was in flight` in `backend/app/market/massive_client.py`.
- Use `# --- Public API ---` / `# --- Internals ---` section banners to separate groups of methods in a class (`backend/app/market/simulator.py`).

**JSDoc/TSDoc:**
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

**Pattern set in the codebase:**
- Recoverable domain conditions return `None` or empty collections rather than raising: `PriceCache.get` returns `None` for unknown tickers; `get_history` returns `[]`; `remove` on a missing ticker is a no-op; `add_ticker` on a present ticker is a no-op.
- Input parsing with a safe fallback logs a warning and uses a default. See `_poll_interval` in `backend/app/market/factory.py`: blank → default, invalid/NaN/inf → default with `logger.warning`, below minimum → clamped with a warning.
- Background tasks never raise into the event loop. Use a broad `except Exception` plus `logger.exception(...)` at the loop boundary (`SimulatorDataSource._run_loop`, `MassiveDataSource._poll_once`).
- Specific third-party exceptions are caught before the broad handler and given specific handling. Example in `_poll_once`: `except BadResponse as e:` branches on `is_not_entitled(e)` for a plan-level fallback, then falls through to `except Exception:`.
- Helper predicates on exceptions are module-level functions so they can be unit-tested: `is_not_entitled(err: BadResponse) -> bool` in `backend/app/market/massive_client.py`.
- Stream-level errors are not surfaced to clients as HTTP errors; the SSE generator logs connect/disconnect (`logger.info("SSE client connected: %s", client_ip)`) and uses `try/finally` for cleanup.

**PLAN-derived rules for future HTTP code (not yet implemented):**
- Business-rule failures return `400` with `{"error": "<message>"}`; malformed bodies use FastAPI's default `422`; not-found returns `404` with `{"error": "..."}`; LLM failures return `502` (`PLAN.md` §8).
- Trade failures must roll back the SQLite transaction (`PLAN.md` §7).

## Logging

**Framework:** stdlib `logging`, one logger per module.

**Pattern:**

```python
logger = logging.getLogger(__name__)
```

Declared immediately after imports and constants in every module that logs (`backend/app/market/simulator.py`, `massive_client.py`, `stream.py`, `factory.py`).

**Conventions:**
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

**Size:** Methods are short and single-purpose. The longest module is `backend/app/market/massive_client.py`, where fetch logic is split into `_fetch`, `_fetch_live`, `_fetch_eod`, `_previous_close`, `_latest_grouped_closes`.

**Parameters:**
- Keyword-only options are passed by name at call sites for anything beyond one or two arguments: `SimulatorDataSource(price_cache=cache, update_interval=0.05)`, `MassiveDataSource("k", cache, poll_interval=60, client=client)`.
- Injection points for testing are constructor parameters with defaults, not monkeypatching: `PriceCache(clock=...)`, `MassiveDataSource(..., client=...)`, `_generate_events(price_cache, request, interval=..., keepalive=...)`, `SimulatorDataSource(update_interval=..., event_probability=...)`.

**Return values:**
- Return the updated value from mutators where callers need it: `PriceCache.update` returns the new `PriceUpdate`.
- Use `Optional` as `X | None` and document the `None` meaning in the docstring.

**Abstract contracts:**
- New market sources subclass `MarketDataSource` and implement `start`, `stop`, `add_ticker`, `remove_ticker`, `get_tickers`. Downstream code reads prices only from `PriceCache`, never from a source.

## Module Design

**Exports:** Explicit `__all__` in every package `__init__.py` (`backend/app/market/__init__.py`). `backend/app/__init__.py` is the package marker.

**Barrel files:** Used only at `app/market/__init__.py`, which re-exports the public API. Do not add barrels for sub-packages unless they have a public surface.

**Private module state:** Avoided. The one exception is shared module constants (`SEED_PRICES`, `TICKER_PARAMS`, correlation constants in `backend/app/market/seed_prices.py`), which are read-only data.

## Dependency and Data-Model Conventions

- The `massive` SDK model classes are used as-is in code paths that consume API responses; construct test fixtures with `TickerSnapshot.from_dict(...)` rather than mocks (`backend/CLAUDE.md`).
- Timestamps in the market subsystem are Unix seconds as `float`, sourced from `time.time()` via an injectable clock (`PriceCache(clock=...)`). PLAN-derived: REST/DB timestamps are ISO 8601 UTC strings; SSE and history timestamps are Unix seconds.
- PLAN-derived: use the stdlib `sqlite3` module directly with no ORM for the database layer.

## Summary of Prescriptive Rules for New Code

1. Put new backend code under `backend/app/`, use `from __future__ import annotations`, and annotate every public function.
2. Run `uv run --extra dev ruff check app/ tests/` and `uv run --extra dev ruff format --check app/ tests/` before finishing; both currently pass.
3. Use `logger = logging.getLogger(__name__)` and `%s` formatting in logs.
4. Model value objects as `@dataclass(frozen=True, slots=True)` with a `to_dict()` for wire payloads.
5. Inject dependencies (cache, clock, HTTP client, intervals) through constructors so tests do not need monkeypatching.
6. Guard shared cache state with `threading.Lock`; push blocking calls with `asyncio.to_thread`.
7. Background loops catch and log exceptions; they do not die on a single bad iteration.

---

*Convention analysis: 2026-10-23*
