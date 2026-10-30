---
phase: 261029-vpc-fix-phase-3-ui-review-findings
plan: 01
status: complete
subsystem: frontend
tags: [ui-review, typography, layout, color-tokens, a11y, e2e]
requires: [Phase 3 terminal (ChatPanel, Terminal, PnlChart, TradeBar)]
provides:
  - P&L chart colored from --color-up / --color-down tokens
  - Single text-xs small type scale (no arbitrary px sizes)
  - 24px chat toggle and visible vertical "AI Chat" label on the collapsed xl rail
  - Panel pairs stacked below lg (tablet layout)
  - test/e2e/layout.spec.ts real-browser layout checks with screenshots
affects: [UX-01, UX-02, PF-08, AI-12, TST-04]
tech-stack:
  added: []
  patterns:
    - CSS custom properties read once in a mount effect, validated as hex, with a fallback that mirrors globals.css
    - Literal Tailwind class constants (PANEL_PAIR, CENTER_ROWS) beside the existing GRID_/CHAT_ constants
key-files:
  created:
    - test/e2e/layout.spec.ts
  modified:
    - frontend/src/domain/chart.ts
    - frontend/src/domain/chart.test.ts
    - frontend/src/components/PnlChart.tsx
    - frontend/src/components/PnlChart.test.tsx
    - frontend/src/components/ChatPanel.tsx
    - frontend/src/components/ChatPanel.test.tsx
    - frontend/src/components/TradeBar.tsx
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx
decisions:
  - Reuse text-xs instead of adding a text-2xs token; the terminal now uses only text-xs and text-sm
  - The panel pairs stack below lg (1024px), not md, because md starts at the cramped 768px width
  - Center column rows are content-sized below lg so stacked pairs do not inflate the fr chart row
  - readColorToken accepts only 3/6-digit hex so the rgba fill derivation is always well-defined
metrics:
  duration: ~25min
  completed: 2026-10-30
estimate:
  tokens: 80000
  tasks: 3
actuals:
  tokens: 6600
  tasks: 3
  commits: 3
plan_head_before: ace40cdc4bf371453223620d8acc48ed871f5b4c
plan_head_after: 6bca6e66cf8b2bbf8fd336201dd53796d4149ef3
---

# Phase 261029-vpc Plan 01: Fix Phase 3 UI Review Findings Summary

All five UI review findings are fixed. The P&L chart takes its colors from the terminal's `--color-up`/`--color-down` tokens, which it reads in the mount effect. The arbitrary 10px/11px text sizes are now `text-xs`. The chat toggle is a 24x24 target. The collapsed xl chat rail shows "AI Chat" as vertical text. The Heatmap/P&L and Positions/Trade pairs stack below `lg`, and a new Playwright layout spec checks all of this in a real browser.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (tracer, TDD) | P&L chart colors from the up/down tokens | 4b9dff0 | domain/chart.ts(+test), PnlChart.tsx(+test) |
| 2 (TDD) | One type scale, 24px toggle, visible rail label | a4a1d16 | ChatPanel.tsx(+test), TradeBar.tsx |
| 3 | Stack panel pairs below lg, layout E2E, full gate | 6bca6e6 | Terminal.tsx, terminal.test.tsx, test/e2e/layout.spec.ts |

## What Changed

- **Color (finding 3):** `domain/chart.ts` gains the pure helpers `PNL_TOKEN_FALLBACK`, `readColorToken`, `hexToRgba` and `pnlSeriesColors`. `PnlChart` calls `getComputedStyle(document.documentElement)` once inside its create-once effect and spreads `pnlSeriesColors(up, down)` into the BaselineSeries options. With the fallbacks the six color strings are exactly what the component passed before, so the default look is unchanged. `PnlChart.tsx` no longer contains any color literals.
- **Typography (finding 1):** the four `text-[11px]` sizes in ChatPanel (chip, system row, loading row, prompt chip) and the `text-[10px]` on the TradeBar "Trades" heading are now `text-xs`. No non-test `.tsx` file uses an arbitrary pixel text size.
- **Touch target (finding 4):** `chat-toggle` gets `-my-1 inline-flex h-6 min-w-6 items-center justify-center`. The negative margin keeps the expanded header the same height as the other panel headers, and the collapsed state adds `xl:my-0`.
- **Rail label (finding 5):** the heading has `data-testid="chat-title"`. When collapsed it gets `xl:order-last xl:[writing-mode:vertical-rl]`, where it used to get `xl:sr-only`, so it shows as one vertical label under the toggle and adds no duplicate accessible text.
- **Spacing (finding 2):** `PANEL_PAIR` (`grid-cols-1` with 12rem rows below lg, `lg:grid-cols-2` from lg up) is used for both pairs. `CENTER_ROWS` uses content-sized rows below lg and keeps the existing lg/xl templates. GRID_*/CHAT_* are unchanged.

## Verification

- Unit tests: `npm --prefix frontend test` passed, 18 files and 347 tests (328 at baseline + 19 new).
- `npm --prefix frontend run lint` passed. `typecheck` passed. `build` passed, and the export CSS still defines `--color-up:` and `--color-down:`.
- Negative gates: 0 arbitrary px text sizes in non-test `.tsx` (5 at base). 0 green/red literals in `PnlChart.tsx` (6 at base). 0 `grid min-h-0 grid-cols-2 gap-1` wrappers in `Terminal.tsx` (2 at base), and `lg:grid-cols-2` is present.
- Docker E2E: `docker compose -p finally-test-vpc -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright` exited 0 with **17 passed**, including the 5 new layout tests and the existing 1440x900 fit check. The stack was then removed with `down -v`.
- Tracer gate (Task 1): the full `<verify>` chain (tests, then literal grep, then build, then CSS token grep) passed before expansion.
- Visual spot check of the `layout-768x1024` attachment: the chart, heatmap, P&L, positions, trade and chat panels are stacked full-width in the center column, and the 6 positions table columns are readable.

## Deviations from Plan

None. The plan executed as written.

Process notes:
- `frontend/node_modules` was missing in the fresh worktree. I ran `npm --prefix frontend ci` from the existing lockfile; no packages were added or changed.
- The worktree guard refused the `$(git rev-parse --git-dir)` ledger write, so `commits:` is measured directly against the known plan base `ace40cd` (`git rev-list --count ace40cd..HEAD` = 3).

## Deferred Issues (out of scope, pre-existing)

- At 768px the md watchlist column (240px, unchanged by this plan) clips the ticker symbols to their first letter, as the 768x1024 screenshot shows. The Watchlist row layout causes this, not the panel pairs. It was already present at the base commit and is left for a follow-up.

## Known Stubs

None.

## Threat Flags

None. The only new surface is the E2E spec, which runs only through the throwaway compose stack (T-261029-vpc-02 mitigated by `freshApp` and the BASE_URL guard).

## Self-Check: PASSED

- FOUND: frontend/src/domain/chart.ts, frontend/src/components/PnlChart.tsx, frontend/src/components/ChatPanel.tsx, frontend/src/components/TradeBar.tsx, frontend/src/components/Terminal.tsx, test/e2e/layout.spec.ts
- FOUND commits: 4b9dff0, a4a1d16, 6bca6e6 (ancestors of HEAD)
