---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
<!-- refreshed: 2026-10-23 -->

# Technology Stack

**Analysis Date:** 2026-10-23

## Status Summary

Only the market data subsystem exists (`backend/app/market/`). The rest of the platform described in `planning/PLAN.md` (FastAPI app entry point, routes, SQLite schema, LLM integration, Next.js frontend, Dockerfile, docker-compose, start/stop scripts, Playwright E2E tests) is **planned but absent**. `frontend/` and `test/` are empty directories. `backend/app/db/` does not exist.

## Languages

**Primary:**
- Python 3.12+ - All implemented code: `backend/app/market/*.py`, `backend/tests/**/*.py`, `backend/market_data_demo.py`. `requires-python = ">=3.12"` in `backend/pyproject.toml`; Ruff targets `py312`.

**Secondary:**
- TypeScript / Next.js - Planned only for `frontend/` (not present).
- SQL - Planned `backend/app/db/schema.sql` (not present).
- Shell / PowerShell - Planned `scripts/*.sh` and `scripts/*.ps1` (not present).
- YAML - GitHub Actions workflows in `.github/workflows/claude.yml` and `.github/workflows/claude-code-review.yml`; Docker Compose not yet present.

## Runtime

**Environment:**
- CPython 3.12+ (no `.python-version` or `.nvmrc` file present; the `requires-python` constraint is the only pin)
- Node 20 is planned for the frontend build stage in the Dockerfile (not present)

**Package Manager:**
- `uv` (Astral) - project manager for `backend/`
- Lockfile: present - `backend/uv.lock` (lock `revision = 5`, `requires-python = ">=3.12"`)
- Build backend: `hatchling` (`[build-system]` in `backend/pyproject.toml`; wheel packages = `["app"]`)

## Frameworks

**Core (implemented):**
- NumPy 2.4.2 (locked) - used by the GBM simulator, `backend/app/market/simulator.py`, for random number generation and correlated draws
- FastAPI 0.128.7 (locked; declared `>=0.115.0`) - used only for the SSE/history router factory `create_stream_router()` in `backend/app/market/stream.py`. No application entry point exists yet.
- Starlette 0.52.1 (locked, transitive via FastAPI) - `StreamingResponse` used by `stream.py`
- Uvicorn 0.40.0 (locked; declared `uvicorn[standard]>=0.32.0`) - declared as the ASGI server; no run command is wired up yet

**Core (planned, not yet present):**
- Next.js (TypeScript, static export `output: 'export'`) with Tailwind CSS and Lightweight Charts (per `planning/PLAN.md` §10)
- LiteLLM → OpenRouter (model `openrouter/openai/gpt-oss-120b`, Cerebras provider) for chat (`planning/PLAN.md` §9). Not in `pyproject.toml` yet.
- Stdlib `sqlite3` for persistence (no ORM), planned in `backend/app/db/` (`planning/PLAN.md` §7)

**Testing:**
- pytest 9.0.2 (locked; declared `>=8.3.0`) - config in `[tool.pytest.ini_options]` of `backend/pyproject.toml` (`testpaths = ["tests"]`, `asyncio_mode = "auto"`)
- pytest-asyncio (declared `>=0.24.0`) - async tests
- pytest-cov (declared `>=5.0.0`) - coverage; config `[tool.coverage.run]` (source `app`)
- httpx 0.28.1 (locked) - FastAPI `TestClient` support in dev extras
- rich (declared `>=13.0.0`) - terminal demo output in `backend/market_data_demo.py`
- Playwright E2E - planned under `test/` (not present)
- React Testing Library - planned for `frontend/` (not present)

**Build/Dev:**
- Ruff 0.15.0 (locked; declared `>=0.7.0`) - lint and format. Config: `line-length = 100`, lint rules `E, F, I, N, W`, `E501` ignored. Defined in `backend/pyproject.toml`.
- Hatchling - build backend
- Docker multi-stage build - planned `Dockerfile` (Node 20 slim → Python 3.12 slim) (not present)

## Key Dependencies

**Critical (declared in `backend/pyproject.toml` `[project].dependencies`):**
- `massive` (declared `>=1.0.0`, locked **2.2.0**) - Massive (formerly Polygon.io) Python SDK. Used in `backend/app/market/massive_client.py` for `massive.RESTClient`, `massive.exceptions.BadResponse`, and `massive.rest.models` (`SnapshotMarketType`, `TickerSnapshot`). Only used when `MASSIVE_API_KEY` is set.
- `numpy` (declared `>=2.0.0`, locked 2.4.2) - simulator math in `backend/app/market/simulator.py`
- `fastapi` (declared `>=0.115.0`, locked 0.128.7) - see Frameworks above
- `uvicorn[standard]` (declared `>=0.32.0`, locked 0.40.0) - ASGI server

**Dev extras (`[project.optional-dependencies].dev`):**
- `httpx`, `pytest`, `pytest-asyncio`, `pytest-cov`, `rich`, `ruff` (see Testing / Build above)

**Infrastructure (planned, not yet declared):**
- `python-dotenv` - planned to load `../.env` in local dev (`planning/PLAN.md` §5). Not in `pyproject.toml`.
- LiteLLM - planned for LLM calls (`planning/PLAN.md` §9). Not in `pyproject.toml`.

**Version note:** The declared lower bound for `massive` (`>=1.0.0`) differs from the locked version (2.2.0). Installs via `uv sync` use the lockfile; the declared bound is loose.

## Configuration

**Environment variables read by code today:**
- `MASSIVE_API_KEY` - read in `backend/app/market/factory.py`. Non-empty value selects `MassiveDataSource`; otherwise `SimulatorDataSource`.
- `MASSIVE_POLL_INTERVAL` - read in `backend/app/market/factory.py` (`_poll_interval()`). Default 15s, minimum 1s; invalid or non-finite values fall back to the default.

**Environment variables planned but not yet read (`planning/PLAN.md` §5):**
- `OPENROUTER_API_KEY` - enables real LLM chat; absence yields `503` on `POST /api/chat`
- `LLM_MOCK` - `true` enables deterministic mock LLM responses
- `DB_PATH` - SQLite file path (default `db/finally.db` locally; `/app/db/finally.db` in Docker)

**Environment file:**
- `.env` at the repo root is gitignored (`.gitignore`); `.env.example` is **not present** in the repo. `backend/README.md` and the root `README.md` document the variables. The `.env` file was not read for this analysis.
- Local dev loading via `python-dotenv` is planned, not implemented.

**Build configuration:**
- `backend/pyproject.toml` - project metadata, dependencies, Ruff, pytest, coverage config
- `backend/uv.lock` - locked dependency graph
- No `tsconfig.json`, `package.json` (for the app), `next.config.*`, `Dockerfile`, or `docker-compose.yml` exist yet.

## Platform Requirements

**Development:**
- Python 3.12+ and `uv`
- Install and test: `cd backend && uv sync --extra dev && uv run --extra dev pytest -v`
- Lint: `uv run --extra dev ruff check .` / format: `uv run --extra dev ruff format .`
- Demo: `uv run market_data_demo.py` (from `backend/`)
- Docker (planned): `docker compose up -d --build` on port 8000

**Production (planned):**
- Single Docker container: Node 20 slim build stage, Python 3.12 slim runtime, uvicorn on port 8000, SQLite at `/app/db/finally.db` on named volume `finally-data`. Target hosts per `planning/PLAN.md` §11: Docker, AWS App Runner, or Render.

---

*Stack analysis: 2026-10-23*
