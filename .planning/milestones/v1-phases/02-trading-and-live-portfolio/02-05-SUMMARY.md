---
phase: 02-trading-and-live-portfolio
plan: 05
subsystem: ui
tags: [react, zustand, fastapi, sqlite, vitest, pytest, trade-history]

requires:
  - phase: 02-01
    provides: PortfolioService, create_portfolio_router, TradeBar/TradePanel, Trade/TradesResponse types, formatQty
  - phase: 02-03
    provides: usePortfolio loads, refresh(), response-sequence guard, stubApi with GET /api/trades default
provides:
  - "GET /api/trades -> {trades: [...]} newest first, at most 100 rows (TRADES_LIMIT)"
  - "PortfolioService.list_trades(limit=TRADES_LIMIT)"
  - "usePortfolio.trades / tradesLoaded / loadTrades() with its own sequence guard; fills prepended once by id; refresh() loads portfolio and trades"
  - "TradeBar client checks (QTY_ERROR, plain-decimal quantity rule), pending guard, MESSAGE_MS = 3000 auto-clearing fill message"
  - "TradeHistory component rendered under TradeBar in TradePanel"
affects: [02-06, phase-03-chat, e2e]

actuals:
  tokens: 9250
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Per-list response-sequence guard: a GET takes its number at request time, an optimistic prepend from a confirmed response takes a fresh one"
    - "Single message slot with a ref-held timer cleared on replace and on unmount"

key-files:
  created:
    - frontend/src/components/TradeHistory.tsx
    - frontend/src/components/TradeHistory.test.tsx
    - frontend/src/components/TradeBar.test.tsx
  modified:
    - frontend/src/components/TradeBar.tsx
    - frontend/src/store/portfolio.ts
    - backend/app/portfolio.py
    - backend/app/api/portfolio.py
    - backend/tests/test_portfolio_api.py

key-decisions:
  - "Quantity rule is ^\\d*\\.?\\d+$ then Number > 0, so '1,5', '1e3' and '1.' are rejected inline (only '.' as separator)"
  - "The success message timer clears only the message it was started for; any new message clears the previous timer"
  - "The trade list has its own sequence guard separate from the portfolio guard; a failed or malformed GET /api/trades leaves the list unchanged"
  - "TradeHistory renders 'No trades yet' whenever the list is empty (selects only the raw trades array, as planned)"

patterns-established:
  - "Fill confirmation text is built only from the response trade (side, formatQty(quantity), ticker, formatPrice(price))"

requirements-completed: [TRD-07, TRD-08, TRD-09, TRD-10]

coverage:
  - id: D1
    description: "Trade bar rejects empty/malformed/non-ASCII tickers and bad quantities before sending; disables Buy/Sell while pending; no confirm dialog"
    requirement: TRD-07
    verification:
      - kind: unit
        ref: "frontend/src/components/TradeBar.test.tsx#TradeBar client checks / TradeBar pending state / never opens a confirmation dialog"
        status: pass
    human_judgment: false
  - id: D2
    description: "400 server error shown inline (role alert, data-kind error), 422 shows 'Invalid request', editing either field clears it"
    requirement: TRD-08
    verification:
      - kind: unit
        ref: "frontend/src/components/TradeBar.test.tsx#TradeBar server errors"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fill shows 'Bought 10 AAPL @ $190.52' from the recorded trade for 3,000 ms (2,999 present, 3,000 gone, restart on second fill, cleared on unmount), clears quantity, keeps ticker"
    requirement: TRD-09
    verification:
      - kind: unit
        ref: "frontend/src/components/TradeBar.test.tsx#TradeBar fill confirmation / TradeBar fill message timer"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/trades newest first, TRADE_KEYS order, 100 cap, same-second rowid DESC ordering"
    requirement: TRD-10
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTrades"
        status: pass
    human_judgment: false
  - id: D5
    description: "Trade history list under the trade bar: store prepend/refetch/sequence guard, rows with colored side, formatted quantity, price and local time; fill at top immediately"
    requirement: TRD-10
    verification:
      - kind: unit
        ref: "frontend/src/components/TradeHistory.test.tsx"
        status: pass
    human_judgment: false
  - id: D6
    description: "Trade panel layout: history scrolls inside the bottom row and reads well in the terminal"
    verification: []
    human_judgment: true
    rationale: "Visual fit and scrolling inside the Terminal grid are not asserted by any test"

duration: 8min
completed: 2026-10-28
status: complete
commits: 4
plan_head_before: d85304d3d86eb9babd14dd294249442613a4fb94
plan_head_after: 35907de5d37dcbbbbe8ba2c355113c9a747652fa
---

# Phase 2 Plan 05: Trade Bar Feedback and Trade History Summary

**Trade bar with client-side checks, pending lock and a 3-second fill confirmation built from the recorded trade, plus GET /api/trades (newest 100, rowid tiebreak) feeding a TradeHistory list under the bar with sequence-guarded prepend and refetch**

## Performance

