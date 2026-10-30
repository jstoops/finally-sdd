# Walking Skeleton — FinAlly — AI Trading Workstation

**Phase:** 1
**Generated:** 2026-10-26

## Capability Proven End-to-End

> A user starts one container, opens `http://localhost:8000`, and sees the seeded default watchlist streaming live prices. The path runs from SQLite through the FastAPI lifespan, the market source, PriceCache and SSE, to a Next.js static export served by the same app, and ends in one browser EventSource.

Tracer: plan 01-02 Task 1, packaged into the container by plan 01-03.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Backend framework | FastAPI >= 0.135 on Starlette 1.x (locked 0.162.0 / 1.10.0), uvicorn 0.54. The app factory `create_app(settings=None, *, source_factory=None)` runs as `uvicorn app.main:create_app --factory --workers 1`. Startup work happens only in `lifespan`. | D-16. Starlette 1.x removed decorator events. The factory keeps `app.main` import side-effect free, so tests never load a real `.env`. One worker because `PriceCache` is process-local. |
| Frontend framework | Next.js 16.4.3 App Router with `output: "export"`, TypeScript ~5.9.3, Tailwind 4.3.3 via `@tailwindcss/postcss`, zustand 5 stores, Lightweight Charts 5.2.1. Node 22. | PLAN section 3 and section 10. A static export gives a single origin with no CORS in production. Zustand selectors keep each 500ms tick from re-rendering the whole app. |
| Data layer | Stdlib `sqlite3` at `DB_PATH` (`<repo>/db/finally.db` locally, `/app/db/finally.db` in Docker). Connection per unit of work, `BEGIN IMMEDIATE` transactions, WAL. `schema.sql` creates all six PLAN section 7 tables in Phase 1. | PLAN section 7. Later phases never alter the schema. No ORM. |
| Seeding | Seed once (user decision A1): the 10 default tickers are inserted only when the default `users_profile` row is newly created. Watchlist order is `added_at, rowid`. | Edits survive restarts (success criterion 4). Phase 2 Reset restores defaults explicitly. |
| Mutation concurrency | One `asyncio.Lock` (`state_lock`) is created in `create_app` and shared by watchlist mutations and snapshot writes. Phase 2 trades and reset take the same lock. | One serialization point for cash, positions and the tracked set. |
| Tracked tickers | `TickerTracker.reconcile()` is the only caller of `source.add_ticker` / `remove_ticker`, keeping the priced set equal to watchlist ∪ positions. Its calls run on the event loop. | PLAN section 6. A held ticker stays priced. The simulator is not thread-safe. |
| API contract | PLAN section 6/8 shapes, frozen in `frontend/src/api/types.ts`. Errors are `{"error": msg}` (400 business, 404 not found), with FastAPI's default 422 for malformed bodies. Unknown `/api/*` returns a JSON 404 through a catch-all registered before the static mount. | The frontend and E2E suites depend on exact keys and codes. |
| Real-time | One `EventSource` per page, behind a status machine (green/yellow/red dot, 1s/2s/5s backoff after CLOSED). It feeds one `usePrices` store whose ticks are replaced on every frame. Rows subscribe per ticker. | MD-01, MD-04. One stream, no polling. |
| Auth | None. Single user `"default"`. The `8000:8000` mapping (user decision A2) is documented as LAN-reachable. | PLAN section 2: no login, zero-stakes simulated money. |
| Deployment target | One Docker image, multi-stage: `node:22-slim` builds the export, then `python:3.12-slim` with uv 0.13.5. Compose project `finally`, image `finally:latest`, named volume `finally-data` mounted at `/app/db`, and a Python healthcheck on `/api/health`. Idempotent `scripts/start_*` / `stop_*` wrap `docker compose`. | PLAN section 11. One command for students. |
| Dev loop | `next dev` on :3000 calls uvicorn on :8000 through `NEXT_PUBLIC_API_BASE` (`frontend/.env.development`). `CORSMiddleware` is added only when `DEV_CORS_ORIGIN` is set, and never in Docker. | D-13. Rewrites are unsupported with static export. |
| Directory layout | Backend: `backend/app/{config.py, main.py, errors.py, tickers.py, tracker.py, snapshots.py, watchlist.py, db/{__init__.py, schema.sql, seed.py}, api/{watchlist.py, system.py}, market/ (existing)}`. Frontend: `frontend/src/{app, api, stream, store, domain, components, test}`. Router factories are `create_*_router(deps)` with no module-level state. | Mirrors the established `app.market` patterns. Phase 2/3 add `api/portfolio.py`, `api/chat.py` and services beside `watchlist.py`. |
| Testing | Backend: pytest with `TestClient(create_app(Settings(...), source_factory=...))` and hand-written fakes. Frontend: Vitest 5, jsdom 30 and Testing Library, with `FakeEventSource`, a mocked `lightweight-charts`, and `data-testid` hooks on every panel. | Nyquist validation. Hooks are ready for Phase 3 Playwright (TST-04). |

## Stack Touched in Phase 1

- [x] Project scaffold (framework, build, lint, test runner): plan 01-01 (uv bump, Next.js scaffold), Vitest harness in 01-05
- [x] Routing, at least one real route: `GET /api/watchlist`, `/api/health`, existing SSE and history routes (01-02); POST/DELETE watchlist (01-04)
- [x] Database, at least one real read AND one real write: the seed-once write and the watchlist read (01-02); add/remove and snapshot writes (01-04)
- [x] UI, at least one interactive element wired to the API: row selection charting history (01-05/01-06); add/remove (01-07)
- [x] Deployment: `docker compose up -d --build --wait` plus `scripts/start_mac.sh` / `scripts/start_windows.ps1` (01-03)

## Out of Scope (Deferred to Later Slices)

- Trading, portfolio API and panels (header totals, positions, heatmap, P&L chart), trade history, Reset: Phase 2
- AI chat, LiteLLM/OpenRouter, mock LLM, Reset clearing chat, sparklines and chart selection: Phase 3
- Playwright E2E suite and `test/docker-compose.test.yml`: Phase 3
- uv `exclude-newer` supply-chain window: Phase 3, with LiteLLM
- Authentication, multi-user, non-root container user, cloud deployment
- Any change to `backend/app/market/` beyond integration needs

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Trading and live portfolio. A trade service under `state_lock`, `GET /api/portfolio` reusing `snapshots.portfolio_value`, trade-bar, positions, heatmap and P&L panels filling the Phase 1 grid slots, and Reset.
- Phase 3: AI copilot and the complete terminal. Chat through the same watchlist and trade services, the chat panel in its grid slot, and the full unit and Playwright suites.
