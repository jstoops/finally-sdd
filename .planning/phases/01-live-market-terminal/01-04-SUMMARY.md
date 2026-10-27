---
phase: 01-live-market-terminal
plan: 04
subsystem: api
tags: [fastapi, sqlite, asyncio, watchlist, snapshots, pytest]

requires:
  - phase: 01-live-market-terminal
    provides: "01-02 walking skeleton: create_app/lifespan, Database, WatchlistService.list_entries, GET /api/watchlist, Settings.from_env"
provides:
  - "POST /api/watchlist (201 new / 200 duplicate / 400 malformed or full / 422 bad body)"
  - "DELETE /api/watchlist/{ticker} (204 / 404 not on watchlist / 400 malformed)"
  - "DomainError / NotFoundError and the {error} envelope handlers (app/errors.py)"
  - "normalize_ticker + TICKER_RE (app/tickers.py), the authoritative ticker rule"
  - "TickerTracker.reconcile: the only app caller of source.add_ticker/remove_ticker"
  - "Shared state_lock (asyncio.Lock) on app.state for every mutation"
  - "portfolio_value pure valuation, SnapshotRecorder, run_snapshot_loop (30 s)"
  - "Lifespan: initial snapshot before serving, named snapshot-loop task, cancelled before source.stop()"
  - "Shared pytest fixtures: settings, make_app, client, recording_source"
affects: [01-07 watchlist panel UI, phase-02 trades/portfolio/reset, phase-03 chat actions]

actuals:
  tokens: 14230
  tasks: 2
  commits: 4
plan_head_before: 95b2c0886b891a5bb44190924dbd0bdaf7993326
plan_head_after: a3d23bb73f7010dfdb9921ce3e0eff8f4a1ab011

tech-stack:
  added: []
  patterns:
    - "Domain exceptions mapped to the {error} envelope via FastAPI exception_handlers; RequestValidationError keeps the default 422"
    - "Mutations: normalize outside the lock, then under state_lock run a BEGIN IMMEDIATE transaction in to_thread, then reconcile on the event loop"
    - "Source ticker changes are always a set-difference reconcile against db.tracked_tickers(), never direct add/remove calls"
    - "Background loops: sleep, then try/except Exception with logger.exception; CancelledError propagates; shutdown cancels and awaits"

key-files:
  created:
    - backend/app/errors.py
    - backend/app/tickers.py
    - backend/app/tracker.py
    - backend/app/snapshots.py
    - backend/tests/test_watchlist.py
    - backend/tests/test_tracker.py
    - backend/tests/test_snapshots.py
    - backend/tests/test_config.py
  modified:
    - backend/app/watchlist.py
    - backend/app/api/watchlist.py
    - backend/app/main.py
    - backend/tests/conftest.py
    - backend/tests/test_main.py

key-decisions:
  - "NotFoundError subclasses DomainError (status_code 404 vs 400), so Phase 3 chat actions can catch one type for every business failure"
  - "normalize_ticker rejects non-ASCII before uppercasing (\"aß\" can never become \"ASS\")"
  - "The initial snapshot runs inside the lifespan try block, so a failed first snapshot still stops the market source"
  - "state_lock is created per create_app and shared by WatchlistService and SnapshotRecorder; Phase 2 trade and reset services must take the same lock"

patterns-established:
  - "create_app(..., snapshot_interval=...) is the test seam for the loop interval"
  - "Tests build apps via the make_app fixture (extra kwargs pass through to create_app) and fake sources via recording_source()"

requirements-completed: [WL-03, WL-04, WL-05, OPS-01, OPS-03]

