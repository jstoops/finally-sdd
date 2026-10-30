---
phase: 02-trading-and-live-portfolio
plan: 06
subsystem: api, ui
tags: [fastapi, sqlite, lightweight-charts, baseline-series, zustand, reset, pnl]

requires:
  - phase: 02-trading-and-live-portfolio
    provides: "PortfolioService, TradeService, insert_snapshot, TickerTracker.reconcile_quietly, shared state_lock (02-01, 02-02)"
  - phase: 02-trading-and-live-portfolio
    provides: "usePortfolio store with sequence guards, Header readouts, Terminal grid (02-03, 02-04, 02-05)"
provides:
  - "GET /api/portfolio/history: snapshots oldest first, ORDER BY recorded_at, rowid"
  - "PortfolioService.history() and PortfolioService.reset()"
  - "POST /api/reset: any POST returns 200 {status: ok} (PLAN section 8, user decision U-1)"
  - "toSnapshotSeries (frontend/src/domain/pnl.ts): ISO to ascending chart seconds, same-second collapse"
  - "PnlChart: BaselineSeries at 10,000, single-point markers, 30 s poll (PNL_REFRESH_MS)"
  - "usePortfolio.snapshots, historyLoaded, loadHistory(), reset()"
  - "Header Reset button (reset-button, reset-error, RESET_CONFIRM)"
affects: [phase-03-chat, phase-03-e2e, PF-10]

actuals:
  tokens: 12160
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Destructive reset runs as one BEGIN IMMEDIATE transaction under the shared state_lock, writes its own snapshot with insert_snapshot(conn, cache), then reconciles tracked tickers"
    - "Per-resource response-sequence guard in the store (history has its own counter, like trades)"
    - "Chart data memoized from a raw store selector; setData plus applyOptions in one effect"

key-files:
  created:
    - frontend/src/domain/pnl.ts
    - frontend/src/domain/pnl.test.ts
    - frontend/src/components/PnlChart.tsx
    - frontend/src/components/PnlChart.test.tsx
    - backend/tests/test_reset.py
  modified:
    - backend/app/portfolio.py
    - backend/app/api/portfolio.py
    - backend/tests/test_portfolio_api.py
    - frontend/src/store/portfolio.ts
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx
    - frontend/src/components/Header.tsx
    - frontend/src/components/header.test.tsx

key-decisions:
  - "POST /api/reset takes no body and reads no headers; no 400 path (user decision U-1, binding)"
  - "P&L chart is a BaselineSeries based at STARTING_CASH (green above, red below), per planner assumption OQ-3"
  - "PnlChart polls only on its interval; the mount load comes from Terminal's refresh(), so mount does not double-fetch"
  - "Reset clears no sparklines, chat or chart selection; that stays with PF-10 in Phase 3 (OQ-2)"
  - "RESET_TABLES is a module constant of fixed table names used in the DELETE loop (no user input reaches the f-string)"

patterns-established:
  - "Reset service shape: async with lock -> to_thread(tx) -> reconcile_quietly(context)"
  - "Header actions live in small local components with their own pending and error state"

requirements-completed: [PF-02, PF-03, PF-08, PF-09, WL-06]

coverage:
  - id: D1
    description: "GET /api/portfolio/history returns {snapshots: [{total_value, recorded_at}]} oldest first, with the startup snapshot and one per trade; same-second rows keep insertion order"
    requirement: PF-03
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestHistory"
        status: pass
    human_judgment: false
  - id: D2
    description: "toSnapshotSeries floors ISO times, skips non-finite values, drops out-of-order points and collapses equal seconds to the last value"
    requirement: PF-08
    verification:
      - kind: unit
        ref: "frontend/src/domain/pnl.test.ts#toSnapshotSeries"
        status: pass
    human_judgment: false
  - id: D3
    description: "PnlChart: BaselineSeries at 10,000, pointMarkersVisible for a single point, empty and loading states, 30 s refetch, cleanup on unmount; store refetches history after each trade and in refresh(), with a sequence guard"
    requirement: PF-08
    verification:
      - kind: unit
        ref: "frontend/src/components/PnlChart.test.tsx#PnlChart"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#portfolio store history"
        status: pass
    human_judgment: false
  - id: D4
    description: "PortfolioService.reset restores cash, clears positions, trades, snapshots and chat, restores the default watchlist in order, writes one 10,000 snapshot, re-syncs tracked tickers, waits for the shared lock and stays consistent against concurrent buys"
    requirement: PF-09
    verification:
      - kind: integration
        ref: "backend/tests/test_reset.py#TestResetService"
        status: pass
    human_judgment: false
  - id: D5
    description: "POST /api/reset returns 200 {status: ok} and resets for JSON, body-less and text/plain POSTs (U-1)"
    requirement: PF-09
    verification:
      - kind: integration
        ref: "backend/tests/test_reset.py#TestResetRoute"
        status: pass
    human_judgment: false
  - id: D6
    description: "Header Reset button: window.confirm gate, cancel sends nothing, one POST then portfolio, trades, history and watchlist refetch, disabled while pending, inline error"
    requirement: PF-09
    verification:
      - kind: unit
        ref: "frontend/src/components/header.test.tsx#Header reset"
        status: pass
    human_judgment: false
  - id: D7
    description: "Container image serves the Phase 2 read routes, rejects quantity 0 with 400 and serves the terminal page (non-destructive smoke)"
    verification:
      - kind: other
        ref: "docker compose up -d --build --wait + curl smoke (Task 2 verify)"
        status: pass
    human_judgment: false
  - id: D8
    description: "End-of-phase human check: cash to the cent under rapid clicks, heatmap and table visuals, P&L chart points after trades and a single point after reset, held ticker keeps streaming after watchlist removal, Reset cancel and confirm"
    verification: []
    human_judgment: true
    rationale: "Visual density, colors and rapid-click behavior against the real container are manual-only items from 02-VALIDATION.md (the plan's human-check block)"

