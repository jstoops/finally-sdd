---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
# Testing Patterns

**Analysis Date:** 2026-10-23

## Scope of Current Testing

Only the market data subsystem is tested: `backend/tests/market/`. Tests for the portfolio, LLM, API routes, and frontend do not exist yet. The E2E `test/` directory described in `planning/PLAN.md` §4 and §12 is not present. Frontend test tooling is not present.

## Test Framework

**Runner:**
- pytest (`pytest>=8.3.0` in the `dev` optional dependency group of `backend/pyproject.toml`).
- pytest-asyncio (`pytest-asyncio>=0.24.0`) with `asyncio_mode = "auto"`, so `async def test_...` functions run without a decorator.
- Config: `[tool.pytest.ini_options]` in `backend/pyproject.toml`:
  - `testpaths = ["tests"]`
  - `python_files = ["test_*.py"]`, `python_classes = ["Test*"]`, `python_functions = ["test_*"]`
  - `asyncio_default_fixture_loop_scope = "function"`

**Assertion Library:**
- Plain `assert` statements (pytest rewriting). No assertion library beyond pytest. `pytest.approx` is not used; equality checks compare rounded values (`round(..., 4)`) because the code rounds prices.

**Other test dependencies (dev group):**
- `httpx>=0.28.1` (for FastAPI `TestClient`, which uses httpx).
- `pytest-cov>=5.0.0` (coverage).
- `rich>=13.0.0` (used by `backend/market_data_demo.py`, not by tests).

**Run Commands:**

```bash
cd backend
uv sync --extra dev                                  # Install dev dependencies (see backend/CLAUDE.md)
uv run --extra dev pytest -v                         # Run all tests
uv run --extra dev pytest tests/market/test_cache.py # Run one file
uv run --extra dev pytest -k "SessionOpen"           # Run tests matching a name
uv run --extra dev pytest --cov=app                  # Coverage (source = app, tests omitted)
uv run --extra dev ruff check app/ tests/            # Lint
uv run --extra dev ruff format --check app/ tests/   # Format check
```

Watch mode: not configured (no `pytest-watch` or equivalent in dependencies).

**Verified state at analysis time:** `pytest -q` reports 139 passed. `ruff check` and `ruff format --check` pass.

## Test File Organization

**Location:**
- Tests live in a separate tree, not co-located with source: `backend/tests/`, mirroring the package layout. The market subsystem is under `backend/tests/market/`.
- `backend/tests/__init__.py` and `backend/tests/market/__init__.py` exist, so tests are importable as packages.
- `backend/tests/conftest.py` exists but contains only a module docstring. There are no shared fixtures in it.

**Naming:**
- Files: `test_<source_module>.py`. Mapping:
  - `app/market/cache.py` → `tests/market/test_cache.py`
  - `app/market/simulator.py` → `tests/market/test_simulator.py` (GBM math, `GBMSimulator` class, no event loop) and `tests/market/test_simulator_source.py` (`SimulatorDataSource` async lifecycle)
  - `app/market/massive_client.py` → `tests/market/test_massive.py`
  - `app/market/stream.py` → `tests/market/test_stream.py`
  - `app/market/factory.py` → `tests/market/test_factory.py`
  - `app/market/models.py` → `tests/market/test_models.py`
- Classes: `Test<Unit>` grouping related behaviors, for example `TestPriceCache`, `TestSessionOpen`, `TestPickPrice`, `TestIsNotEntitled`, `TestLiveMode`, `TestEodMode`, `TestTickerManagement`, `TestFactory`, `TestGenerateEvents`.
- Functions: `test_<behavior>` in snake_case, describing the behavior, for example `test_first_update_is_flat`, `test_remove_starts_new_session`, `test_creates_simulator_when_api_key_empty`.

**Structure:**