- **Duration:** about 8 min
- **Started:** 2026-10-28T23:04:43Z
- **Completed:** 2026-10-28T23:12:46Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- TradeBar checks the input before sending: the ticker is sanitized and checked with `tickerError`, and the quantity must be a plain decimal greater than 0. Bad input shows an inline error and sends no request. A ref plus `pending` state locks both buttons while a trade is in flight.
- One message slot. Server errors stay until the next edit. A fill message clears itself after `MESSAGE_MS = 3000`; a new message restarts the timer and unmounting clears it.
- `GET /api/trades` comes from `PortfolioService.list_trades`, which runs `ORDER BY executed_at DESC, rowid DESC LIMIT ?` with `TRADES_LIMIT = 100` off the event loop.
- `usePortfolio` now has a `trades` slice with its own response-sequence guard. A fill is prepended once by id and then the list refetches. `refresh()` loads the portfolio and the trades in parallel.
- `TradeHistory` is mounted under `TradeBar` inside `TradePanel`, below a "Trades" caption.

## Task Commits

1. **Task 1: Trade bar feedback**: `4785b73` (test, RED), `013c728` (feat, GREEN)
2. **Task 2: Trade history end to end**: `dd538a6` (test, RED), `35907de` (feat, GREEN)

No REFACTOR commits were needed.

## TDD Gate Compliance

- **Task 1 RED:** `TradeBar.test.tsx` was written first. The target test "clears the success message after exactly MESSAGE_MS" failed on its assertion (`expected undefined to be 3000`), and the classifier returned `RED_EVIDENCE_OK` (TAP, target test re-run alone). The full-file run also failed on assertions for the "1e3" and "1." quantity cases and for the timer restart and unmount cases. Semantic check: the behavior did not exist yet, so the failures were the intended ones. Vitest's TAP reporter writes multi-line `actual` values without indentation, which makes the full-file report malformed TAP. That is why the target was re-run on its own.
- **Task 2 RED:** the backend target `test_fresh_app_has_no_trades` failed with `404 == 200`, and the classifier returned `RED_EVIDENCE_OK` (JUnit XML). The frontend tests failed on assertions against a null `TradeHistory` skeleton committed with the tests, and on the missing `loadTrades`. The skeleton turns a module-load failure into real assertion failures.
- **GREEN:** every target test passes after its `feat(02-05)` commit.

## Files Created/Modified
- `frontend/src/components/TradeBar.tsx`: client checks, `QTY_ERROR`, `MESSAGE_MS`, pending ref, timer, and TradeHistory inside TradePanel
- `frontend/src/components/TradeBar.test.tsx`: 28 behavior tests (client checks, errors, pending state, fill text, fake-timer boundary)
- `frontend/src/components/TradeHistory.tsx`: history list (`trade-history`, `trade-history-row` with `data-side`, `trade-history-empty`)
- `frontend/src/components/TradeHistory.test.tsx`: store slice, component and TradePanel integration tests
- `frontend/src/store/portfolio.ts`: `trades`, `tradesLoaded`, `loadTrades`, trade-list sequence guard, prepend on fill plus refetch, `refresh()` loads both
- `backend/app/portfolio.py`: `TRADES_LIMIT`, `list_trades`, `_load_trades`
- `backend/app/api/portfolio.py`: `GET /api/trades`
- `backend/tests/test_portfolio_api.py`: `TestTrades`, an `insert_trade` helper, and `run_sql` now commits

## Decisions Made
- See key-decisions in the frontmatter. All of them follow the plan's assumptions A1, A2 and F-1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `run_sql` in test_portfolio_api.py did not commit**
- **Found during:** Task 2 RED
- **Issue:** Rows inserted through the helper would never be committed, so the 101-row and same-second tests could not seed data.
- **Fix:** `run_sql` now commits, matching the helper in `test_watchlist.py`. Added `insert_trade`.
- **Files modified:** backend/tests/test_portfolio_api.py
- **Committed in:** dd538a6

**2. [Rule 3 - Blocking] `formatLocalTime` takes the branded `Time` type**
- **Found during:** Task 2 GREEN (typecheck)
- **Issue:** Passing a plain number failed `tsc`.
- **Fix:** Cast to `UTCTimestamp` (type-only import from lightweight-charts) in the component and in the test.
- **Files modified:** frontend/src/components/TradeHistory.tsx, frontend/src/components/TradeHistory.test.tsx
- **Committed in:** 35907de

---

**Total deviations:** 2 auto-fixed (both blocking)
**Impact on plan:** None on behavior; both were test-support or typing fixes.

## Issues Encountered
- The worktree had no `node_modules` or `.venv`. Ran `npm ci` and `uv sync --extra dev` from the existing lockfiles; no new packages, and `git diff 245a40c` on the dependency files is empty.

## Verification
- `uv run --directory backend --extra dev pytest -q`: 352 passed, 1 skipped
- `ruff check app tests` and `ruff format --check app tests`: clean
- `npm --prefix frontend test`: 11 files, 197 tests passed; `lint`, `typecheck` and `build` (static export) green
- Grep gates: the `"/api/trades"` route, the parameterized `LIMIT ?` and the store fetch are present, and there is no `window.confirm` in TradeBar.tsx

## User Setup Required
None. No external service configuration is needed.

## Next Phase Readiness
- The Phase 3 chat refetch can call `usePortfolio.getState().refresh()` (portfolio plus trades), or `loadTrades()` on its own.
- Terminal.tsx and terminal.test.tsx were not touched (the sibling plan 02-04 owns them). TradeHistory reaches the terminal through the existing `TradePanel` mount.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*

## Self-Check: PASSED
