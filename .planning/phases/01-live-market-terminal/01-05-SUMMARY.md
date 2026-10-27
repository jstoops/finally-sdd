---
phase: 01-live-market-terminal
plan: 05
subsystem: ui
tags: [nextjs, react, zustand, eventsource, sse, vitest, tailwind, svg]

requires:
  - phase: 01-live-market-terminal
    provides: "01-01 frontend scaffold and theme tokens; 01-02 api types/client, tracer prices store and page"
provides:
  - "connectPriceStream reconnecting EventSource state machine with BACKOFF_MS [1000, 2000, 5000]"
  - "usePrices store with ticks, lastTs, spark (SPARK_MAX 300) and status; startPriceStream()"
  - "useWatchlist store: entries, loaded, loadError, selected, setEntries, select, loadWatchlist"
  - "domain/market pure helpers: chgPercent, formatPrice, formatPct, signOf, sparkPoints, nextSelection"
  - "Header + ConnectionDot, Terminal D-01 grid, Watchlist + memoized WatchlistRow + Sparkline"
  - "Vitest harness (vitest.config.mts, vitest.setup.ts) and the FakeEventSource test double"
affects: [01-06 chart, 01-07 watchlist add/remove, phase 2 portfolio panels, phase 3 chat, E2E tests]

actuals:
  tokens: 10545
  tasks: 2
  commits: 4
plan_head_before: 95b2c0886b891a5bb44190924dbd0bdaf7993326
plan_head_after: 8fdcdf435ed0e770ebdc0acba5f7fcd129ad2c2b

tech-stack:
  added: []
  patterns:
    - "Flash derived in render: price span keyed by tick timestamp, no setState in an effect"
    - "Replace-not-merge SSE frame ingest; sparkline append gated on a strictly newer timestamp"
    - "One EventSource construction site (stream/priceStream.ts) with injectable factory for tests"
    - "Narrow zustand selectors + React.memo rows so each frame re-renders only changed rows"

key-files:
  created:
    - frontend/vitest.config.mts
    - frontend/vitest.setup.ts
    - frontend/src/test/FakeEventSource.ts
    - frontend/src/stream/priceStream.ts
    - frontend/src/stream/priceStream.test.ts
    - frontend/src/store/watchlist.ts
    - frontend/src/domain/market.ts
    - frontend/src/domain/market.test.ts
    - frontend/src/components/Header.tsx
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/Watchlist.tsx
    - frontend/src/components/terminal.test.tsx
  modified:
    - frontend/src/store/prices.ts
    - frontend/src/app/page.tsx
    - frontend/src/app/layout.tsx

key-decisions:
  - "Single-point sparkline renders as a flat two-point line across the full width at mid-height, so it is visible"
  - "formatPct shows +0.00% for any value that rounds to zero (never -0.00%)"
  - "Sparkline stroke uses Tailwind stroke-up / stroke-down classes (latest price >= open is green), not CSS vars in SVG attributes"
  - "Terminal root keeps data-testid app-shell from the 01-01/01-02 tracer for continuity"
  - "Chart slot shows the selected ticker in its title and an empty body until plan 01-06 mounts the chart"

patterns-established:
  - "Store tests drive frames through FakeEventSource.latest().emitMessage inside act()"
  - "Coming-soon panels: dimmed bg-panel/60 text-muted section with a title and centered label"

requirements-completed: [MD-01, MD-02, MD-03, MD-04, MD-05, MD-07, UX-01]

coverage:
  - id: D1
    description: "Reconnecting price stream: connecting/open/closed status, capped 1s/2s/5s backoff after CLOSED, backoff reset on open, cleanup cancels pending retry, malformed frames ignored"
    requirement: MD-04
    verification:
      - kind: unit
        ref: "frontend/src/stream/priceStream.test.ts#connectPriceStream"
        status: pass
    human_judgment: false
  - id: D2
    description: "Header with only the wordmark and a connection dot (green/yellow/red with price-stream wording)"
    requirement: MD-04
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#ConnectionDot / Header"
        status: pass
    human_judgment: false
  - id: D3
    description: "Exactly one EventSource under StrictMode; one shared prices map with replace semantics, held-but-unwatched tickers kept"
    requirement: MD-01
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#page / prices store ingestFrame"
        status: pass
    human_judgment: false
  - id: D4
    description: "Client-side Chg % since session open with sign, 2 decimals, up/down/flat colors, em dash when unpriced, REST fallback before first frame, rows in watchlist order"
    requirement: MD-02
    verification:
      - kind: unit
        ref: "frontend/src/domain/market.test.ts#chgPercent/formatPct/formatPrice/signOf"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#watchlist rows"
        status: pass
    human_judgment: false
  - id: D5
    description: "Price flash on up/down ticks, re-flash on new timestamp, none on flat or repeated timestamp"
    requirement: MD-03
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#watchlist rows flash"
        status: pass
    human_judgment: false
  - id: D6
    description: "SVG polyline sparkline accumulated from SSE, timestamp-gated, capped at 300 points"
    requirement: MD-05
    verification:
      - kind: unit
        ref: "frontend/src/domain/market.test.ts#sparkPoints"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#prices store ingestFrame / sparkline"
        status: pass
    human_judgment: false
  - id: D7
    description: "Selection: first ticker on load, click moves 2px #209dd7 left border + tint, reconcile to first remaining or null"
    requirement: MD-07
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#selection"
        status: pass
    human_judgment: false
  - id: D8
    description: "Full D-01 terminal grid with labeled coming-soon panels; dark theme visual density, flash fade feel, tablet stacking and dot recovery after a container restart"
    requirement: UX-01
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#Terminal"
        status: pass
    human_judgment: true
    rationale: "Visual layout, 10 rows fitting without scroll, flash fade feel, tablet layout and live reconnect against a real container need a human look (plan human-check)"