```
backend/tests/
├── __init__.py
├── conftest.py                 # module docstring only; no shared fixtures yet
└── market/
    ├── __init__.py
    ├── test_cache.py           # PriceCache + session open + history ring buffer
    ├── test_factory.py         # env-driven source selection, poll interval parsing
    ├── test_massive.py         # MassiveDataSource live/EOD modes, ticker management
    ├── test_models.py          # PriceUpdate / PricePoint properties and to_dict
    ├── test_simulator.py       # GBMSimulator (pure, synchronous)
    ├── test_simulator_source.py# SimulatorDataSource (async lifecycle)
    └── test_stream.py          # SSE generator frames, history endpoint via TestClient
```

## Test Structure

**Suite Organization:**

```python
"""Tests for PriceCache."""

from app.market.cache import PriceCache

class TestPriceCache:
    """Unit tests for the PriceCache."""

    def test_update_and_get(self):
        """Test updating and getting a price."""
        cache = PriceCache()
        update = cache.update("AAPL", 190.50)
        assert update.ticker == "AAPL"
        assert update.price == 190.50
        assert cache.get("AAPL") == update
```

Pattern details:
- Module docstring, then imports, then `Test*` classes with a docstring, then methods with a one-line docstring (`"""Test ..."""`). Docstrings on tests are the norm but not enforced.
- Construct the system under test directly inside each test. No `setup_method` or `setUp` is used.
- Shared scenario helpers are module-level in the test file, not in `conftest.py`. Examples: `FakeClock` in `test_cache.py`, `FakeRequest` and `collect` / `parse` in `test_stream.py`, `snap(...)` and `source_with(...)` in `test_massive.py`.

**Parametrization:**
- `@pytest.mark.parametrize` with tuple names and a list of cases for table-driven tests. Example from `TestPickPrice` in `backend/tests/market/test_massive.py`:

```python
@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"trade": 190.5, "minute": 190.4, "day": 190.3, "prev": 189.0}, 190.5),
        ({"day": 0, "prev": 189.0}, 189.0),  # day bar zeroed overnight
        ({}, None),
    ],
)
def test_fallback_order(self, kwargs, expected):
    assert pick_price(snap("AAPL", **kwargs)) == expected
```

**Patterns:**
- Setup: construct objects inline; use helper constructors (`source_with(client, **kwargs)`) when the same wiring repeats.
- Teardown: explicit `await source.stop()` at the end of async tests, or `try: ... finally: await source.stop()` when the test can fail mid-way (`TestLiveMode` in `test_massive.py`). No pytest fixtures handle teardown yet.
- Assertion: direct `assert` on attributes and returned values; compare floats to rounded literals.

## Async Testing

Async tests are plain `async def` methods inside `Test*` classes; `asyncio_mode = "auto"` picks them up:

```python
class TestGenerateEvents:
    async def test_retry_then_data(self):
        cache = PriceCache()
        cache.update("AAPL", 190.0)
        frames = await collect(cache, FakeRequest(1))
        assert frames[0] == "retry: 1000\n\n"
        assert parse(frames[1])["AAPL"]["price"] == 190.0
```

Guidelines observed:
- Use very short real intervals for background loops, not sleeps of seconds: `SimulatorDataSource(price_cache=cache, update_interval=0.05)` then `await asyncio.sleep(0.3)` in `backend/tests/market/test_simulator_source.py`.
- Drive generator-based endpoints with a fake request object that answers `is_disconnected()` after N checks, and pass `interval=0` (`collect` helper in `test_stream.py`). This avoids real time and real disconnects.
- For HTTP routes, use FastAPI's `TestClient` on a minimal `FastAPI()` app with the router under test (`test_stream.py`).
- Always stop started sources in the same test, so no background task leaks into the next test.

## Mocking

**Framework:** `unittest.mock` (`MagicMock`, `patch`, `patch.dict`). No `pytest-mock`.

**Environment variables:**

```python
with patch.dict(os.environ, {"MASSIVE_API_KEY": "test-key"}, clear=True):
    source = create_market_data_source(cache)
assert isinstance(source, MassiveDataSource)
```

