---
phase: 02-trading-and-live-portfolio
plan: 03
subsystem: ui
tags: [nextjs, react, zustand, vitest, sse, portfolio, money-rounding]

requires:
  - phase: 02-trading-and-live-portfolio
    provides: "02-01 usePortfolio.trade(), Position/Portfolio types, STARTING_CASH, formatMoney, TradePanel, server value_portfolio rounding"
provides:
  - "usePortfolio.loaded, loadError, loadPortfolio(), refresh() with a response-sequence guard shared by loads and trade()"
  - "frontend/src/test/stubFetch.ts: jsonResponse, stubApi, DEFAULT_API (plus callsTo) URL-routing fetch stub"
  - "toCents, livePortfolio, LiveRow, LivePortfolio, moneySign, pctSign, formatSignedMoney in @/domain/portfolio"
  - "Live Header: header-total, header-cash, header-pnl (data-sign) recomputed per SSE frame without polling"
  - "nextSelection(watchlist, selected, held = []) and useWatchlist.held / setHeld"
affects: [02-04 positions table and heatmap, 02-05 trade history, 02-06 reset and P&L chart]

actuals:
  tokens: 12700
  tasks: 3
  commits: 6
plan_head_before: 57792644a9098cfd9a244ca36c67cc6ca3243a3a
plan_head_after: bc182f66764ea85ba4babefaafd5a39d271f7d1d

tech-stack:
  added: []
  patterns:
    - "Module-scoped response-sequence guard: loads number at request time, trade responses at arrival; apply only if newer"
    - "Raw-field Zustand selectors plus useMemo derivation for live values (no object-returning selectors)"
    - "Cross-store bridge lives in Terminal's effect (usePortfolio.subscribe -> useWatchlist.setHeld); stores never import each other"
    - "stubApi route table for component tests: overrides then defaults, METHOD /path before /path, 404 otherwise"

key-files:
  created:
    - frontend/src/test/stubFetch.ts
    - frontend/src/components/header.test.tsx
    - frontend/src/domain/portfolio.test.ts
  modified:
    - frontend/src/store/portfolio.ts
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx
    - frontend/src/components/Header.tsx
    - frontend/src/domain/portfolio.ts
    - frontend/src/domain/market.ts
    - frontend/src/domain/market.test.ts
    - frontend/src/store/watchlist.ts

key-decisions:
  - "toCents uses a 1e-7-cent nudge before flooring the cent-scaled magnitude (assumption P-1); passes the 02-02 parity literals"
  - "A portfolio load whose result (or failure) arrives after a newer applied response is ignored entirely, including its error"
  - "pctSign uses the same half-up 2 dp rounding as toCents"
  - "stubApi checks overrides before defaults so a bare '/path' override beats a default 'GET /path'"

patterns-established:
  - "Header readouts: label + data-testid value with tabular-nums and data-sign/CHG-style color class"
  - "Terminal.refresh(): the single reload entry point for mount and reconnect; later plans extend usePortfolio.refresh"

requirements-completed: [PF-04, PF-05, MD-08]