duration: 12min
completed: 2026-10-28
status: complete
plan_head_before: 50859a51e922e79e862c28f57c8e97fc4702fadb
plan_head_after: 1fc18afcf9121b6009ac184da668e9ef3e6636ea
commits: 4
---

# Phase 2 Plan 06: P&L Chart and Account Reset Summary

**The P&L panel now plots total portfolio value as a BaselineSeries around $10,000, fed by a new GET /api/portfolio/history and refreshed every 30 s and after each trade. A confirmed header Reset runs one locked SQLite transaction that restores $10,000, the default watchlist and a single fresh snapshot, then re-syncs the tracked tickers.**

## Performance

- **Duration:** about 12 min
- **Started:** 2026-10-28T23:16:48Z
- **Completed:** 2026-10-28T23:28:11Z
- **Tasks:** 2 of 2
- **Files modified:** 13 (5 created, 8 modified)

## Accomplishments

- `GET /api/portfolio/history` (`PortfolioService.history`) returns every snapshot oldest first. It orders by `recorded_at, rowid`, so snapshots in the same second keep insertion order. A single SELECT means a concurrent trade's snapshot is either all there or not there.
- `toSnapshotSeries` makes snapshots safe for the chart: it floors times to whole seconds, skips non-finite values, drops times that go backwards and keeps the last value when two share a second. This means `setData` never gets times out of order (Pitfall 6).
- `PnlChart` creates its chart once, uses a `BaselineSeries` at `STARTING_CASH` (green above, red below), and turns point markers on when there are 0 or 1 points. It shows "Loading P&L…" and "No P&L history yet" states, polls every `PNL_REFRESH_MS` (30000) and cleans up the interval and chart on unmount. It replaces the P&L coming-soon panel, so only the chat panel still says "coming in Phase".
- `usePortfolio` gains `snapshots`, `historyLoaded` and `loadHistory()`, which has its own sequence guard. A successful `trade()` refetches the history, and `refresh()` now loads portfolio, trades and history.
- `PortfolioService.reset()` holds the shared `state_lock` for one BEGIN IMMEDIATE transaction, in this order:
  - upsert cash to 10000.0
  - delete positions, trades, snapshots, chat messages and watchlist
  - re-insert the 10 defaults in order, sharing one `added_at`
  - `insert_snapshot(conn, cache)`

  After that it calls `reconcile_quietly("reset")`.
- `POST /api/reset` takes no parameters, so any POST returns `200 {"status": "ok"}`, exactly as PLAN section 8 says (U-1).
- The header Reset button asks `window.confirm(RESET_CONFIRM)` first and is disabled while the request runs. It shows failures inline as `reset-error`. On success it refreshes the portfolio store and reloads the watchlist.

## Task Commits

1. **Task 1: P&L chart end to end**
   - RED `300704d` (test)
   - GREEN `4f0c72f` (feat)
2. **Task 2: Reset end to end**
   - RED `4873ba8` (test)
   - GREEN `1fc18af` (feat)

No refactor commits were needed. The small memoization cleanup in `PnlChart` went into the Task 1 GREEN commit, before it was committed.

## Files Created/Modified

