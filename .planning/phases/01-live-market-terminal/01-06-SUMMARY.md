---
phase: 01-live-market-terminal
plan: 06
subsystem: ui
tags: [nextjs, react, lightweight-charts, zustand, vitest, sse]

requires:
  - phase: 01-live-market-terminal
    provides: "01-05 prices store (usePrices), watchlist store (useWatchlist, selected), market helpers, Terminal grid, Vitest harness"
provides:
  - "ChartPanel: Lightweight Charts AreaSeries for the selected ticker, seeded from /api/prices/{ticker}/history and extended live from usePrices.subscribe"
  - "Chart header with ticker, live price and colored Chg %; dashed Open price line; Loading / Add a ticker / Waiting for prices states"
  - "Pure chart helpers in src/domain/chart.ts: toSeriesData, isNewer, formatLocalTime, CHART_THEME"
affects: [01-07 watchlist add/remove, phase-2 portfolio panels, phase-3 E2E chart assertions]

actuals:
  tokens: 8000
  tasks: 2
  commits: 4
plan_head_before: 23f7eaa716763894b1db83b8023b8b8135e92f49
plan_head_after: cf1197e7a18fd1ba55182396ec87837a418756f6

tech-stack:
  added: []
  patterns:
    - "Imperative chart driven from effects: create once per mount, per-selection history seed with a request-id stale guard, store subscription for live appends"
    - "Selection-change state reset during render (React 'previous render' pattern) instead of setState in an effect body"
    - "Test files that render Terminal stub lightweight-charts via vi.mock with importOriginal (jsdom has no canvas)"

key-files:
  created:
    - frontend/src/domain/chart.ts
    - frontend/src/domain/chart.test.ts
    - frontend/src/components/ChartPanel.tsx
    - frontend/src/components/ChartPanel.test.tsx
  modified:
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx

key-decisions:
  - "Time window is fitContent over the 5-minute history (discretion)"
  - "formatLocalTime uses hourCycle h23 instead of hour12:false so midnight never renders as 24:00:00"
  - "Loading state is tracked per selection with a during-render reset, so switching A -> B -> A shows Loading again (stricter than comparing loadedFor to selected)"
  - "A failed history request is treated as an empty history, so live ticks can still draw the chart (status reads Waiting for prices...)"

patterns-established:
  - "Charts: never touch lightweight-charts at module or render scope; pass Unix float seconds unchanged as UTCTimestamp"
  - "Out-of-order guard: isNewer(time, lastTime) before every series.update"

requirements-completed: [MD-06, MD-07]

coverage:
  - id: D1
    description: "Selected ticker charted as a #209dd7 AreaSeries with a downward-fading fill, one chart per mount reused across switches"
    requirement: MD-06
    verification:
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#creates one chart with a blue AreaSeries and removes it on unmount"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#clears the series on a switch and reuses the same chart"
        status: pass
    human_judgment: false
  - id: D2
    description: "History seed from /api/prices/{ticker}/history with fitContent; stale responses discarded"
    requirement: MD-06
    verification:
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#fetches the selected ticker's history and draws it, then fits the content"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#discards a stale history response when the selection moved on"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live append from SSE for the selected ticker only; non-newer ticks and ticks before history are dropped"
    requirement: MD-06
    verification:
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#appends only strictly newer ticks of the selected ticker"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#ignores ticks that arrive before the history resolves"
        status: pass
      - kind: unit
        ref: "frontend/src/domain/chart.test.ts#toSeriesData"
        status: pass
    human_judgment: false
  - id: D4
    description: "Local HH:MM:SS time axis and crosshair via tickMarkFormatter and localization.timeFormatter"
    requirement: MD-06
    verification:
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#formats the time axis and crosshair as local HH:MM:SS"
        status: pass
      - kind: unit
        ref: "frontend/src/domain/chart.test.ts#uses local wall-clock time, never a pre-shifted timestamp"
        status: pass
    human_judgment: false
  - id: D5
    description: "Clicking a watchlist row switches the chart (title follows selection) in the Terminal"
    requirement: MD-07
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#selects the first row on load and moves on click"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#follows the new ticker after a switch"
        status: pass
    human_judgment: false
  - id: D6
    description: "Header with ticker, live price and colored Chg %; dashed Open line; D-12 status texts"
    verification:
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#ChartPanel header (D-10)"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#ChartPanel Open line (D-11)"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChartPanel.test.tsx#ChartPanel states (D-12)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Visual result in the running app: blue line and fade, local time axis, dashed Open line, live extension every ~500ms"
    verification: []
    human_judgment: true
    rationale: "Canvas rendering is mocked in jsdom; the plan's human-check (look of the chart in a browser) needs a person"

duration: 10min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 06: Main Price Chart Summary

**The selected ticker now gets a Lightweight Charts AreaSeries (blue line, fading fill). It is seeded from the 5-minute history endpoint and extended live from the shared SSE store. The panel header shows the live price and Chg %, a dashed Open line marks the session open, and the Loading, Add a ticker and Waiting for prices states are all handled.**

## Performance

