---
phase: "03"
overall_score: 18
max_score: 24
baseline: abstract 6-pillar standards + PLAN §2/§10 (no UI-SPEC.md)
screenshots: none (no dev server reachable; code-only audit)
interaction_capture: false
audited: 2026-10-29
---

# Phase 03 — UI Review

**Overall: 18/24.** Code-only audit of `ChatPanel.tsx` and `Terminal.tsx`, with a grep of the components for hardcoded colors and arbitrary sizes, plus the `03-UAT.md` results. `Header.tsx` (reset flow) and `store/chat.ts` were not audited beyond what `ChatPanel.tsx` shows. The tablet UAT notes record 1024x768. The 768x1024 result is not recorded separately.

## Pillar Summary

| Pillar | Score | Key finding |
|--------|-------|-------------|
| Copywriting | 3/4 | Specific copy: "FinAlly is thinking…", "Ask FinAlly…", starter prompts, failed chips carry the server error |
| Visuals | 3/4 | Bubbles clearly differentiated (user right/tinted, assistant bordered). Failed chips distinct by red border, text and a "⚠" prefix |
| Color | 3/4 | `bg-submit` purple on Send per PLAN §2. `PnlChart.tsx:56-59` still hardcodes `#22c55e` / `#ef4444` (carried over from Phase 2) |
| Typography | 2/4 | `text-[11px]` ×4 in `ChatPanel.tsx` (lines 69, 128, 243, 257) adds a third small size. `TradeBar.tsx:177` uses `text-[10px]` |
| Spacing | 3/4 | Consistent gap-1 / p-1.5 / px-1.5 py-0.5 scale. Fixed `grid-cols-2` pairs (`Terminal.tsx:83,87`) have no breakpoint; fixed center rows make the stacked page tall |
| Experience Design | 4/4 | Loading row, pending/reset/unsettled send lock, Enter vs Shift+Enter, IME guard, `role="alert"` error bubbles, starter prompts, collapse with aria-expanded/controls, store refresh after actions. UAT passed |

## Top Fixes

1. **Off-scale type sizes (WARNING).** Collapse `text-[11px]` (ChatPanel ×4) and `text-[10px]` (`TradeBar.tsx:177`) to `text-xs`, or define one `text-2xs` token and use it everywhere.
2. **Half-width panel pairs on tablet (WARNING).** `Terminal.tsx:83,87` use fixed `grid-cols-2`. At 768px, next to the 240px watchlist, each half is about 240px, which is cramped for the 6-column positions table. Use `grid-cols-1 md:grid-cols-2` or stack below xl (still open from the Phase 2 review). Confirm with 768x1024 screenshots.
3. **Hardcoded P&L chart colors (WARNING).** `PnlChart.tsx:56-61`: read the up/down CSS variables in the chart's mount effect so the chart matches the terminal.

## Minor Recommendations

- The collapsed chat rail at xl (2.75rem, "«" glyph only) has a visually hidden title. Consider a rotated "AI" label.
- The collapse toggle (`px-1.5`, `text-xs`) is well below a 24px touch target.
- Executed chips have no success cue beyond text. Acceptable, since failed chips are distinct and show the full error.

## Positives

- The chat is a 360px side rail at ≥1280px and stacks under the center column below 1280px, as UAT confirmed.
- Every chat state (loading, error, empty with starter prompts, collapsed) is handled and accessible.