- `backend/app/portfolio.py`: `history()`/`_load_history`, `reset()`/`_reset_tx`, `RESET_TABLES`, logger
- `backend/app/api/portfolio.py`: `GET /api/portfolio/history`, `POST /api/reset`
- `backend/tests/test_portfolio_api.py`: `TestHistory` (4 tests), `SNAPSHOT_KEYS`
- `backend/tests/test_reset.py`: service, tracked-ticker, empty, lock, concurrency and U-1 route tests (8 tests)
- `frontend/src/domain/pnl.ts` and `pnl.test.ts`: `toSnapshotSeries` and 6 tests
- `frontend/src/components/PnlChart.tsx` and `PnlChart.test.tsx`: the chart panel and 6 tests
- `frontend/src/store/portfolio.ts`: snapshot slice, `loadHistory`, `reset`, trade and refresh hooks
- `frontend/src/components/Terminal.tsx`: renders `<PnlChart />`
- `frontend/src/components/terminal.test.tsx`: `applyOptions` on the mocked series, updated panels test, 5 history store tests
- `frontend/src/components/Header.tsx`: `RESET_CONFIRM` and `ResetButton`
- `frontend/src/components/header.test.tsx`: one-button assertion and 4 reset tests

## Decisions Made

- `PnlChart` does not fetch on mount. `Terminal`'s `refresh()` already loads the history on mount, so the panel only adds the 30 s interval and no first load is duplicated. The trade and reset paths refetch through the store.
- The reset DELETE loop uses a module constant `RESET_TABLES` of fixed table names. No request data reaches the f-string SQL.
- The `_reset_tx` docstring explains why `seed()`, the script runner and `SnapshotRecorder` are not used, without naming them as calls. That keeps the plan's "no call to seed( or executescript" acceptance grep literal-clean.

## Deviations from Plan

None in scope or behavior. The plan was executed as written.

One environment note, not a code deviation. The worktree had no `node_modules` or `.venv`, so they were restored from the committed lockfiles with `npm ci` and `uv sync --extra dev`. No packages were added, and `git diff --quiet 245a40c -- backend/pyproject.toml backend/uv.lock frontend/package.json frontend/package-lock.json` passes.

## TDD Notes

Both tasks followed RED, then GREEN, with separate `test(02-06)` and `feat(02-06)` commits. This is an `execute` plan with `workflow.tdd_mode: false`, so the format-based RED evidence classifier was not required.

- **Task 1 RED:**
  - Backend `TestHistory` failed with `KeyError: 'snapshots'`, because the route did not exist and the catch-all returned 404.
  - The store and panel assertions in `terminal.test.tsx` failed on the planned behavior: history not loaded by refresh, and the P&L coming-soon label still present.
  - `pnl.test.ts` and `PnlChart.test.tsx` failed to import their not-yet-created modules. This is a load failure, not an assertion failure; their assertions passed once the modules existed.
- **Task 2 RED:**
  - The service tests failed with `AttributeError: 'PortfolioService' object has no attribute 'reset'`, and the route tests failed with 404 instead of 200.
  - The header tests failed because `reset-button` was missing and there were 0 buttons instead of 1.

## Issues Encountered

- `python` in `backend/` resolved to a pyenv-win shim with no version set, so one inline patch script did nothing. The edits were redone with the Edit tool, and tests caught it before any commit.

## Verification Results

- `uv run --directory backend --extra dev pytest -q`: 365 passed. `ruff check` passes and `ruff format --check` shows 47 files already formatted.
- `npm --prefix frontend test`: 254 passed across 16 files. Lint, typecheck and `next build` (static export) all pass.
- Grep gates pass:
  - BaselineSeries, `pointMarkersVisible` and the history route are present.
  - `insert_snapshot(conn` and `window.confirm` are present.
  - Only `tracker.py` (plus `app/market/`) mentions `source.add_ticker` or `source.remove_ticker`.
  - The dependency files are unchanged since 245a40c.
- Container smoke: `docker compose up -d --build --wait` reached healthy. Then:
  - `/api/portfolio`, `/api/portfolio/history` and `/api/trades` answered.
  - A quantity-0 trade got 400.
  - `/` served the terminal page.
  - The smoke never filled a trade and never called reset. The container (`finally-app-1`) is still running at http://localhost:8000 for the end-of-phase human check.

## User Setup Required

None. No external service configuration is needed.

## Next Phase Readiness

- This is the last plan of Phase 2. The end-of-phase human check (coverage D8) is next.
- Phase 3 can call `POST /api/reset` with no special body or headers for E2E isolation. PF-10 (clearing chat, sparklines and chart selection on reset) is still Phase 3 work.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*

## Self-Check: PASSED