- **Duration:** ~10 min of execution, plus about 2 min for `npm ci` in the fresh worktree
- **Started:** 2026-10-27T08:13:00Z
- **Completed:** 2026-10-27T08:24:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `ChartPanel` creates one chart per mount and reuses it across ticker switches. On each selection it clears the series and draws the fetched history (Unix seconds passed through unchanged), then calls `fitContent`. A request id drops stale responses.
- Live ticks come from `usePrices.subscribe`. They are ignored until history loads, and any tick with time <= the last chart time is dropped, so `series.update` never throws.
- The header shows the ticker, the live price (falling back to the watchlist entry) and a signed Chg % colored with `text-up`, `text-down` or `text-muted`.
- One dashed "Open" price line per selection. It is created as soon as `open_price` is known, moved in place with `applyOptions`, and removed on a switch.
- The D-12 status text sits over a canvas that stays mounted, and `Terminal` renders `<ChartPanel />` in the chart slot.

## Task Commits

1. **Task 1: Selected ticker charted from history and extended live**
   - `0f864b7` test(01-06): failing tests for chart helpers and ChartPanel history/live append (RED)
   - `9623308` feat(01-06): chart the selected ticker from history and extend it live (GREEN)
2. **Task 2: Header, dashed Open line, loading/empty states**
   - `24a0c09` test(01-06): failing tests for header, Open line and D-12 states (RED)
   - `cf1197e` feat(01-06): chart header, dashed Open line and loading/empty states (GREEN)

No refactor commits were needed.

## TDD Evidence

- **Task 1 RED:** I ran `npx vitest run src/domain/chart src/components/ChartPanel` against placeholder exports (`toSeriesData` returning `[]`, an empty `ChartPanel` section). Result: 14 of 15 failed on assertions, for example `expected [] to deeply equal [{time: 100.5, value: 1}, ...]` and `expected createChart to be called 1 times, but got 0 times`. The one that passed was the empty-input case, which is correct for the placeholder too. None of the failures came from imports or syntax. Semantic assessment: the targets failed on the planned behavior.
- **Task 2 RED:** 9 new tests failed on missing `chart-price`, `chart-canvas`, `createPriceLine` calls and status texts. The 9 Task 1 tests still passed. Semantic assessment: valid RED. The removal test failed because no line had been created, which is a missing-behavior failure, not a load fault.
- **GREEN:** after each GREEN commit the full suite passed: 66/66 after Task 1 and 76/76 after Task 2.
- `workflow.tdd_mode` is false, so the TAP classifier gate was not required. The RED evidence above is from the console runs.

## Files Created/Modified
- `frontend/src/domain/chart.ts`: `toSeriesData`, `isNewer`, `formatLocalTime`, `CHART_THEME`
- `frontend/src/domain/chart.test.ts`: helper tests
- `frontend/src/components/ChartPanel.tsx`: the main chart panel
- `frontend/src/components/ChartPanel.test.tsx`: lifecycle, history, live append, header, Open line and state tests, with lightweight-charts mocked
- `frontend/src/components/Terminal.tsx`: the chart slot now renders `<ChartPanel />` (inline `ChartSlot` removed)
- `frontend/src/components/terminal.test.tsx`: stubs lightweight-charts and counts only `/api/watchlist` loads

## Decisions Made
- `fitContent` over the history is the chart time window (planner discretion).
- I used `hourCycle: "h23"` instead of `hour12: false` so midnight cannot render as "24:00:00".
- Loading state resets during render whenever the selection changes. This covers an A -> B -> A switch, which `loadedFor !== selected` would get wrong. It still satisfies react-hooks 7, because no setState runs synchronously in an effect body.
- A failed history fetch counts as an empty history. Live ticks still draw, and the status shows "Waiting for prices…".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated the 01-05 Terminal test for the new history request**
- **Found during:** Task 1
- **Issue:** `terminal.test.tsx` › "opens one stream and loads the watchlist once" expected exactly one fetch call. With `ChartPanel` mounted, the selected ticker's history request is a second call.
- **Fix:** The test now counts only `/api/watchlist` calls. The file also mocks `lightweight-charts`, because jsdom has no canvas and printed a "getContext not implemented" error for every Terminal render.
- **Files modified:** `frontend/src/components/terminal.test.tsx` (not in the plan's `files_modified`; sibling plan 01-07 does not list it)
- **Verification:** Full suite 76/76; no canvas noise.
- **Committed in:** `9623308`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test-only adjustment needed to keep the 01-05 suite green. No product scope change.

## Issues Encountered
- The fresh worktree had no `node_modules`, so I ran `npm ci`. The lockfile is unchanged (`git diff --exit-code frontend/package.json frontend/package-lock.json` is clean).

## Verification
- `npm --prefix frontend test`: 5 files, 76 tests passed
- `npm --prefix frontend run lint`: clean
- `npm --prefix frontend run typecheck`: clean
- `npm --prefix frontend run build`: static export succeeded (`/` prerendered)
- Grep gates: `AreaSeries` and `usePrices.subscribe` present; no `* 1000` timestamp scaling outside the `new Date` in `formatLocalTime`
- Exactly one `data-testid="panel-chart"` (in `ChartPanel.tsx`)
- MD-07 is also declared by sibling plan 01-07, so the shared-ID gate only marked MD-06 complete in REQUIREMENTS.md. MD-07 will be marked once 01-07 finishes.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness
- Phase success criterion 3 (the chart shows about 5 minutes of history and extends live with local HH:MM:SS) is met in tests. It still needs the plan's human-check in a browser at the end of the phase.
- When 01-07 lands watchlist add/remove, removing the selected ticker changes `selected`, and `ChartPanel` already handles that by clearing, removing the Open line, and showing Loading or the empty state.

---
*Phase: 01-live-market-terminal*
*Completed: 2026-10-27*