duration: 9min
completed: 2026-10-26
status: complete
---

# Phase 1 Plan 05: Live Terminal Grid and Watchlist Summary

**Reconnecting EventSource state machine (1s/2s/5s capped backoff) driving a header status dot, plus the full D-01 terminal grid with memoized 28px watchlist rows that flash on ticks, show signed Chg % since session open and draw SVG sparklines**

## Performance

- **Duration:** about 9 min
- **Started:** 2026-10-26T22:00:00Z
- **Completed:** 2026-10-26T22:09:00Z
- **Tasks:** 2 (both TDD: RED then GREEN)
- **Files modified:** 15

## Accomplishments
- `connectPriceStream` is now the only place that constructs an EventSource. It reports connecting, open and closed, recreates the stream after CLOSED with a 1s, 2s, 5s, 5s... backoff, resets the backoff on open, and its cleanup cancels a pending retry.
- The header shows the FinAlly wordmark and a `ConnectionDot` (`bg-up` / `bg-accent` / `bg-down`) whose label reads "Price stream connected / reconnecting / disconnected". It never claims exchange data.
- The prices store replaces its map on each frame (it never merges). It keeps tickers that are held but not watched, appends a sparkline point only for a strictly newer timestamp, and caps each buffer at 300 points.
- Watchlist rows are about 28px tall with fixed `tabular-nums` columns. The price span is keyed by tick timestamp, so the 500ms flash restarts on each new tick. Chg % is signed and colored with `data-sign`, the sparkline is an SVG polyline, and the selected row has a `border-primary` left border and tint.
- The Terminal grid on xl is 260px | 1fr | 360px: chart slot, heatmap and P&L side by side, then positions, with chat on the right. On md it has two columns and the chat moves under the center column. The four coming-soon panels are labeled with the phase that delivers them.
- The Vitest harness (jsdom, FakeEventSource on `globalThis`, ResizeObserver stub, explicit cleanup) is ready for every later frontend plan.

## Task Commits

1. **Task 1 RED: failing stream/dot tests and Vitest harness** - `ca54994` (test)
2. **Task 1 GREEN: reconnecting price stream and header connection dot** - `7caf83e` (feat)
3. **Task 2 RED: failing terminal grid and watchlist row tests** - `64f1d09` (test)
4. **Task 2 GREEN: full terminal grid and dense live watchlist rows** - `8fdcdf4` (feat)

No refactor commits were needed.

### TDD notes
- RED for both tasks failed at module resolution: the target modules (`@/stream/priceStream`, `@/components/Header`, `@/components/Terminal`, `@/domain/market`) did not exist yet, and the Vitest harness and setup file loaded cleanly. `workflow.tdd_mode` is false for this project, so the format-based RED classifier gate was not enforced. Every behavior assertion was written before the implementation, and all 50 tests pass after GREEN.

## Files Created/Modified
- `frontend/vitest.config.mts` - Vitest with the React plugin, native tsconfig paths, jsdom and `src/**/*.test.{ts,tsx}`
- `frontend/vitest.setup.ts` - jest-dom matchers, FakeEventSource global, ResizeObserver stub, afterEach cleanup/reset/real timers
- `frontend/src/test/FakeEventSource.ts` - test double with CONNECTING/OPEN/CLOSED statics, instances, emit helpers
- `frontend/src/stream/priceStream.ts` - `connectPriceStream`, `BACKOFF_MS`
- `frontend/src/stream/priceStream.test.ts` - status machine, backoff, cleanup and parsing tests
- `frontend/src/store/prices.ts` - `usePrices` with `lastTs` and `spark`, `SPARK_MAX`, `startPriceStream` delegating to `connectPriceStream`
- `frontend/src/store/watchlist.ts` - `useWatchlist` with load, inline error and selection reconcile
- `frontend/src/domain/market.ts` - pure Chg %, formatting, sparkline geometry and selection rules
- `frontend/src/domain/market.test.ts` - domain rule tests
- `frontend/src/components/Header.tsx` - `Header`, `ConnectionDot`
- `frontend/src/components/Watchlist.tsx` - `Watchlist`, memoized `WatchlistRow`, `Sparkline`
- `frontend/src/components/Terminal.tsx` - D-01 grid, `ComingSoon`, chart slot; starts the stream and loads the watchlist once
- `frontend/src/components/terminal.test.tsx` - dot, header, StrictMode, store, rows, selection and grid tests
- `frontend/src/app/page.tsx` - renders `<Terminal />` only
- `frontend/src/app/layout.tsx` - metadata description wording (see deviations)

