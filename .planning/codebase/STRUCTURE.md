---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
# Codebase Structure

**Analysis Date:** 2026-10-23

## Directory Layout

```
finally-std/                       # Repository root
├── .github/workflows/             # CI: claude.yml, claude-code-review.yml
├── backend/                       # Python uv project (implemented: market subsystem only)
│   ├── app/
│   │   ├── __init__.py            # Package docstring only (no app object yet)
│   │   └── market/                # Market data subsystem (complete)
│   ├── tests/                     # pytest suite
│   │   ├── conftest.py
│   │   └── market/                # Tests for app/market (73 tests per PLAN §12)
│   ├── market_data_demo.py        # Standalone terminal dashboard demo
│   ├── pyproject.toml             # Project metadata, deps, pytest/ruff/coverage config
│   ├── uv.lock                    # Locked dependencies
│   ├── README.md                  # Backend readme
│   └── CLAUDE.md                  # Backend developer guide (market API, commands)
├── frontend/                      # Empty directory (planned Next.js project)
├── planning/                      # Project-wide agent documentation
│   ├── PLAN.md                    # Authoritative project specification
│   ├── MARKET_DATA_SUMMARY.md     # Summary of the completed market subsystem
│   ├── MARKET_DATA_DESIGN.md      # Market data design
│   ├── MARKET_DATA_REVIEW.md      # Review findings and resolutions
│   ├── MARKET_INTERFACE.md        # Interface notes
│   ├── MARKET_SIMULATOR.md        # Simulator notes
│   ├── MASSIVE_API.md             # Massive API notes
│   └── archive/                   # Superseded copies of the market docs
├── test/                          # Empty directory (planned Playwright E2E suite)
├── .claude/                      # GSD tooling (excluded from project analysis)
├── CLAUDE.md                      # Project instructions for agents
├── README.md                      # Project overview and dev commands
├── LICENSE
└── .gitignore
```

Note: `frontend/` and `test/` are empty and therefore not tracked by git. `db/`, `scripts/`, `Dockerfile`, and `docker-compose.yml` are planned (PLAN §4, §11) and do not exist yet. `backend/app/db/` and `backend/app/api/` or equivalent route modules are planned but absent.

## Directory Purposes

**`backend/app/market/`:**
- Purpose: Market data producers, price cache, and SSE/history HTTP adapter.
- Contains: `__init__.py` (public exports), `models.py`, `interface.py`, `cache.py`, `factory.py`, `simulator.py`, `seed_prices.py`, `massive_client.py`, `stream.py`.
- Key files: `backend/app/market/cache.py` (shared state), `backend/app/market/interface.py` (ABC), `backend/app/market/factory.py` (source selection), `backend/app/market/stream.py` (routes).

**`backend/app/`:**
- Purpose: The FastAPI application package. Currently holds only the `market` subpackage.
- Contains: `__init__.py`, `market/`.
- Key files: `backend/app/__init__.py` (docstring).

**`backend/tests/market/`:**
- Purpose: Unit tests for each market module, mirroring module names.
- Contains: `test_cache.py`, `test_factory.py`, `test_massive.py`, `test_models.py`, `test_simulator.py`, `test_simulator_source.py`, `test_stream.py`.
- Key files: `backend/tests/conftest.py` (shared fixtures).

**`backend/tests/`:**
- Purpose: pytest root. `testpaths = ["tests"]` in `backend/pyproject.toml`; `asyncio_mode = "auto"`.

**`planning/`:**
- Purpose: Shared contract among agents. All specs and design notes live here.
- Contains: `PLAN.md` (authoritative spec), market design and review docs, `archive/` for superseded versions.
- Key files: `planning/PLAN.md`.

**`.github/workflows/`:**
- Purpose: GitHub Actions workflows for Claude Code automation (`claude.yml`, `claude-code-review.yml`). Not part of the runtime.

**`frontend/` (planned):**
- Purpose: Next.js TypeScript static export, built into the Docker image and served by FastAPI.
- Status: empty directory.

**`test/` (planned):**
- Purpose: Playwright E2E tests and `docker-compose.test.yml` (PLAN §12).
- Status: empty directory.

**`db/` (planned):**
- Purpose: Local SQLite location (`db/finally.db`, gitignored). Contains `.gitkeep` in the plan.
- Status: absent.

**`scripts/` (planned):**
- Purpose: `start_mac.sh`, `stop_mac.sh`, `start_windows.ps1`, `stop_windows.ps1` wrappers around `docker compose`.
- Status: absent.

## Key File Locations

**Entry Points:**
- `backend/market_data_demo.py`: runnable market demo (only executable program).
- `backend/app/__init__.py`: package root; the FastAPI app is planned to be created here or in `backend/app/main.py`.
- `backend/app/market/__init__.py`: market public API.

**Configuration:**
- `backend/pyproject.toml`: Python dependencies (fastapi, uvicorn, numpy, massive; dev extras), ruff (line length 100, rules E/F/I/N/W), pytest, coverage.
- `backend/uv.lock`: dependency lock.
- `.gitignore`: ignores `db/finally.db` and related SQLite files, and build artifacts.
- `.env` (planned, project root, gitignored): environment variables per PLAN §5. Not present in the repo.

