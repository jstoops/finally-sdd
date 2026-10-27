---
status: testing
phase: 01-live-market-terminal
source: [01-VERIFICATION.md]
started: 2026-10-27T16:17:58.527Z
updated: 2026-10-27T16:17:58.527Z
---

## Current Test

number: 1
name: Open http://localhost:8000 after `scripts/start_windows.ps1` (or `start_mac.sh`) and look at the terminal
expected: |
  Dark terminal (no pure black), yellow/blue/purple accents, 10 default tickers streaming; price cells flash green/red and fade in about 500ms; digits do not jitter; sparklines fill in progressively
awaiting: user response

## Tests

### 1. Open http://localhost:8000 after `scripts/start_windows.ps1` (or `start_mac.sh`) and look at the terminal
expected: Dark terminal (no pure black), yellow/blue/purple accents, 10 default tickers streaming; price cells flash green/red and fade in about 500ms; digits do not jitter; sparklines fill in progressively
result: [pending]

### 2. Click several watchlist rows and watch the main chart
expected: Lightweight Charts canvas renders an area line pre-filled with about 5 minutes, extends live with local HH:MM:SS axis labels, dashed Open line shown, no flicker on switching
result: [pending]

### 3. Add a ticker, remove one with the hover x, and repeat on a tablet-width window
expected: x appears on row hover or keyboard focus and stays visible on touch/no-hover devices; inline errors for malformed symbol and the 51st ticker are readable
result: [pending]

### 4. With the app open, run `docker compose restart app` (not `down -v`)
expected: Header dot goes yellow, then red after about 3 seconds of failed reconnects, then green again by itself; the watchlist re-fetches and prices resume
result: [pending]

### 5. Run `./scripts/start_mac.sh` on macOS or Linux with a desktop session
expected: Browser opens to http://localhost:8000 (open / xdg-open path); script is harmless on a second run
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
