---
phase: 02-trading-and-live-portfolio
plan: 04
subsystem: ui
tags: [react, zustand, treemap, squarify, heatmap, vitest, tailwind]

requires:
  - phase: 02-trading-and-live-portfolio (02-03)
    provides: livePortfolio, moneySign/pctSign/formatSignedMoney, usePortfolio store, held-aware useWatchlist selection, stubApi
provides:
  - PositionsTable component (live positions x SSE prices, click-to-chart)
  - squarify(items, width, height) pure squarified treemap layout with TreemapInput/Tile types
  - pnlColor(pct) diverging neutral-to-green/red tile color clamped at +/-5%
  - Heatmap component (percent-positioned tile buttons, tooltip, empty text, click-to-chart)
  - Terminal mounts both panels in place of their coming-soon placeholders
affects: [02-06 P&L chart panel, phase-03 chat refetch, e2e portfolio visualization tests]

actuals:
  tokens: 9500
  tasks: 2
  commits: 4
plan_head_before: d85304d3d86eb9babd14dd294249442613a4fb94
plan_head_after: a4f0889677ca735d46c50299ea646ab77385e740

tech-stack:
  added: []
  patterns:
    - "Panels derive live rows with raw-field store selectors plus useMemo(livePortfolio(cash ?? 0, positions, ticks)), with no derived selectors"
    - "Browser-measured layout: ResizeObserver created inside useEffect, 16:9 default box until the first measurement"
    - "Click-to-chart via useWatchlist.getState().select(ticker) from row or tile handlers"

key-files:
  created:
    - frontend/src/components/PositionsTable.tsx
    - frontend/src/components/PositionsTable.test.tsx
    - frontend/src/domain/treemap.ts
    - frontend/src/domain/treemap.test.ts
    - frontend/src/components/Heatmap.tsx
    - frontend/src/components/Heatmap.test.tsx
  modified:
    - frontend/src/domain/portfolio.ts
    - frontend/src/domain/portfolio.test.ts
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx

key-decisions:
  - "PositionsTable and Heatmap call livePortfolio(cash ?? 0, ...) because only rows are used; positions render before cash loads"
  - "The row click handler sits on the <tr>; the ticker <button> inside has no handler of its own, so Enter/click bubble to one select() call"
  - "pnlColor treats a non-finite percent as neutral (#30363d)"
  - "The heatmap empty text shows only when there are no rows; positions whose live value is 0 get no tile but do not trigger the empty text"

patterns-established:
  - "Pure layout plus percent geometry: squarify works in measured box units and tiles render as left/top/width/height percentages of that box"

requirements-completed: [PF-06, PF-07, MD-08]

coverage:
  - id: D1
    description: "Live positions table with six columns, cent/2dp-rounded sign colors, percent units without x100, empty text 'No positions yet'"
    requirement: PF-06
    verification:
      - kind: unit
        ref: "frontend/src/components/PositionsTable.test.tsx"
        status: pass
    human_judgment: false
  - id: D2
    description: "Positions row click / Enter and heatmap tile click chart the ticker, including a held but unwatched one that survives a watchlist add"
    requirement: MD-08
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#charts a held unwatched ticker from its positions row and keeps it across a watchlist add"
        status: pass
      - kind: unit
        ref: "frontend/src/components/Heatmap.test.tsx#selects the ticker on tile click"
        status: pass
    human_judgment: false
  - id: D3
    description: "Squarified treemap layout (count, total area, bounds, proportional area, order independence, empty inputs)"
    requirement: PF-07
    verification:
      - kind: unit
        ref: "frontend/src/domain/treemap.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Heatmap tiles sized by live market value, pnlColor +/-5% clamp, data-sign, title tooltip, tiny-tile label hiding, exact empty text, sold-out tile removal"
    requirement: PF-07
    verification:
      - kind: unit
        ref: "frontend/src/components/Heatmap.test.tsx"
        status: pass
      - kind: unit
        ref: "frontend/src/domain/portfolio.test.ts#pnlColor"
        status: pass
    human_judgment: false
  - id: D5
    description: "Visual fit of the heatmap and positions table in the terminal grid (tile label legibility on green/red, density)"
    verification: []
    human_judgment: true
    rationale: "Color contrast and visual density are judged by eye; jsdom has no layout"

duration: 7min
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 04: Live Positions Table and P&L Heatmap Summary

**Live positions table and in-house squarified P&L heatmap. Both recompute from stored positions times SSE prices with useMemo(livePortfolio), and a click charts the ticker even when it is held but not watched.**

## Performance

- **Duration:** about 7 min
- **Started:** 2026-10-28T23:02:14Z
- **Completed:** 2026-10-28T23:09:23Z
- **Tasks:** 2
- **Files modified:** 10 (6 created, 4 modified)