Always pass `clear=True` so the developer's real environment (including a real `MASSIVE_API_KEY`) cannot leak into the test.

**External REST client:**
- Inject a `MagicMock` through the constructor rather than patching imports. `MassiveDataSource(..., client=client)`, with `client.get_snapshot_all.return_value = [...]` (`test_massive.py`).
- Mock return values are real SDK model objects, not mocks, to catch attribute-name bugs:

```python
def snap(ticker, *, trade=None, minute=None, day=None, prev=None) -> TickerSnapshot:
    """Build a snapshot from the wire format, exactly as the client would."""
    data = {"ticker": ticker}
    if trade is not None:
        data["lastTrade"] = {"p": trade, "t": 1_760_000_000_000_000_000}
    ...
    return TickerSnapshot.from_dict(data)
```

Rule (from `backend/CLAUDE.md`): build fixtures with the real `massive` classes (`TickerSnapshot.from_dict`, `GroupedDailyAgg`, `PreviousCloseAgg`) and never use a bare `MagicMock` snapshot, because a `MagicMock` "has" any attribute.
- Exceptions from the SDK are built with real classes using the wire body: `BadResponse(NOT_ENTITLED)` with JSON string constants (`test_massive.py`).

**Time:**
- Inject a deterministic clock. `PriceCache(clock=...)` accepts a callable; `FakeClock` in `test_cache.py` exposes `.t` for advancing time. Use this instead of `time.sleep` for timestamp tests.
- Dates in EOD tests use a subclass of `date` to fix "today" (`class Saturday(date): ...` in `test_massive.py`) rather than patching `datetime`.

**Randomness:**
- `GBMSimulator` draws from `numpy.random` and `random`. Tests that need determinism either assert on invariants (non-negative prices, direction bounds) or seed the RNG within the test. Event probability is a constructor parameter (`event_probability`), so tests can set it to `0` to isolate drift.

**What to Mock:**
- The synchronous Massive REST client (`RESTClient`), via constructor injection.
- Environment variables, via `patch.dict(os.environ, ..., clear=True)`.
- Time sources, via injectable clocks.
- Fake HTTP request objects for SSE generators.

**What NOT to Mock:**
- `PriceCache`. Tests use the real cache so locking, versioning, history, and session-open logic are exercised.
- `massive` SDK model classes (`TickerSnapshot`, `GroupedDailyAgg`, `PreviousCloseAgg`) and exceptions (`BadResponse`). Build them from wire-format dicts or JSON strings.
- `GBMSimulator` inside `SimulatorDataSource` tests; the real simulator runs with a short interval.
- FastAPI routing for stream endpoints (use `TestClient`).

## Fixtures and Factories

**Test Data:**
- Module-level constants for wire payloads: `NOT_ENTITLED` and `BAD_KEY` JSON strings in `test_massive.py`.
- Factory helper functions instead of pytest fixtures: `snap(...)` builds a `TickerSnapshot`; `source_with(client, **kwargs)` returns `(MassiveDataSource, PriceCache)`.
- Price literals are realistic seed values (`190.50`, `175.00`, `420.0`), matching `backend/app/market/seed_prices.py`.

**Location:**
- Helpers live at the top of the test module that uses them.
- `backend/tests/conftest.py` is the designated place for shared fixtures. It is currently empty; add fixtures there when a second test module needs the same one (for example a database or app fixture once the SQLite layer exists).

**No pytest fixtures are defined** in the repository at analysis time (the `@pytest.fixture` grep returned no matches). Prefer a fixture in `conftest.py` only when setup needs teardown shared across modules; otherwise keep helpers local.

## Coverage

**Requirements:** None enforced. `pyproject.toml` configures `[tool.coverage.run]` (source `app`, omit `tests/*`) and `[tool.coverage.report]` exclusions (`pragma: no cover`, `__repr__`, `NotImplementedError`, `TYPE_CHECKING`, `__main__`), but there is no `fail_under` threshold.

**View Coverage:**

