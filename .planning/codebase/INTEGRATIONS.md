---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
# External Integrations

**Analysis Date:** 2026-10-23

## Status Summary

Only two external integrations exist in code today: the Massive market data REST API (optional) and the GitHub Actions Claude Code workflows (CI only). The database, LLM provider, auth, hosting and frontend integrations described in `planning/PLAN.md` are planned but not implemented.

## APIs & External Services

**Market Data - Massive (formerly Polygon.io), optional:**
- Implemented in `backend/app/market/massive_client.py` (`MassiveDataSource`), selected by `backend/app/market/factory.py` when `MASSIVE_API_KEY` is non-empty.
- SDK/Client: `massive` package, `massive.RESTClient` (injectable via the `client` constructor argument for tests)
- Transport: REST polling, not WebSocket. One multi-ticker snapshot call per poll in LIVE mode.
- Poll interval: `MASSIVE_POLL_INTERVAL` (default 15s, minimum 1s)
- Endpoints used (via the SDK):
  - Snapshot endpoint (all tracked tickers in one call) - LIVE mode. Price preference order: last trade → latest minute bar → running day close → previous day close.
  - Grouped daily endpoint - EOD mode, used once a key is found to lack snapshot entitlement. Refreshed at most hourly (`EOD_REFRESH_SECONDS = 3600`).
  - Previous-close (`/prev`) fallback - capped at 2 calls per poll (`EOD_PREV_CLOSE_PER_POLL = 2`) to respect the free tier.
- Auth: `MASSIVE_API_KEY` env var, passed as `api_key` to `RESTClient`. Never hardcoded.
- Error handling: `massive.exceptions.BadResponse` is inspected. `NOT_AUTHORIZED` / "not entitled" → switch to EOD mode. Other errors (e.g. "Unknown API Key") are treated as failures.
- Rate limit assumption: free tier, about 5 calls/min (documented in `backend/app/market/factory.py` and `planning/PLAN.md` §6).
- Tests: `backend/tests/market/test_massive.py` and `backend/tests/market/test_factory.py` use mocked clients; no live calls are made in tests.

**Market Data - built-in simulator (default, no external service):**
- `backend/app/market/simulator.py` (`SimulatorDataSource`) generates prices in-process using GBM with NumPy. Seed prices and per-ticker parameters are in `backend/app/market/seed_prices.py`. No network access.

**LLM - OpenRouter / Cerebras (planned, not implemented):**
- Specified in `planning/PLAN.md` §9: LiteLLM → OpenRouter, model `openrouter/openai/gpt-oss-120b`, Cerebras as inference provider, structured outputs.
- Auth would use `OPENROUTER_API_KEY`. No LiteLLM dependency, no client code, and no `POST /api/chat` route exist yet.
- `LLM_MOCK=true` mock mode is specified but not implemented.

**Developer tooling - Anthropic Claude Code GitHub Actions (CI, not app runtime):**
- `.github/workflows/claude.yml` - triggers on `@claude` mentions in issues, PR comments and reviews. Uses `anthropics/claude-code-action@v1` with secret `CLAUDE_CODE_OAUTH_TOKEN`, `id-token: write` permission.
- `.github/workflows/claude-code-review.yml` - automated Claude Code review on pull requests (uses `anthropics/claude-code-action@v1`).
- These are repository tooling, not part of the running application.

## Data Storage

**Databases:**
- None implemented. The planned store is SQLite via stdlib `sqlite3` (no ORM), file at `DB_PATH` (default `db/finally.db`; `/app/db/finally.db` in Docker), schema in planned `backend/app/db/schema.sql`. See `planning/PLAN.md` §7.
- `db/` directory at repo root is not present (the `.gitignore` covers `finally.db` per the plan).

**File Storage:**
- Local filesystem only (planned Docker named volume `finally-data` mounted at `/app/db`). No object storage.

**Caching:**
- In-process only. `backend/app/market/cache.py` (`PriceCache`) is a thread-safe in-memory price cache holding latest price, previous price, session open price, timestamp, and a 5-minute price history ring buffer per ticker. No Redis or external cache.

## Authentication & Identity

**Auth Provider:**
- None. The app is single-user with no login or signup (`planning/PLAN.md` §2). User is hardcoded to `"default"` in the planned schema.
- Secrets handling: the only secrets referenced in code is `MASSIVE_API_KEY` (read from `os.environ`). `.env` is gitignored.

## Monitoring & Observability

**Error Tracking:**
- None detected.

**Logs:**
- Python standard `logging` module. Module loggers used in `backend/app/market/*.py` (e.g. factory selection logged at INFO, invalid env values at WARNING). No log shipping configured.

## CI/CD & Deployment

**Hosting:**
- Not yet deployed. Planned: single Docker container on port 8000 (`planning/PLAN.md` §11); optional AWS App Runner / Render deployment (Terraform in `deploy/` is a stretch goal, not present).

**CI Pipeline:**
- GitHub Actions only, for Claude Code assistance and PR review: `.github/workflows/claude.yml`, `.github/workflows/claude-code-review.yml`. No test or build workflow exists for the backend or frontend.

## Environment Configuration

**Required env vars (current code):**
- None are strictly required. The app defaults to the simulator when `MASSIVE_API_KEY` is absent.
- `MASSIVE_API_KEY` - optional; enables Massive market data
- `MASSIVE_POLL_INTERVAL` - optional; default 15

**Required env vars (planned, `planning/PLAN.md` §5):**
- `OPENROUTER_API_KEY` - required for real LLM chat (absence returns `503` from `POST /api/chat`)
- `LLM_MOCK` - optional, `true` for deterministic mock responses
- `DB_PATH` - optional SQLite path

**Secrets location:**
- Local: `.env` at repo root (gitignored), loaded by Docker Compose `env_file` (planned) or `python-dotenv` (planned). The `.env` file was not read during this analysis.
- GitHub Actions: repository secret `CLAUDE_CODE_OAUTH_TOKEN`.

## Webhooks & Callbacks

**Incoming:**
- None. (The planned API exposes SSE `GET /api/stream/prices` and `GET /api/prices/{ticker}/history` through `backend/app/market/stream.py`'s `create_stream_router()`, but no app mounts this router yet.)

**Outgoing:**
- None from application code. The Massive client makes outbound HTTPS REST polls (see above). GitHub Actions call the Anthropic action (CI only).

---

*Integration audit: 2026-10-23*
