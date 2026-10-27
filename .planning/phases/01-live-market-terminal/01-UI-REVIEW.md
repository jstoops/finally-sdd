# Phase 01 — UI Review

**Audited:** 2026-10-26
**Baseline:** Abstract 6-pillar standards plus 01-CONTEXT.md D-01..D-12 and PLAN.md §2/§10 (no UI-SPEC.md)
**Screenshots:** Not captured (no dev server on 3000/5173/8080/8000). Code-only audit; nothing below was verified visually.
**Interaction captures:** off (workflow.ui_interaction_capture is false). Interaction findings are code-derived.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | D-12 strings match; error copy is server-supplied and unverified; "Chart" and "Add ticker" labels are terse |
| 2. Visuals | 3/4 | Clear grid and focal chart; placeholders are weak; sparkline color is misleading; small hit targets |
| 3. Color | 3/4 | Palette tokens correct; accent yellow does double duty (wordmark and "reconnecting"); canvas hexes duplicated |
| 4. Typography | 2/4 | Everything is `text-xs` mono at 12px; only 2 sizes in use; hierarchy leans on caps and weight |
| 5. Spacing | 3/4 | Consistent compact scale, no arbitrary values; 20px remove target; chart `min-h-64` can overflow short viewports |
| 6. Experience Design | 2/4 | Loading, empty and error states are good; no live-region, no reduced-motion, error only on load/add, hover-hidden remove |

**Overall: 16/24**

---

## Top 3 Priority Fixes

1. **Flash animation ignores reduced motion and has no accessible price updates** — `globals.css:29-47`, `Watchlist.tsx:93-101`. Users with vestibular or motion sensitivity get a 2 Hz flicker across 10 rows, and screen readers get nothing. Add `@media (prefers-reduced-motion: reduce) { .flash-up,.flash-down { animation: none } }`. Give the Chg % cell a text or arrow cue, not color alone (see #3).
2. **Typography has no hierarchy** — every component uses `text-xs` (12px), with `text-sm` only for chart status and the `+` button. The chart header (`ChartPanel.tsx`, the `<h2>`) shows the selected ticker's live price at the same size as the "CHART" label. Make the chart title and price `text-base` or `text-lg` with `font-semibold`, since this is the focal point of the screen. Keep the watchlist rows at `text-xs`.
3. **Color-only signalling (up/down)** — `Watchlist.tsx` `CHG_CLASS`, sparkline `stroke-up`/`stroke-down`, and the connection dot (green, yellow, red) carry meaning by hue alone. The dot has `aria-label` and `title`, which is good, but the Chg % and the sparkline have no non-color cue. The sign prefix on Chg % helps; add an arrow or keep the sign, and give the dot a text state in the header for colorblind users.

Further fixes (priority 4 and beyond):

4. **Sparkline color is judged against session open, not the sparkline's own trend** (`Watchlist.tsx:89`, `rising = price >= open`). A line that visibly falls over the last minute can render green. Either color by the visible window (first vs last point) or state in a tooltip that color means "vs session open". WARNING.
5. **Remove target is 20x28px and invisible until hover** (`Watchlist.tsx` remove button `w-5 h-7 opacity-0`). It is also hidden from sighted keyboard users until focus (fine) but below the 24px minimum target width; widen to `w-6` and raise the idle opacity to ~30% so it is discoverable. WARNING.
6. **Placeholder panels are low-signal** (`Terminal.tsx` `ComingSoon`, `bg-panel/60 text-muted`). They are 45% of the screen, and the dimmed text-on-translucent panel reads as a rendering fault. Add a dashed border or icon to look intentional. WARNING.
7. **Inline add error never announces failures to the chart/watchlist when remove fails except via the add slot** (`Watchlist.tsx` `onError={setError}` shared between row remove and add form). A failed remove shows its message under the add input with no association to the row. Minor; consider a row-level hint. WARNING.
8. **No `aria-live` or `role` on the chart header price or Chg %**; the chart canvas has no accessible name or text alternative. WARNING.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)
- D-12 strings are implemented exactly: `Loading ${selected}…`, `Add a ticker to start charting`, `Waiting for prices…` (`ChartPanel.tsx`, `status` block). PASS.
- Placeholder copy follows D-01: "Heatmap — coming in Phase 2", "P&L — coming in Phase 2", "Positions & Trade — coming in Phase 2", "AI Chat — coming in Phase 3" (`Terminal.tsx:55-67`). It names internal build phases ("Phase 2"). That is project jargon shown to an end user; a user-facing label such as "Coming soon" fits better. WARNING.
- Watchlist empty state "Your watchlist is empty" (`Watchlist.tsx`) gives no action hint, unlike the chart's "Add a ticker to start charting". WARNING (minor).
- Add input has `aria-label="Add ticker"` and the submit button reuses the same `aria-label="Add ticker"`; two controls with identical names are ambiguous for assistive tech. Name the button "Add".
- Error messages are passed from the server (400) and the client regex message; I did not verify the wording against PLAN.md. No generic "Submit"/"OK" labels found.
- Header shows only wordmark and dot (D-02); no fake values. PASS.

