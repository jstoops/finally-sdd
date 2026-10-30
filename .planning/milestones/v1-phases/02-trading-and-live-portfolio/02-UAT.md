---
status: complete
phase: 02-trading-and-live-portfolio
source: [02-VERIFICATION.md]
started: 2026-10-29T09:45:00Z
updated: 2026-10-29T09:45:18.142Z
---

## Current Test

[testing complete]

## Tests

### 1. Rapid-click timing in a real browser
expected: Type AAPL and 1, click Buy 10 times as fast as possible. Exactly one in-flight request at a time (buttons disabled while pending); header Cash equals 10000 minus the displayed fills to the cent; no duplicate fills beyond what was clicked after each response.
result: pass

### 2. Layout at 1920x1080 and 1280x800
expected: Open http://localhost:8000 at both sizes. Header, watchlist, chart, heatmap, P&L chart, positions, trade bar and history are dense, readable, not clipped or overlapping; heatmap tiles legible; P&L chart baseline at 10,000; green/red matches P&L sign.
result: pass

### 3. Live updates without polling
expected: Hold two positions, one removed from the watchlist, and watch for 30 seconds. Header Total/P&L, positions table and heatmap update on every price tick with no network calls to /api/portfolio (DevTools Network); the unwatched held ticker keeps streaming.
result: pass
note: "/api/portfolio/history is intentionally polled every 30 s by PnlChart (PNL_REFRESH_MS) to pick up timer snapshots; no /api/portfolio polling observed"

### 4. Reset in a real browser
expected: After trading, click Reset and confirm the dialog. $10,000 cash, no positions or trades, one P&L point, default watchlist. (Sparklines still hold pre-reset history; deferred to Phase 3 PF-10.)
result: pass

### 5. Huge quantity in the real trade bar
expected: Type 1000000000000000000000000 as the quantity and click Buy. The inline alert reads "Quantity must be at most 1,000,000,000." and cash, positions and history are unchanged.
result: pass
retest_note: "First run hit a stale container (image built before 02-07 commit a547264) and showed 'Insufficient cash'; rebuilt with docker compose up -d --build, API now returns the cap message"

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
