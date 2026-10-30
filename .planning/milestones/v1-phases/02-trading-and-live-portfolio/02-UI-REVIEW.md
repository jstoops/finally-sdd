---
phase: "02"
slug: "trading-and-live-portfolio"
audited: "2026-10-28"
baseline: "abstract 6-pillar standards + PLAN.md §2/§10 (no UI-SPEC.md)"
screenshots: "not captured (playwright screenshot failed; code-only audit)"
overall: 17
---

# Phase 02 — UI Review

**Overall: 17/24.** This is a code-only audit: the server answered at `localhost:8000`, but screenshot capture failed, so the visual pillars have no screenshot evidence.

| Pillar | Score | Key finding |
|--------|-------|-------------|
| Copywriting | 3/4 | Labels, empty states and error text are specific. The "AI Chat — coming in Phase 3" placeholder is still visible. |
| Visuals | 3/4 | Clear hierarchy and Buy/Sell split. The heatmap and P&L panel share a small row; tablet layout is unverified. |
| Color | 3/4 | Tokens match PLAN §2. Purple `bg-submit` is not used on Buy/Sell, and the P&L chart hardcodes hex colors. |
| Typography | 3/4 | Tight scale (`text-xs` / `text-sm`, 2 weights, mono with `tabular-nums`). One `text-[10px]` breaks the floor. |
| Spacing | 3/4 | Consistent 1/1.5/2 spacing and 24px rows. The `grid-cols-2` panels never collapse, and the fixed column widths are tight at 1280px. |
| Experience Design | 2/4 | Loading, empty, error, pending and confirm states are covered. Missing: Enter-to-submit, a header load-error state, and tablet/mobile handling. |

## Top 3 Fixes

1. **Purple submit buttons (WARNING).** Buy and Sell use `bg-up` / `bg-down` (`frontend/src/components/TradeBar.tsx:139`, `:148`), but PLAN §2 reserves `#753991` for submit buttons. The only `bg-submit` use is the watchlist "+" button (`Watchlist.tsx:173`). Decide whether Buy/Sell stay green and red, or turn purple with a green/red side accent.
2. **Tablet and mobile layout (WARNING).** The center column forces three rows (`grid-rows-[minmax(16rem,50fr)_minmax(10rem,25fr)_minmax(12rem,25fr)]` in `Terminal.tsx`), and the Heatmap/P&L and Positions/Trade pairs are fixed `grid-cols-2` with no breakpoint. At 768px each half is about 260px wide, so the 6-column positions table and the trade-history row will clip. Fix: use `grid-cols-1` as the base with `md:grid-cols-2`, then capture tablet screenshots.
3. **Hardcoded colors and small text (WARNING).** `PnlChart.tsx:56-61` hardcodes `#22c55e`, `#ef4444` and rgba fills instead of the `--color-up` / `--color-down` tokens. The "Trades" subheader (`TradeBar.tsx:177`) uses `text-[10px]`, below the `text-xs` floor.

## Minor Recommendations

- Wrap the trade bar in a `<form>` so Enter submits.
- Show a ticker validation hint before submit.
- Add a header error state for a failed portfolio load (it currently shows "—" indefinitely).
- Restyle or replace the ComingSoon chat placeholder (`bg-panel/60` differs from the other panels); Phase 3 replaces it.
- Source the chart theme (`CHART_THEME`) from the CSS tokens.
- Make touch targets larger than the 24px rows on tablet.

## Detailed Findings

**Copywriting (3/4)**
- The fill confirmation is built from the recorded fill (`TradeBar.tsx:94`).
- Empty states: "No positions yet", "No trades yet", "No P&L history yet", and "No positions — buy something or ask FinAlly".
- The heatmap mixes "-" and "—" placeholders.
- The Reset label does not say it is destructive; the confirm dialog does.

**Visuals (3/4)**
- The header is a clear focal strip, the selected row has a primary left border, and the heatmap uses a diverging scale with labels hidden on small tiles.
- Heatmap and P&L each get half of a row that is about 25% of the center height, which is cramped on 900px-tall screens.
- Icon-only buttons carry an `aria-label`.

**Color (3/4)**
- `#0d1117`, `#1a1a2e`, accent `#ecad0a`, primary `#209dd7` and submit `#753991` are tokens, and there is no pure black.
- Accent is used sparingly, primary marks selection and focus, and green/red mark P&L.
- Heatmap `pnlColor` mixes RGB in JS, outside the theme tokens.

**Typography (3/4)**
- Usage counts: `text-xs` ×23, `text-sm` ×4, `text-[10px]` ×1; `font-semibold` ×17, `font-normal` ×6.

**Spacing (3/4)**
- `gap-1`, `p-1`, `px-2 py-1` panel headers, and `h-6` rows and inputs.
- The fixed 240/260px watchlist column and 360px chat column leave little room at 1280px.

**Experience Design (2/4)**
- Covered: loading, empty and error states; a pending guard that disables Buy/Sell; a success message that clears after 3s; `role="alert"` on errors; reset confirm plus disabled-while-resetting; SSE-live values with no polling; click-to-chart.
- Gaps: no Enter-to-submit, no header load-error state, no pre-trade cost hint, no tablet handling, and the dead chat placeholder.
- No blocker was raised, but the score is code-derived only.

## Files Audited

Under `frontend/src`: `app/globals.css`, `components/Terminal.tsx`, `components/TradeBar.tsx`, `components/PositionsTable.tsx`, `components/Header.tsx`, `components/Heatmap.tsx`, `components/PnlChart.tsx` and `components/TradeHistory.tsx`, plus grep sweeps of the other components.