```bash
cd backend
uv run --extra dev pytest --cov=app --cov-report=term-missing
```

**Current test count:** 139 tests pass across the market modules (`backend/tests/market/`). The project plan refers to 73 market tests for the original implementation; the suite has grown with the §6 changes (session open, history buffer, poll interval).

## Test Types

**Unit Tests:**
- Pure logic: `PriceUpdate` / `PricePoint` properties (`test_models.py`), `PriceCache` semantics (`test_cache.py`), `pick_price` and `is_not_entitled` (`test_massive.py`), `_poll_interval` and source selection (`test_factory.py`).
- Simulator math (`test_simulator.py`): synchronous, no event loop.

**Integration-style Tests:**
- Source lifecycle with real asyncio tasks: `test_simulator_source.py` (start/stop, cache seeding, periodic updates) and `TestLiveMode`/`TestEodMode`/`TestTickerManagement` in `test_massive.py` (poller against a mocked REST client).
- SSE generator and history route through `TestClient` (`test_stream.py`).

**E2E Tests:**
- Not present. PLAN §12 specifies Playwright tests under `test/` with `LLM_MOCK=true` and `POST /api/reset` per test. Not yet implemented.

**Frontend tests:**
- Not present. PLAN §12 calls for React Testing Library tests in `frontend/`. No `frontend/` directory exists yet.

## Common Patterns

**Async Testing (background task lifecycle):**

```python
async def test_prices_update_over_time(self):
    cache = PriceCache()
    source = SimulatorDataSource(price_cache=cache, update_interval=0.05)
    await source.start(["AAPL"])

    initial_version = cache.version
    await asyncio.sleep(0.3)  # Several update cycles

    assert cache.version > initial_version
    await source.stop()
```

**Error Testing:**

```python
def test_bad_key_is_not_entitlement(self):
    assert not is_not_entitled(BadResponse(BAD_KEY))

def test_remove_nonexistent(self):
    cache = PriceCache()
    cache.remove("AAPL")  # Should not raise
```

Assert that a predicate is false for the wrong error class as well as true for the right one. Assert that idempotent operations do not raise rather than wrapping them in `pytest.raises`.

**Regression tests:**
- Name or document the regression in the docstring: `"""Regression: a real LastTrade has no `timestamp` attribute."""` in `TestLiveMode.test_real_snapshot_updates_cache` (`test_massive.py`). Follow this when fixing a bug in the market layer.

**Parametrized error and edge-case tables:**
- Use `@pytest.mark.parametrize` for input variants such as blank, whitespace, invalid, NaN, negative, and minimum-clamped env values (see `test_factory.py`).

## Guidance for Writing New Tests

1. Place the file in `backend/tests/<area>/test_<module>.py`, with an `__init__.py` in each new directory.
2. Use `class Test<Unit>:` with docstrings, plain `assert`, and `async def` for coroutine code (no `@pytest.mark.asyncio` needed).
3. Inject clocks, intervals, and HTTP clients through constructors; do not patch module internals.
4. Use real `massive` SDK classes for any Massive response fixture.
5. Stop every started `MarketDataSource` before the test returns (`try/finally` if assertions may fail).
6. Use `patch.dict(os.environ, {...}, clear=True)` for environment-dependent code.
7. Keep short real intervals (`0.05` s) for background loops; use `interval=0` for generator loops.
8. Move a helper into `backend/tests/conftest.py` only when two or more modules need it.
9. Run `uv run --extra dev pytest -v` and `uv run --extra dev ruff check app/ tests/` before finishing.

## Gaps to Track

- No tests for `backend/app/db/`, routes, portfolio logic, or LLM integration, because those modules do not exist yet.
- No E2E harness (`test/`, `docker-compose.test.yml`) and no Playwright setup.
- No coverage threshold; coverage is measured on demand only.
- `backend/tests/conftest.py` has no shared fixtures, so per-module helpers are duplicated where similar (for example, fake clocks and fake requests are local to their modules).

---

*Testing analysis: 2026-10-23*
