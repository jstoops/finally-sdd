---
phase: 01-live-market-terminal
plan: 07
subsystem: ui
tags: [react, zustand, nextjs, tailwind, vitest, user-event, watchlist]

requires:
  - phase: 01-live-market-terminal (01-04)
    provides: POST /api/watchlist (201/200/400) and DELETE /api/watchlist/{ticker} (204/404)
  - phase: 01-live-market-terminal (01-05)
    provides: useWatchlist store (setEntries + nextSelection), Watchlist panel and memoized WatchlistRow, Vitest harness
provides:
  - TICKER_RE, sanitizeTickerInput, tickerError in frontend/src/api/ticker.ts (single client copy of the ticker rule)
  - addTicker / removeTicker store actions returning an inline error string or null
  - AddTickerForm pinned under the Watchlist title with one shared inline error slot
  - Per-row remove button (remove-{T}) with hover/focus/touch visibility
affects: [01-06 chart selection, phase-02 trade bar ticker validation, phase-03 chat watchlist refresh, e2e watchlist tests]

actuals:
  tokens: 6246
  tasks: 2
  commits: 4
plan_head_before: 23f7eaa716763894b1db83b8023b8b8135e92f49
plan_head_after: 6c4d422d40a3846f45dc086f77f31b7f3c1c657b

tech-stack:
  added: []
  patterns:
    - "Store actions for mutations resolve to `string | null` (inline message or success) instead of throwing"
    - "Panel-level error state passed down as a stable useState setter so memoized rows can report into one slot"
    - "Client input sanitization uppercases ASCII only, so non-ASCII stays visible for validation"

key-files:
  created:
    - frontend/src/api/ticker.ts
    - frontend/src/api/ticker.test.ts
    - frontend/src/components/watchlist.test.tsx
  modified:
    - frontend/src/store/watchlist.ts
    - frontend/src/components/Watchlist.tsx

key-decisions:
  - "sanitizeTickerInput uppercases only ASCII a-z, so a typed German sharp s stays in the input and tickerError rejects it rather than folding it to SS"
  - "The non-ASCII check uses /[^ -~]/ (outside printable ASCII) to avoid ESLint no-control-regex while still rejecting every non-ASCII character"
  - "The inline error state lives in the Watchlist panel and is shared by AddTickerForm and every row's remove button (one slot, D-07)"
  - "A failed remove only sets the error; a successful remove leaves any existing message alone until the next keystroke"
  - "Rows are flex: the select button is flex-1 and keeps its 28px grid, the 20px remove button sits at the far right and reserves its space even while hidden"

patterns-established:
  - "Ticker rule: import TICKER_RE / tickerError from @/api/ticker; no other source file may declare the ticker regex"
  - "Mutation actions re-read store state with get() after the await to avoid stale lists"

requirements-completed: [WL-03, WL-04, WL-05, MD-07]

coverage:
  - id: D1
    description: "Single client ticker rule: TICKER_RE, sanitizeTickerInput (trim, strip whitespace, uppercase) and tickerError (empty, format, non-ASCII)"
    requirement: WL-05
    verification:
      - kind: unit
        ref: "frontend/src/api/ticker.test.ts"
        status: pass
      - kind: other
        ref: "grep -rlE 'A-Z0-9\\.\\]\\{0,9\\}' frontend/src (non-test) -> only frontend/src/api/ticker.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "Add a ticker from the pinned panel input: Enter or +, client block with no request, 201 appends at the bottom, 200 re-add harmless, server 400 (incl. 50 cap) inline, error clears on keystroke, + disabled while pending"
    requirement: WL-03
    verification:
      - kind: unit
        ref: "frontend/src/components/watchlist.test.tsx#AddTickerForm"
        status: pass
    human_judgment: false
  - id: D3
    description: "One-click row remove: DELETE, stopPropagation so the row is not selected, 404 drops stale row, other failures inline, Tab reachable after select button"
    requirement: WL-04
    verification:
      - kind: unit
        ref: "frontend/src/components/watchlist.test.tsx#remove button"
        status: pass
    human_judgment: false
  - id: D4
    description: "Removing the selected ticker selects the first remaining ticker, or none when the list empties"
    requirement: MD-07
    verification:
      - kind: unit
        ref: "frontend/src/components/watchlist.test.tsx#selects the first remaining ticker when the selected one is removed"
        status: pass
      - kind: unit
        ref: "frontend/src/components/watchlist.test.tsx#leaves nothing selected when the last ticker is removed"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual and live behavior: x appears on hover, always visible at tablet/touch width, new ticker starts ticking, chart follows the new selection"
    verification: []
    human_judgment: true
    rationale: "Hover/touch visibility, live SSE ticking of a newly added ticker and the chart switching depend on a real browser and running backend; jsdom only proves the classes and store state (plan human-check)"

duration: 5min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 07: Watchlist Add and Remove Summary