coverage:
  - id: D1
    description: "Terminal loads GET /api/portfolio on mount and with the watchlist on reconnect; first open re-loads only after a failed first load"
    requirement: PF-04
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#Terminal opens one stream and loads the watchlist and the portfolio once"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#Terminal re-fetches the watchlist and the portfolio on reconnect, not on the first open"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#Terminal re-fetches only the failed portfolio on the first open"
        status: pass
    human_judgment: false
  - id: D2
    description: "Portfolio store load validation and response-sequence guard (stale load never overwrites a trade's portfolio)"
    requirement: PF-04
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#portfolio store discards a load requested before a trade response that resolves after it"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#portfolio store rejects a body that is not a portfolio"
        status: pass
    human_judgment: false
  - id: D3
    description: "Header Cash drops by exactly the trade cost after a trade-bar fill ($8,094.80)"
    requirement: PF-04
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#Terminal buys from the trade bar and confirms the fill"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live Total and P&L since start from positions x SSE prices with no /api/portfolio polling; signed, colored, flat at +$0.00"
    requirement: PF-05
    verification:
      - kind: unit
        ref: "frontend/src/components/header.test.tsx#Header live values recomputes Total and P&L on every frame without fetching the portfolio"
        status: pass
      - kind: unit
        ref: "frontend/src/components/header.test.tsx#Header live values shows a sub-cent P&L as a flat +$0.00"
        status: pass
    human_judgment: false
  - id: D5
    description: "Client valuation equals the server to the cent on the shared half-cent parity table"
    requirement: PF-04
    verification:
      - kind: unit
        ref: "frontend/src/domain/portfolio.test.ts#livePortfolio server parity"
        status: pass
      - kind: unit
        ref: "frontend/src/domain/portfolio.test.ts#toCents"
        status: pass
    human_judgment: false
  - id: D6
    description: "A held but unwatched selection survives watchlist changes and falls back after a sell to zero"
    requirement: MD-08
    verification:
      - kind: unit
        ref: "frontend/src/domain/market.test.ts#nextSelection keeps a held but unwatched selection"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#selection charts a held unwatched ticker and falls back when the position is sold to zero"
        status: pass
    human_judgment: false
  - id: D7
    description: "Header wording presents simulated balances only (Total, Cash, P&L since start; no real-money or brokerage wording)"
    verification: []
    human_judgment: true
    rationale: "Prohibition is verification: judgment in the plan; a grep found no 'real', 'brokerage' or 'live account' text in Header.tsx, but wording adequacy is a human call"

duration: 15min
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 03: Live Portfolio Header Summary

**The header now shows Total, Cash and P&L since start. Total and P&L are recomputed on every SSE frame from the stored positions times the streamed prices, using half-up cent rounding that matches the server's `value_portfolio` to the cent. The portfolio loads on mount and after a reconnect behind a sequence guard, so a stale load can't overwrite a newer trade. A held but unwatched ticker can stay selected in the chart.**

## Performance

- **Duration:** about 15 min
- **Started:** 2026-10-28T14:05:00Z
- **Completed:** 2026-10-28T14:20:00Z
- **Tasks:** 3 (all `tdd="true"`, RED then GREEN commits)
- **Files modified:** 11 (3 created, 8 modified)

## Accomplishments
- `usePortfolio` gained `loaded`, `loadError`, `loadPortfolio()` and `refresh()`. A module-scoped sequence guard covers both loads and `trade()`, and a malformed body leaves `cash` null and sets "Could not load the portfolio."
- `Terminal` refreshes the portfolio on mount. After a reconnect it refreshes both the portfolio and the watchlist. On the first open it refreshes only what failed to load.
- The header shows Total, Cash and P&L since start. P&L is signed (`+$10.00` / `-$10.00` / `+$0.00`), carries `data-sign`, and is colored `text-up`, `text-down` or `text-muted`. It is derived with `useMemo` over three raw selectors.
- `toCents`, `livePortfolio`, `moneySign`, `pctSign` and `formatSignedMoney` pass the 02-02 parity literals exactly.
- `nextSelection` now takes a `held` set. `useWatchlist.setHeld` is fed by a `usePortfolio` subscription in `Terminal`, so the two stores still don't import each other.
- The shared `stubApi` test helper now backs every stub in `terminal.test.tsx`.

## Task Commits

1. **Task 1: Portfolio load on mount/reconnect + header Cash (PF-04)**: RED `6b38162` (test), GREEN `9f24f62` (feat)
2. **Task 2: Live header Total and P&L since start (PF-04, PF-05)**: RED `3441358` (test), GREEN `bc13dee` (feat)
3. **Task 3: Held-aware selection (MD-08)**: RED `41bcf66` (test), GREEN `bc182f6` (feat)

No REFACTOR commits were needed.

## TDD Gate Compliance

| Task | RED | GREEN | RED evidence (semantic assessment) |
|------|-----|-------|-------------------------------------|
| 1 | 6b38162 | 9f24f62 | 13 target tests failed: `loadPortfolio`/`refresh` were not functions, `header-cash` was absent, and the mount sent no portfolio GET. All of these are the missing behavior, not harness faults; 23 existing tests passed. |
| 2 | 3441358 | bc13dee | 27 target tests failed: the domain helpers did not exist, and `header-total`/`header-pnl` were absent. These are missing-feature failures. |
| 3 | 41bcf66 | bc182f6 | 3 target tests failed: `nextSelection` returned 'AAPL' instead of 'TSLA', `setHeld` was not a function, and `held` was missing. The fallback cases already passed because they are regression guards for existing behavior. |