## Accomplishments
- `PositionsTable` shows Ticker, Qty, Avg Cost, Price, P&L and P&L % for every position, updated on every SSE frame. P&L and P&L % carry `data-sign` and the up/down/muted colors from the cent- or 2dp-rounded value, so a displayed `+0.00%` is never red. Percents go through `formatPct` and are never multiplied by 100.
- `squarify` is a pure Bruls/Huizing/van Wijk layout with no imports. `pnlColor` mixes from `#30363d` toward `#22c55e` or `#ef4444`, with full color at ±5%.
- `Heatmap` renders absolutely positioned `<button>` tiles with percent geometry, sized by live market value. Each tile has an inline `pnlColor` background, `data-sign` and the title `"{T} {pct}"`. The label is hidden below 6% of the box width or 18% of its height. With no positions it shows exactly "No positions — buy something or ask FinAlly".
- Clicking a row or a tile calls `useWatchlist.getState().select(ticker)`. Together with 02-03's held-aware selection, this charts held but unwatched tickers, and the selection survives a watchlist add.
- A sold-out position disappears from the table and the heatmap in the same render, because both derive from the applied portfolio.

## Task Commits

1. **Task 1: Live positions table with click-to-chart (PF-06, MD-08)**
   - RED `0c68461` (test)
   - GREEN `231a5f0` (feat)
2. **Task 2: Live P&L heatmap with squarified treemap (PF-07, MD-08)**
   - RED `68141ff` (test)
   - GREEN `a4f0889` (feat)

No REFACTOR commits were needed.

## TDD Evidence

- **Task 1 RED:** two `terminal.test.tsx` targets failed on their planned assertions: `position-row-TSLA` was not found, and the panel still read "Positions — coming in Phase 2". `PositionsTable.test.tsx` failed at import resolution because `@/components/PositionsTable` did not exist yet. That is a load failure, not an assertion failure, so by itself it would be INVALID_RED. The RED evidence for this task therefore rests on the Terminal assertions. `workflow.tdd_mode` is false and the plan is `type: execute`, so the format-based classifier gate was not run.
- **Task 2 RED:** the five `pnlColor` tests failed with `pnlColor is not a function`, because the export was missing. The two Terminal targets failed on their assertions: `heatmap-tile-TSLA` was missing, and the placeholder text was still there. `treemap.test.ts` and `Heatmap.test.tsx` failed at import resolution, again a load failure. Semantic assessment: the behavior was absent for the intended reason in every case.
- **GREEN:** all target files pass. The full suite has 196 tests, all passing.

## Files Created/Modified
- `frontend/src/components/PositionsTable.tsx`: live positions table, row selection with `aria-selected` and a `border-primary` left border, empty state
- `frontend/src/components/PositionsTable.test.tsx`: cells, colors, percent units, flat edge, live move, click and Enter selection, sold-out removal
- `frontend/src/domain/treemap.ts`: `squarify`, `TreemapInput`, `Tile`
- `frontend/src/domain/treemap.test.ts`: layout invariants over seeded random values
- `frontend/src/domain/portfolio.ts`: added `pnlColor`
- `frontend/src/domain/portfolio.test.ts`: `pnlColor` endpoints, clamp, halfway mix, NaN
- `frontend/src/components/Heatmap.tsx`: heatmap panel, ResizeObserver inside an effect, 16:9 default box
- `frontend/src/components/Heatmap.test.tsx`: fixed 400x200 ResizeObserver stub; geometry, color, label threshold, click, removal, disconnect
- `frontend/src/components/Terminal.tsx`: mounts `<PositionsTable />` and `<Heatmap />`; the P&L and chat placeholders stay
- `frontend/src/components/terminal.test.tsx`: the panels test no longer expects those two placeholders; added a held-unwatched click case (row and tile) to "selection"

## Decisions Made
- Both panels pass `cash ?? 0` to `livePortfolio`, since only `rows` are used. Rows do not depend on cash.
- `pnlColor(NaN)` returns the neutral color. This defensive case is not in the plan, but it cannot affect valid percents.
- The empty text depends on the row count, not the tile count. A held position whose live value is 0 gets no tile, and the box stays blank without showing the empty text.

## Verification
- `npm --prefix frontend test`: 12 files, 196 tests passed; no "Maximum update depth exceeded"
- `npm --prefix frontend run lint`: clean
- `npm --prefix frontend run typecheck`: clean
- `npm --prefix frontend run build`: static export succeeded
- Runtime dependencies are exactly `lightweight-charts,next,react,react-dom,zustand`; `git diff --quiet 245a40c -- frontend/package.json frontend/package-lock.json` passes
- The grep for no pure black, `next/font/google` or `dangerouslySetInnerHTML` in `frontend/src` finds nothing
- `treemap.ts` has no imports; `ResizeObserver` appears only inside `useEffect` in `Heatmap.tsx`

## Deviations from Plan

None. The plan was executed as written.

The worktree had no `frontend/node_modules`, so I ran `npm ci` from the existing lockfile before running tests. No packages were added and the lockfile is unchanged.

## Issues Encountered
None.

## User Setup Required
None. No external service configuration is required.

## Next Phase Readiness
- Plan 02-06 can replace the remaining `panel-pnl` placeholder in `Terminal.tsx`. The heatmap and positions panels already sit in their final grid slots.
- The test ids for E2E are `positions-table`, `position-row-{T}`, `heatmap-tile-{T}` (with `data-sign`) and `heatmap-empty`.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*

## Self-Check: PASSED