**Pinned "Add ticker" form with client-side TICKER_RE validation and a single inline error slot for format errors and server 400s, plus a one-click row × that DELETEs the ticker and re-selects per MD-07**

## Performance

- **Duration:** ~5 min of execution (plus context loading)
- **Started:** 2026-10-27T08:17:08Z
- **Completed:** 2026-10-27T08:21:32Z
- **Tasks:** 2
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `frontend/src/api/ticker.ts` holds the only client copy of `^[A-Z][A-Z0-9.]{0,9}$`. Non-ASCII input is rejected before uppercasing, so the German sharp s is never accepted as "SS".
- `addTicker` validates on the client and sends no request for bad input. Otherwise it POSTs, appends on 201, treats a 200 re-add as a no-op, and returns the server's 400 text (the 50-ticker cap message included) or a network message.
- `AddTickerForm` sits directly under the panel title. It sanitizes as the user types, submits on Enter or the purple `+` (disabled while a request is pending), and shows errors in red under the input. Errors clear on the next keystroke and the typed text stays.
- Each row has a `remove-{T}` button after its select button. One click removes the ticker with no confirmation, and `stopPropagation` keeps the click from selecting the row. The button shows on row hover, on keyboard focus, and always on `hover:none` devices.
- `removeTicker` drops the row on 204 or on a stale 404. Removing the selected ticker selects the first remaining one, or none (MD-07, through `setEntries`/`nextSelection`).

## Task Commits

1. **Task 1: Add a ticker from the panel (WL-03, WL-05, D-05, D-07, D-08)**
   - RED `7d1f645` (test): failing ticker and AddTickerForm tests
   - GREEN `0090735` (feat): ticker.ts, addTicker, AddTickerForm
2. **Task 2: Remove with the row × (WL-04, MD-07, D-06)**
   - RED `458f5b3` (test): failing remove-button tests
   - GREEN `6c4d422` (feat): removeTicker and the row remove button

No REFACTOR commits were needed.

## TDD Evidence

- **Task 1 RED:** 19 target tests failed on assertions (ticker stub values were wrong, add-ticker test IDs were missing) and 5 passed (cases the stub already satisfied, such as "accepts AAPL"). The suite loaded, so there were no import or syntax faults. `ticker.ts` was committed as a signature-only stub in the RED commit so the suite would load and the failures would come from assertions, not a missing module. GREEN: 74/74 tests passed.
- **Task 2 RED:** 10 new remove-button tests failed because `remove-{T}` was missing; the 10 Task 1 tests still passed. GREEN: 84/84 tests passed.
- `workflow.tdd_mode` is false, so the RED gate classifier was not required. RED was checked by inspecting the test output.

## Files Created/Modified

- `frontend/src/api/ticker.ts`: `TICKER_RE`, `sanitizeTickerInput`, `tickerError`
- `frontend/src/api/ticker.test.ts`: unit tests for the ticker rule
- `frontend/src/store/watchlist.ts`: `addTicker` and `removeTicker` actions
- `frontend/src/components/Watchlist.tsx`: `AddTickerForm`, the panel error slot, and the row remove button
- `frontend/src/components/watchlist.test.tsx`: component tests with user-event (typing, Enter, Tab, clicks) and a stubbed fetch

## Decisions Made

See `key-decisions` in the frontmatter. The main one is that sanitization uppercases ASCII only. Without that, `toUpperCase` turns "ß" into "SS" before validation runs, and the non-ASCII check in `tickerError` could never fire.

## Deviations from Plan

None. The plan was executed as written. One implementation detail: the RED commit for Task 1 included a signature-only `ticker.ts` stub so the tests failed on assertions rather than on a module-load error.

## Issues Encountered

None.

## Verification Results

- `npm --prefix frontend test`: 5 files, 84 tests passed
- `npm --prefix frontend run lint`: clean
- `npm --prefix frontend run typecheck`: clean
- `npm --prefix frontend run build`: static export succeeded, and the `hover:none` rule is present in the emitted CSS
- Ticker regex grep: only `frontend/src/api/ticker.ts`
- `stopPropagation`, `method: "DELETE"` and `hover:none` greps: all present
- `git diff --exit-code frontend/package.json frontend/package-lock.json`: no change

## User Setup Required

None.

## Next Phase Readiness

- The watchlist editing slice is complete on the client. Plan 01-06's chart follows `useWatchlist.selected`, so it picks up the MD-07 re-selection automatically.
- Phase 2's trade bar can reuse `tickerError` and `sanitizeTickerInput` from `@/api/ticker`.
- Still needs a human check (end of phase): hover/touch visibility of the ×, a new ticker ticking live, and the chart switching after the selected ticker is removed.

---
*Phase: 01-live-market-terminal*
*Completed: 2026-10-27*

## Self-Check: PASSED

- FOUND: frontend/src/api/ticker.ts, frontend/src/api/ticker.test.ts, frontend/src/components/watchlist.test.tsx
- FOUND commits: 7d1f645, 0090735, 458f5b3, 6c4d422