The RED evidence was checked semantically from the Vitest console output. The `tdd-red-evidence` classifier was not run, because this is a `type: execute` plan with `tdd="true"` tasks, not a `type: tdd` plan.

## Files Created/Modified
- `frontend/src/test/stubFetch.ts`: `jsonResponse`, `DEFAULT_API`, `stubApi` (routes overrides first, then defaults; `METHOD /path` before `/path`; a prices-history prefix fallback; 404 otherwise), plus `callsTo`
- `frontend/src/store/portfolio.ts`: load, refresh, validation and the sequence guard
- `frontend/src/components/Terminal.tsx`: portfolio refresh on mount and reconnect, and the held bridge subscription
- `frontend/src/components/Header.tsx`: Total, Cash and P&L since start readouts
- `frontend/src/domain/portfolio.ts`: cent rounding, live valuation, signs and signed money
- `frontend/src/domain/market.ts`: `nextSelection` takes a `held` parameter
- `frontend/src/store/watchlist.ts`: `held`, `setHeld`, and `setEntries` reconciling against `held`
- Tests: `header.test.tsx` (new), `portfolio.test.ts` (new), `terminal.test.tsx` (migrated to `stubApi`, plus store, reconnect and selection cases), `market.test.ts`

## Decisions Made
- Nudge constant: 1e-7 of a cent (assumption P-1), applied to the cent-scaled magnitude before flooring; the result is never -0.
- A stale load (sequence number at or below the last applied one) is dropped entirely, including its failure. This stops it raising a load error after a newer trade has already applied a portfolio.
- `pctSign` uses the same half-up 2 dp rounding as `toCents`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test correctness] Header wordmark assertions**
- **Found during:** Task 1
- **Issue:** The header now holds readouts, so asserting the banner text is exactly `^FinAlly$` no longer holds.
- **Fix:** `header.test.tsx` asserts the `h1` heading text instead. I dropped the banner-text and button-count assertions from the Terminal panels test, which the plan had already moved to `header.test.tsx`.
- **Files modified:** frontend/src/components/header.test.tsx, frontend/src/components/terminal.test.tsx
- **Committed in:** 6b38162

**2. [Rule 1 - Test correctness] Trade-error test expects the loaded cash**
- **Found during:** Task 1
- **Issue:** The test asserted that `cash` is null after a rejected trade. `Terminal` now loads the portfolio on mount, so `cash` is 10000.
- **Fix:** The test now asserts that the rejected trade leaves the loaded portfolio ($10,000) untouched.
- **Committed in:** 6b38162

**3. [Rule 2 - Robustness] stubApi lookup order and a `callsTo` helper**
- **Found during:** Task 1
- **Issue:** If `METHOD /path` were matched across all routes before `/path`, a test's bare `/path` override would lose to the default `GET /path`.
- **Fix:** Overrides are looked up before defaults, and inside each set `METHOD /path` comes before `/path`. I also added a `callsTo(mock, path, method)` helper so fetch counts filter by URL and method.
- **Committed in:** 6b38162

---

**Total deviations:** 3 auto-fixed (2 test correctness, 1 test-helper robustness)
**Impact on plan:** None on product behavior; no scope creep.

## Issues Encountered
- The worktree had no `frontend/node_modules`. I ran `npm --prefix frontend ci` from the existing lockfile (no new packages). `git diff --quiet 245a40c -- frontend/package.json frontend/package-lock.json` passes.

## Verification
- `npm --prefix frontend test`: 9 files, 160 tests passed; no "Maximum update depth exceeded"
- `npm --prefix frontend run lint`: clean
- `npm --prefix frontend run typecheck`: clean
- `npm --prefix frontend run build`: static export succeeded
- Grep gates: `setHeld` is in the watchlist store, and that store doesn't import `@/store/portfolio`. Exactly one file has `new EventSource` (`src/stream/priceStream.ts`). There are no dependency changes since 245a40c.

## User Setup Required

None.

## Next Phase Readiness
- 02-04 can render the positions table and heatmap from `livePortfolio(...).rows`, and have rows and tiles call `useWatchlist.select(ticker)` for held tickers.
- 02-05 and 02-06 extend `usePortfolio.refresh()` with the trade list and the P&L history.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*

## Self-Check: PASSED
