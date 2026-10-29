---
status: testing
phase: 02-trading-and-live-portfolio
source: [02-VERIFICATION.md]
started: 2026-10-29T09:45:00Z
updated: 2026-10-29T09:45:00Z
---

## Current Test

number: 1
name: Rapid-click timing in a real browser
expected: |
  Type AAPL and 1, click Buy 10 times as fast as possible, then compare the header Cash to 10000 minus the sum of the trade-history costs. Exactly one in-flight request at a time (buttons disabled while pending); cash equals the starting balance minus the displayed fills to the cent; no duplicate fills beyond what was clicked after each response.
awaiting: user response

## Tests

### 1. Rapid-click timing in a real browser
expected: Type AAPL and 1, click Buy 10 times as fast as possible. Exactly one in-flight request at a time (buttons disabled while pending); header Cash equals 10000 minus the displayed fills to the cent; no duplicate fills beyond what was clicked after each response.
result: [pending]

### 2. Layout at 1920x1080 and 1280x800
expected: Open http://localhost:8000 at both sizes. Header, watchlist, chart, heatmap, P&L chart, positions, trade bar and history are dense, readable, not clipped or overlapping; heatmap tiles legible; P&L chart baseline at 10,000; green/red matches P&L sign.
result: [pending]

### 3. Live updates without polling
expected: Hold two positions, one removed from the watchlist, and watch for 30 seconds. Header Total/P&L, positions table and heatmap update on every price tick with no network calls to /api/portfolio (DevTools Network); the unwatched held ticker keeps streaming.
result: [pending]

### 4. Reset in a real browser
expected: After trading, click Reset and confirm the dialog. $10,000 cash, no positions or trades, one P&L point, default watchlist. (Sparklines still hold pre-reset history; deferred to Phase 3 PF-10.)
result: [pending]

### 5. Huge quantity in the real trade bar
expected: Type 1000000000000000000000000 as the quantity and click Buy. The inline alert reads "Quantity must be at most 1,000,000,000." and cash, positions and history are unchanged.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