## Decisions Made
- A single sparkline point renders as a two-point flat line across the full width at mid-height, so it shows on screen ("one point renders a flat line").
- `formatPct` turns a value that rounds to `-0.00` into `+0.00%`, so a tiny loss never shows a negative zero.
- The sparkline color uses the Tailwind `stroke-up` / `stroke-down` classes (green when the latest price is at or above open). CSS variables are not used in SVG presentation attributes.
- The Terminal root keeps `data-testid="app-shell"` from the tracer so existing references still resolve.
- The chart slot title shows the selected ticker. Its body stays empty, except for the D-12 empty-watchlist text, until plan 01-06 mounts the chart.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed "Live market data" wording from layout metadata**
- **Found during:** Task 2 (grep gate)
- **Issue:** `frontend/src/app/layout.tsx` (from 01-01) had the description "Live market data, a simulated portfolio and an AI trading copilot." That matched the Task 2 gate pattern `live market data`, and it conflicts with prohibition P1, which bars describing simulator prices as live market data.
- **Fix:** Changed the description to "Streaming prices, a simulated portfolio and an AI trading copilot."
- **Files modified:** frontend/src/app/layout.tsx (not in this plan's files_modified; none of the parallel plans 01-03 or 01-04 touch it)
- **Verification:** The grep gate prints GATE_OK, and the build passes.
- **Committed in:** 8fdcdf4

**2. [Rule 2 - Missing critical] Load error and empty states in the watchlist panel**
- **Found during:** Task 2
- **Issue:** The plan asked for `loadError` in `text-down` and "Your watchlist is empty", but no behavior bullet tested them.
- **Fix:** Implemented both and added tests (an empty watchlist shows "Your watchlist is empty" plus the D-12 chart text, and a 500 response shows the server error in `text-down`).
- **Files modified:** frontend/src/components/Watchlist.tsx, frontend/src/components/terminal.test.tsx
- **Committed in:** 64f1d09, 8fdcdf4

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** Both were small and kept the gates green. There was no scope creep.

## Issues Encountered
- `npm run typecheck` fails with `Cannot find name 'LayoutProps'` until `next build` (or `next typegen`) has generated `.next/types`. This predates this plan (01-01 layout). Running the build first makes typecheck pass. Verification ran in the order lint, build, typecheck.
- `node_modules` was absent in the fresh worktree, so I ran `npm ci` from the lockfile. `package.json` and `package-lock.json` are unchanged (`git diff --exit-code` is clean).

## Threat Mitigations
- T-01-19: all server strings render as React text. There is no `dangerouslySetInnerHTML` anywhere in `frontend/src` (the grep gate passes).
- T-01-20: `JSON.parse` is wrapped in try/catch, and malformed frames are dropped. This is tested.
- T-01-21: backoff is capped at 1s/2s/5s after CLOSED, and cleanup cancels pending timers. Both are tested.
- T-01-SC: no packages were installed and the lockfiles are unchanged.

## User Setup Required
None. No external service configuration is required.

## Next Phase Readiness
- Plan 01-06 can mount the Lightweight Charts area series inside `data-testid="chart-slot"` in `Terminal.tsx`'s `ChartSlot`, using `useWatchlist((s) => s.selected)` and `usePrices.subscribe` for live appends.
- Plan 01-07 can add the add input under the Watchlist title and a remove `×` sibling inside each `<li class="group relative">`. Both should go through `useWatchlist.getState().setEntries` so the selection reconcile applies.
- Human check pending (end-of-phase UAT): visual density, flash fade, tablet layout at about 820px, and the dot going yellow then back to green across a container restart.

## Self-Check: PASSED
- All 12 created files and 3 modified files exist on disk.
- Commits ca54994, 7caf83e, 64f1d09 and 8fdcdf4 are on this branch.
- `npm --prefix frontend test` gives 50/50 passing. lint, build and typecheck exit 0. The EventSource gate lists only `frontend/src/stream/priceStream.ts`. The grep gate prints GATE_OK, and the lockfiles are unchanged.

---
*Phase: 01-live-market-terminal*
*Completed: 2026-10-26*