**Core Logic:**
- `backend/app/market/cache.py`: `PriceCache`.
- `backend/app/market/simulator.py`: `GBMSimulator`, `SimulatorDataSource`.
- `backend/app/market/massive_client.py`: `MassiveDataSource`, `pick_price`, `is_not_entitled`.
- `backend/app/market/seed_prices.py`: seed prices and per-ticker parameters.
- `backend/app/market/stream.py`: `create_stream_router`, `_generate_events`.
- `backend/app/market/factory.py`: `create_market_data_source`.
- `backend/app/market/models.py`: `PriceUpdate`, `PricePoint`.

**Testing:**
- `backend/tests/conftest.py`: shared pytest fixtures.
- `backend/tests/market/`: market tests.
- `test/` (planned): Playwright E2E.

**Documentation:**
- `CLAUDE.md` (root): points agents to `planning/PLAN.md` and market summary.
- `backend/CLAUDE.md`: backend developer guide.
- `README.md`: overview, status, dev commands.

## Naming Conventions

**Files:**
- Python modules: `snake_case.py` (e.g., `massive_client.py`, `test_simulator_source.py`).
- Tests: `test_<module>.py` mirroring the module under test, placed under `backend/tests/<package>/`.
- Planning docs: `UPPER_SNAKE_CASE.md` (e.g., `MARKET_DATA_SUMMARY.md`, `PLAN.md`).
- Scripts (planned): `start_mac.sh` / `start_windows.ps1` pattern.

**Directories:**
- Python packages: lowercase, single word (`market`, `tests`, `app`).
- Top-level: lowercase, single word (`backend`, `frontend`, `planning`, `test`, `scripts`, `db`).

**Identifiers (observed in `backend/app/market/`):**
- Classes: `PascalCase` (`PriceCache`, `MarketDataSource`, `SimulatorDataSource`).
- Factories: `create_*` (`create_market_data_source`, `create_stream_router`).
- Private helpers: leading underscore (`_generate_events`, `_poll_once`, `_normalize`).
- Constants: `UPPER_SNAKE_CASE` at module level (`SSE_INTERVAL`, `DEFAULT_POLL_INTERVAL`) or class level (`PriceCache.HISTORY_SECONDS`).

## Import Structure

- Inside the package, use relative imports (`from .cache import PriceCache`).
- Consumers import from the package root: `from app.market import PriceCache, create_market_data_source, create_stream_router` (see `backend/CLAUDE.md`).
- Tests import from `app.market` or the submodule as needed.

## Where to Add New Code

**New market data behavior or provider:**
- Implementation: `backend/app/market/<name>.py` implementing `MarketDataSource` (`backend/app/market/interface.py`).
- Wire into selection in `backend/app/market/factory.py`.
- Tests: `backend/tests/market/test_<name>.py`.
- Export from `backend/app/market/__init__.py` if consumers need it.

**New API route group (portfolio, watchlist, chat, reset, health):**
- Implementation: a new module in the backend app package, following the router-factory pattern of `backend/app/market/stream.py` (e.g., `create_portfolio_router(db_path, price_cache, source)`). Suggested location: `backend/app/api/` or `backend/app/routes/` (planned; neither exists yet). Mount in the app factory.
- Tests: `backend/tests/` with a sibling directory per area (e.g., `backend/tests/api/`, `backend/tests/portfolio/`).

**Database schema and seed (planned):**
- `backend/app/db/schema.sql`, seed and connection helpers in `backend/app/db/`. Run at startup idempotently (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`, PLAN §7).

**LLM integration (planned):**
- A module under `backend/app/` (e.g., `backend/app/llm/`), with prompt and structured-output schema, and `LLM_MOCK` handling per PLAN §9. Tests under `backend/tests/llm/`.

**Application entry point / lifespan (planned):**
- `backend/app/main.py` (or equivalent): create `PriceCache`, call `create_market_data_source(cache)`, start with watchlist ∪ positions, mount market and API routers, serve `frontend/out` (or the copied `static/` directory) at `/`.

**Frontend (planned):**
- All code under `frontend/` (self-contained Next.js project). Do not import from Python code.

**E2E tests (planned):**
- `test/` with Playwright specs and `docker-compose.test.yml`.

**Utilities:**
- Shared helpers for the backend belong in the owning package. There is no `backend/app/utils/` yet; avoid creating one for single-use helpers.

## Special Directories

**`backend/.venv` (generated by `uv sync`):**
- Purpose: Virtual environment.
- Generated: Yes. Committed: No.

**`db/` (planned, repo root):**
- Purpose: Local SQLite file location in development. Docker uses the named volume `finally-data` at `/app/db`.
- Generated: Yes at runtime. Committed: No (`db/finally.db` gitignored, `.gitkeep` committed per PLAN §4).

**`.claude/`:**
- Purpose: GSD tooling and agent skills. Excluded from project code analysis.

**`.planning/codebase/` (this output):**
- Purpose: Generated codebase analysis documents for GSD commands.
- Generated: Yes. Committed: as decided by the orchestrator.

---

*Structure analysis: 2026-10-23*