coverage:
  - id: D1
    description: "Add a ticker via POST /api/watchlist: 201 priced entry, 200 duplicate (any case/spacing), 400 malformed/empty/non-ASCII, 422 missing or non-string field"
    requirement: WL-03
    verification:
      - kind: integration
        ref: "backend/tests/test_watchlist.py::TestAdd"
        status: pass
      - kind: unit
        ref: "backend/tests/test_watchlist.py::TestNormalizeTicker"
        status: pass
      - kind: unit
        ref: "backend/tests/test_watchlist.py::TestConcurrency::test_concurrent_adds_of_same_ticker_insert_one_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "Remove a ticker via DELETE /api/watchlist/{ticker}: 204 and unpriced unless held, 404 with '{TICKER} is not on your watchlist', 400 malformed"
    requirement: WL-04
    verification:
      - kind: integration
        ref: "backend/tests/test_watchlist.py::TestRemove"
        status: pass
      - kind: unit
        ref: "backend/tests/test_watchlist.py::TestConcurrency::test_remove_racing_add_leaves_consistent_state"
        status: pass
    human_judgment: false
  - id: D3
    description: "50-ticker cap: 49 -> 201, 50 -> 400 naming 50, duplicate at 50 -> 200; concurrent adds cannot exceed 50"
    requirement: WL-05
    verification:
      - kind: integration
        ref: "backend/tests/test_watchlist.py::TestCap::test_boundary_49_then_50_then_full"
        status: pass
      - kind: unit
        ref: "backend/tests/test_watchlist.py::TestConcurrency::test_concurrent_adds_cannot_exceed_cap"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tracked tickers reconcile to watchlist ∪ positions; source calls run on the event loop; second reconcile is a no-op"
    verification:
      - kind: unit
        ref: "backend/tests/test_tracker.py::TestReconcile"
        status: pass
    human_judgment: false
  - id: D5
    description: "Startup records one 10000.0 snapshot before requests, then one every 30 s; failures logged and loop continues; shutdown cancels the task before source.stop()"
    requirement: OPS-01
    verification:
      - kind: unit
        ref: "backend/tests/test_snapshots.py"
        status: pass
      - kind: integration
        ref: "backend/tests/test_main.py::TestSnapshotLifespan"
        status: pass
    human_judgment: false
  - id: D6
    description: "Settings precedence: env beats .env, blank values treated as unset, missing .env is fine, .env loaded before the market factory reads MASSIVE_API_KEY, per-app isolation"
    requirement: OPS-03
    verification:
      - kind: unit
        ref: "backend/tests/test_config.py"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 04: Watchlist Mutations, Tracker Reconcile and Portfolio Snapshots Summary

**POST/DELETE watchlist routes with a duplicate-safe add, a 50-ticker cap checked inside the BEGIN IMMEDIATE transaction, and immediate simulator pricing via a watchlist ∪ positions reconcile. The lifespan now records the initial portfolio snapshot and runs a 30-second snapshot loop under one shared `state_lock`.**

## Performance

- **Duration:** about 8 min
- **Started:** 2026-10-27T08:01:16Z
- **Completed:** 2026-10-27T08:08:48Z
- **Tasks:** 2 of 2
- **Files modified:** 13 (8 created, 5 modified)

## Accomplishments

- **Watchlist add:** `POST /api/watchlist` returns 201 with a priced entry in simulator mode. A duplicate returns 200 with the existing entry, in any case and with surrounding spaces. A malformed, empty or non-ASCII ticker returns 400 `{"error"}`. A missing field or a non-string ticker keeps FastAPI's 422.
- **Watchlist remove:** `DELETE /api/watchlist/{ticker}` returns 204, and the ticker leaves both the source and the PriceCache unless it is held. Deleting again returns 404 `PYPL is not on your watchlist`, and a malformed path ticker returns 400.
- **Cap:** the watchlist holds at most 50 tickers. The duplicate check runs before the cap check, and the cap is counted with COUNT(*) inside the same transaction, so concurrent adds cannot exceed it.
- **Tracker:** `TickerTracker.reconcile()` is the single place that adds tickers to or removes them from the market source, and it runs on the event loop. A held ticker stays priced after it leaves the watchlist.
- **Snapshots (OPS-01):** the lifespan records one snapshot (10000.0) before requests are served, then starts the named `snapshot-loop` task. Shutdown cancels and awaits that task, then stops the source.
- **Settings (OPS-03):** the loading rules are now pinned by tests: environment precedence, blank values treated as unset, `.env` loaded before the market factory, and per-app isolation.

## Task Commits

1. **Task 1: Watchlist add/remove, cap, tracker (WL-03/04/05)**
   - RED `954e81f` (test): failing tests plus shared conftest fixtures
   - GREEN `ed7eb49` (feat): errors, tickers, tracker, service, routes and main wiring
2. **Task 2: Snapshots in lifespan and Settings precedence (OPS-01/03)**
   - RED `0651e96` (test): snapshot, lifespan-order and config tests
   - GREEN `a3d23bb` (feat): snapshots.py and the lifespan wiring

No REFACTOR commits were needed.

## Files Created/Modified