### Pillar 2: Visuals (3/4)
- Grid matches D-01 (`Terminal.tsx:44-70`): 260px watchlist / fluid center / 360px chat at xl, chart 55 / heatmap+P&L 25 / positions 20. Chart is the clear focal point. PASS.
- D-04 selected style: `border-l-2 border-primary bg-primary/10`. PASS. D-06 `×` stops propagation. PASS.
- Sparkline: 64x18 SVG, 1px stroke, `overflow-visible`, no area/end-dot. Legible but thin; see fix 4 on semantics.
- Icon-only controls: the `×` and `+` buttons have `aria-label`; the connection dot has `role="status"` and `aria-label`. PASS.
- Header is 36px with wordmark and dot only; sparse but per D-02.
- Chart panel title row `h2` holds interactive-looking data (price, chg) styled as a heading; semantic misuse, low impact.
- Unverified visually: gradient fill, crosshair, dashed "Open" line contrast (`#8b949e` on `#1a1a2e` is acceptable on paper).

### Pillar 3: Color (3/4)
- Tokens in `globals.css:11-21` match the contract: `#0d1117` bg, `#1a1a2e` panel, `#ecad0a` accent, `#209dd7` primary, `#753991` submit. No pure black found. PASS.
- Purple is used only on the add `+` submit button, per PLAN. PASS.
- Accent yellow is used for the wordmark and for the "reconnecting" dot (`Header.tsx`). The same hue means "brand" and "warning"; WARNING (minor).
- Hardcoded hex values are confined to `CHART_THEME` (`domain/chart.ts:8-16`), which is necessary for the canvas but duplicates the CSS tokens, so a theme change needs two edits. Flash uses `rgb(34 197 94 / .35)` and `rgb(239 68 68 / .35)` literals in CSS rather than the tokens. WARNING (minor).
- 60/30/10: bg and panel dominate; primary appears on selection, chart line and focus rings; accent only on wordmark. Distribution is healthy.
- Up/down green `#22c55e` and red `#ef4444` on `#1a1a2e`: adequate contrast, but color-only (see fix 3).

### Pillar 4: Typography (2/4)
- Sizes in use (non-test source): `text-xs` throughout, `text-sm` for chart status text and the `+` glyph. Only 2 sizes. Weights: `font-semibold` and default; 2 weights. Counts are within limits, but the problem is the opposite of excess: no hierarchy.
- The chart's ticker, live price and Chg % (D-10 header) are `text-xs font-mono`, the same as table rows and panel labels. The key number on the screen is 12px.
- `tabular-nums` is applied to prices and Chg %, which prevents jitter. PASS.
- System font stacks only (layout comment); acceptable and Docker-safe, but `font-mono` is the global feel for labels too (uppercase tracking-wide `h2`), which is somewhat fatiguing at 12px.
- Min row size 12px text is at the lower bound for readability.

### Pillar 5: Spacing (3/4)
- Spacing classes are from the standard scale (`p-1`, `px-2`, `py-1`, `gap-1`, `h-7`, `h-9`, `h-6`, `w-5`). No arbitrary px values except the grid templates (`240px`, `260px`, `360px`, `64px` sparkline column), which are layout, not spacing. PASS.
- D-03 row height `h-7` = 28px. PASS.
- `gap-1` (4px) between panels is very tight but consistent with the terminal intent.
- Remove button `w-5` (20px) is below the usual 24px target minimum. Add form controls are `h-6` (24px). Dense but tight for touch (tablet is a stated target).
- `min-h-64` on the chart and `min-h-64` on chat at `md` mean the page scrolls on tablet. This is intended per the layout comment. Unverified visually.

### Pillar 6: Experience Design (2/4)
- States covered: loading (`Loading X…`), empty chart, empty watchlist, history load failure falls back to an empty chart with live ticks, stale response guard via `requestIdRef`. PASS.
- Connection status: three-state dot with labels. PASS.
- Add form: pending disables the button; error clears on keystroke; text is kept on error (D-07). PASS.
- Gaps:
  - No `prefers-reduced-motion` handling for the 500ms flash (fix 1).
  - No `aria-live` for price or connection changes beyond `role="status"` on the dot.
  - `loadError` (watchlist fetch failure) renders only text with no retry control (`Watchlist.tsx` `loadError` paragraph). WARNING.
  - Remove is destructive with no undo and no confirmation (by design, D-06). Acceptable but there is no recovery path other than re-adding.
  - Remove button is `opacity-0` until hover or focus; on desktop it is undiscoverable by mouse until hovering a row.
  - No keyboard shortcut or arrow-key navigation between rows; every row is a Tab stop (10+ stops before the chart).
  - No tests or captures verify the flash in a real browser; verification is code-only.
- Registry audit: `components.json` not checked; no shadcn in the stack. Skipped.

---

## Files Audited
- frontend/src/app/globals.css, layout.tsx, page.tsx
- frontend/src/components/Terminal.tsx, Header.tsx, Watchlist.tsx, ChartPanel.tsx
- frontend/src/domain/market.ts, chart.ts
- frontend/src/store/watchlist.ts (selection logic)
- Context: 01-CONTEXT.md, planning/PLAN.md §2/§10
