---
phase: 01-live-market-terminal
plan: 02
subsystem: api
tags: [fastapi, lifespan, sqlite, sse, nextjs-static-export, zustand, cors]

requires:
  - phase: 01-live-market-terminal (plan 01-01)
    provides: toolchain (FastAPI 0.162 / Starlette 1.10, python-dotenv, Next.js 16 static export, zustand, Tailwind theme)
provides:
  - create_app factory (uvicorn app.main:create_app --factory) with lifespan seed-once -> source.start(watchlist ∪ positions)
  - Settings.from_env (dotenv override=False, empty = unset) and configure_logging
  - Database helper (connect, BEGIN IMMEDIATE transaction, init, tracked_tickers), now_iso, six-table schema.sql, seed-once
  - WatchlistService.list_entries and GET /api/watchlist in the PLAN §8 shape
  - GET /api/health, JSON 404 catch-all for unknown /api/*, opt-in dev CORS (D-13)
  - StaticFiles mount of frontend/out when index.html exists (API-only otherwise)
  - Frozen frontend contract types (src/api/types.ts), apiFetch/ApiError client, usePrices store + startPriceStream (the one EventSource)
affects: [01-03, 01-04, 01-05, 01-06, 01-07, phase-02-portfolio, phase-03-chat]

actuals:
  tokens: 9300
  tasks: 2
  commits: 3
plan_head_before: 10acbf6e0166e6999be1748f8d7417b117696ed5
plan_head_after: 00f69f44d2b5d1df1098b4945af2e97fb04cf0fc

tech-stack:
  added: []
  patterns:
    - "App factory + lifespan, no module-level app; tests inject Settings and a source_factory"
    - "Router factories per domain (create_watchlist_router, create_system_router)"
    - "Connection per unit of work, explicit BEGIN IMMEDIATE transactions, blocking DB work via asyncio.to_thread"
    - "Seed once: watchlist seeded only when the users_profile row is newly inserted"
    - "Registration order: stream, watchlist, system, /api catch-all, static mount last"
    - "Frontend price store replaces ticks per frame (never merges); one EventSource opened from a page effect"

key-files:
  created:
    - backend/app/config.py
    - backend/app/main.py
    - backend/app/db/__init__.py
    - backend/app/db/schema.sql
    - backend/app/db/seed.py
    - backend/app/watchlist.py
    - backend/app/api/__init__.py
    - backend/app/api/watchlist.py
    - backend/app/api/system.py
    - backend/tests/test_main.py
    - frontend/src/api/types.ts
    - frontend/src/api/client.ts
    - frontend/src/store/prices.ts
  modified:
    - frontend/src/app/page.tsx

key-decisions:
  - "WatchlistService reads the watchlist with its own short-lived connection (no repo layer yet); Wave 3 adds add/remove and the tracker reconcile on top"
  - "Database.path is a read-only property so lifespan can log the resolved path without exposing internals"
  - "Health and the JSON 404 are registered before StaticFiles; the all-methods catch-all means a wrong method on a real /api route returns 404 (accepted per research Pattern 6)"

patterns-established:
  - "test_main.py: RecordingSource fake + make_app(tmp_path, static_dir, source_factory, dev_cors_origin) and always `with TestClient(app)` so lifespan runs"
  - "data-testid hooks: watchlist, watchlist-line-{TICKER}, price-{TICKER}"

requirements-completed: [OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, WL-01, WL-02, MD-01]

coverage:
  - id: D1
    description: "Startup seeds once (10000.0 cash, 10 default tickers) and later restarts never re-seed removed defaults or duplicate the user"
    requirement: OPS-02
    verification:
      - kind: integration
        ref: "backend/tests/test_main.py#TestLifespan::test_seed_once_removed_default_stays_removed"
        status: pass
      - kind: unit
        ref: "backend/tests/test_main.py#TestDatabase::test_init_twice_is_idempotent"
        status: pass
    human_judgment: false
  - id: D2
    description: "Lifespan runs schema + seed, then starts the source with watchlist ∪ positions (deduped, watchlist first; [] when empty), and stops it on shutdown"
    requirement: OPS-01
    verification:
      - kind: integration
        ref: "backend/tests/test_main.py#TestLifespan::test_held_ticker_on_watchlist_tracked_once"
        status: pass
      - kind: integration
        ref: "backend/tests/test_main.py#TestLifespan::test_empty_watchlist_starts_with_no_tickers"
        status: pass
      - kind: integration
        ref: "backend/tests/test_main.py#TestLifespan::test_starts_source_with_watchlist_and_stops_it"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/watchlist returns the defaults in PLAN order, keys ticker/price/open_price/added_at, cache prices passed through, null when unpriced"
    requirement: WL-02
    verification:
      - kind: integration
        ref: "backend/tests/test_main.py#TestWatchlist"
        status: pass
    human_judgment: false
  - id: D4
    description: "Settings loads .env without overriding the environment; importing app.main has no side effects"
    requirement: OPS-03
    verification:
      - kind: unit
        ref: "backend/tests/test_main.py#TestImport::test_main_has_no_module_level_app"
        status: pass
    human_judgment: false
  - id: D5
    description: "GET /api/health -> 200 {status: ok}"
    requirement: OPS-04
    verification:
      - kind: integration
        ref: "backend/tests/test_main.py#TestHealth::test_health_ok"
        status: pass
    human_judgment: false
  - id: D6
    description: "Unknown /api/* is a JSON 404 for five methods with and without the static mount; real routes still resolve; built frontend served at /"
    requirement: OPS-05
    verification:
      - kind: integration
        ref: "backend/tests/test_main.py#TestApiNotFound"
        status: pass
      - kind: integration
        ref: "backend/tests/test_main.py#TestStatic::test_serves_built_frontend"
        status: pass
    human_judgment: false
  - id: D7
    description: "CORS headers only when DEV_CORS_ORIGIN is set (D-13)"
    verification:
      - kind: integration
        ref: "backend/tests/test_main.py#TestDevCors"
        status: pass
    human_judgment: false
  - id: D8
    description: "Browser page lists the seeded tickers with prices updating live from the single EventSource"
    requirement: MD-01
    verification:
      - kind: other
        ref: "uvicorn app.main:create_app --factory smoke: GET / 200 text/html, /api/stream/prices emits retry + data frames"
        status: pass
    human_judgment: true
    rationale: "No browser test exists yet (Vitest/Playwright arrive in later plans); seeing rows tick in a real browser needs a human or the E2E suite"

duration: 7min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 02: Walking-Skeleton Tracer Summary

**FastAPI `create_app` factory that seeds SQLite once, starts the market source with watchlist ∪ positions in lifespan, serves `GET /api/watchlist`, health, a JSON 404 for unknown `/api/*` and opt-in dev CORS, and serves the Next.js static export whose watchlist rows tick from one EventSource**

## Performance

- **Duration:** about 7 min
- **Started:** 2026-10-27T07:50:43Z
- **Completed:** 2026-10-27T07:57:30Z
- **Tasks:** 2
- **Files modified:** 14 (13 created, 1 modified)

## Accomplishments
- The tracer works end to end: seeded SQLite -> lifespan -> simulator -> PriceCache -> REST and SSE -> static export -> browser rows. A live `uvicorn app.main:create_app --factory` smoke run returned health 200, the 10 priced defaults, `/` as text/html, `{"error":"Not found"}` for `POST /api/nope`, and SSE `retry: 1000` followed by data frames.
- Seed-once (user decision A1): a removed default ticker stays removed after restart, and the user row is never duplicated.
- Frozen frontend contract (`src/api/types.ts`), `apiFetch`/`ApiError` client, and the single `usePrices` store + `startPriceStream()` for the Wave 3 plans.
- App hardening for the container plan: `/api/health`, all-methods JSON 404 catch-all before the static mount, and CORS only when `DEV_CORS_ORIGIN` is set.

## Task Commits

1. **Task 1: End-to-end tracer** - `5c9db3b` (feat)
2. **Task 2: Health, JSON 404, opt-in dev CORS** - `c474155` (test, RED) then `00f69f4` (feat, GREEN)

No REFACTOR commit was needed.

## TDD Gate Compliance (Task 2)

- **RED** (`c474155`): `pytest -q tests/test_main.py -k "Health or NotFound or DevCors"` gave 13 failed, 2 passed. Every target failed on a planned assertion: `/api/health` returned 404 instead of 200; `/api/nope` returned FastAPI's default 404 body (or StaticFiles' response) instead of `{"error": "Not found"}`; the preflight had no `access-control-allow-origin`. There were no import, collection or fixture errors. The 2 passes are regression guards for behavior that already held (`GET /` still serves index.html, no CORS header by default). Semantic assessment: valid RED. The machine classifier (`check tdd-red-evidence`) has no pytest adapter, so it was not run; `workflow.tdd_mode` is false for this project.
- **GREEN** (`00f69f4`): 15/15 targets pass; full suite 169 passed.

## Files Created/Modified
- `backend/app/config.py` - Settings.from_env (dotenv override=False, empty = unset), REPO_ROOT/defaults, configure_logging
- `backend/app/db/__init__.py` - Database (connect, transaction, init, tracked_tickers), now_iso, SCHEMA_PATH
- `backend/app/db/schema.sql` - all six PLAN §7 tables, UNIQUE (user_id, ticker), three time indexes
- `backend/app/db/seed.py` - DEFAULT_* constants and seed-once
- `backend/app/watchlist.py` - WatchlistService.list_entries
- `backend/app/api/__init__.py`, `api/watchlist.py`, `api/system.py` - router factories
- `backend/app/main.py` - create_app, SourceFactory, install_api_not_found, mount_static
- `backend/tests/test_main.py` - 30 tests (lifespan, seed-once, ordering, static, health, 404, CORS)
- `frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/store/prices.ts` - contract, client, store
- `frontend/src/app/page.tsx` - client page with header and live watchlist rows

## Decisions Made
- WatchlistService opens its own short-lived connection for the read; add/remove and the tracker reconcile are left to Wave 3.
- The default static dir comment was moved above the constant to avoid an awkward formatter wrap (style only).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `ruff format --check` flagged two new files on the first pass. Fixed by running `ruff format` before the Task 1 commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Wave 3 plans can extend `create_app` (watchlist add/remove, snapshot loop, tracker), `types.ts` and `startPriceStream` (01-05 replaces its body with the reconnecting state machine and keeps the signature).
- `frontend/out` must be built before `pytest -rs` for `test_serves_built_frontend` to run instead of skipping.

---
*Phase: 01-live-market-terminal*
*Completed: 2026-10-27*