- `backend/app/errors.py`: `DomainError` (400), `NotFoundError` (404), and `error_handlers()`, which also maps Starlette `HTTPException` to `{"error": detail}`.
- `backend/app/tickers.py`: `TICKER_RE` and `normalize_ticker` (strip, empty check, ASCII check, uppercase, fullmatch).
- `backend/app/tracker.py`: `TickerTracker.reconcile()`.
- `backend/app/snapshots.py`: `SNAPSHOT_INTERVAL = 30.0`, `portfolio_value`, `SnapshotRecorder`, `run_snapshot_loop`.
- `backend/app/watchlist.py`: `WATCHLIST_CAP`, a new constructor `(db, cache, tracker, lock)`, `add`, `remove`, and the `lock` property.
- `backend/app/api/watchlist.py`: the `WatchlistAdd` model (no pattern) and the POST and DELETE routes.
- `backend/app/main.py`: `state_lock`, the tracker, exception handlers, the recorder, the snapshot task and the `snapshot_interval` kwarg.
- `backend/tests/conftest.py`: `RecordingSource` (now also records added/removed calls and call threads) and the `settings`, `make_app`, `client` and `recording_source` fixtures.
- `backend/tests/test_main.py`: switched to the fixtures and gained `TestSnapshotLifespan`.
- `backend/tests/test_watchlist.py`, `test_tracker.py`, `test_snapshots.py`, `test_config.py`: new test files.

## Decisions Made

- `NotFoundError` subclasses `DomainError` and differs only in `status_code`. One handler serves both, and later callers such as chat actions can catch every business failure with one `except DomainError`.
- `normalize_ticker` returns a "Ticker is required." message for blank input and an "Invalid ticker ..." message otherwise. Non-ASCII input is rejected before `.upper()`.
- The initial `recorder.record()` runs inside the lifespan `try`. If it fails, `source.stop()` still runs.
- `state_lock` is built per `create_app` call and stored on `app.state`. **Phase 2 trade and reset services must take this same lock** (the reversibility was flagged as costly in the plan).

## Deviations from Plan

None. The plan was executed as written.

## TDD Notes

- **Task 1 RED:** collection failed with `ModuleNotFoundError` for `app.errors`, `app.tickers` and `app.tracker`. This is a load-level RED rather than an assertion-level one. `workflow.tdd_mode` is false and this is not a `type: tdd` plan, so the format-based RED evidence gate was not enforced. Semantic assessment: the target modules did not exist, so every behavior test was necessarily unimplemented.
- **Task 2 RED:** `test_snapshots.py` failed at collection (no `app.snapshots`). The four `TestSnapshotLifespan` tests and the per-app isolation test failed with `TypeError` on the missing `snapshot_interval` keyword. The Settings precedence and empty-value tests in `test_config.py` passed at RED, as expected. They characterize behavior that `Settings.from_env` already had from 01-02, and the plan asks for those tests, not new code.
- **GREEN:** 249 passed and 1 skipped (`frontend/out` is not built in this worktree). Ruff check and format are clean. The timing-sensitive tests passed on five consecutive runs.

## Issues Encountered

- The worktree isolation harness blocks writes inside the `.git` directory, so the plan-commit ledger file could not be written. `plan_head_before` is the base SHA verified at startup (`95b2c08`), and `commits: 4` is measured with `git rev-list --count 95b2c08..HEAD`.

## Verification

- `uv run --directory backend --extra dev pytest -q`: 249 passed, 1 skipped
- `ruff check app tests`: all checks passed. `ruff format --check app tests`: 37 files already formatted
- `grep -nE "pattern\s*=" backend/app/api/watchlist.py`: no match
- `source.(add|remove)_ticker` callers in `backend/app` outside `app/market`: only `tracker.py`
- `grep 'name="snapshot-loop"' main.py` and `grep 'SNAPSHOT_INTERVAL = 30.0' snapshots.py`: both match
- `git diff --exit-code backend/uv.lock backend/pyproject.toml`: no dependency change

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- Plan 01-07 can wire the watchlist panel to `POST /api/watchlist` and `DELETE /api/watchlist/{ticker}`. Error bodies are always `{"error": string}` for 400 and 404.
- Phase 2 can reuse `portfolio_value` for `GET /api/portfolio`, call `recorder.record()` after trades and reset, call `tracker.reconcile()` after a sell to zero, and take `app.state.state_lock`.

---
*Phase: 01-live-market-terminal*
*Completed: 2026-10-27*

## Self-Check: PASSED

- All 8 created files and the SUMMARY exist on disk
- Commits 954e81f, ed7eb49, 0651e96, a3d23bb are on the branch (95b2c08..HEAD)
- Working tree clean after the SUMMARY commit
