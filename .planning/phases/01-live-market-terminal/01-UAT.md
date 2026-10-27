---
status: testing
phase: 01-live-market-terminal
source: [01-VERIFICATION.md]
started: 2026-10-27T16:17:58.527Z
updated: 2026-10-27T16:27:43.630Z
---

## Current Test

number: 2
name: Click several watchlist rows and watch the main chart
expected: |
  Lightweight Charts canvas renders an area line pre-filled with about 5 minutes, extends live with local HH:MM:SS axis labels, dashed Open line shown, no flicker on switching
awaiting: user response

## Tests

### 1. Open http://localhost:8000 after `scripts/start_windows.ps1` (or `start_mac.sh`) and look at the terminal
expected: Dark terminal (no pure black), yellow/blue/purple accents, 10 default tickers streaming; price cells flash green/red and fade in about 500ms; digits do not jitter; sparklines fill in progressively
result: pass

### 2. Click several watchlist rows and watch the main chart
expected: Lightweight Charts canvas renders an area line pre-filled with about 5 minutes, extends live with local HH:MM:SS axis labels, dashed Open line shown, no flicker on switching
result: [pending] — retest. First run showed only the selected symbol, no chart: the container image was built before 01-06/01-07 merged (stale image, start script reused it). Rebuilt with --build 2026-10-27; served bundle now contains the chart code.

### 3. Add a ticker, remove one with the hover x, and repeat on a tablet-width window
expected: x appears on row hover or keyboard focus and stays visible on touch/no-hover devices; inline errors for malformed symbol and the 51st ticker are readable
result: [pending] — retest. First run showed no add input and no ×: same stale image as test 2. Rebuilt; served bundle now contains add-ticker-input and remove-{T}.

### 4. With the app open, run `docker compose restart app` (not `down -v`)
expected: Header dot goes yellow, then red after about 3 seconds of failed reconnects, then green again by itself; the watchlist re-fetches and prices resume
result: pass

### 5. Run `./scripts/start_mac.sh` on macOS or Linux with a desktop session
expected: Browser opens to http://localhost:8000 (open / xdg-open path); script is harmless on a second run
result: skipped — no macOS/Linux desktop available to the tester

## Summary

total: 5
passed: 2
issues: 0
pending: 2
skipped: 1
blocked: 0

## Gaps

- truth: "A user who pulls new code and runs the start script sees the current UI"
  status: open
  reason: "scripts/start_windows.ps1 and start_mac.sh build only when --build is passed or finally:latest is missing (D-14/D-15), so an existing image is silently reused after code changes. UAT tests 2 and 3 first failed for this reason."
  severity: minor
  test: 2
  artifacts: [scripts/start_windows.ps1, scripts/start_mac.sh, README.md]
  missing: ["either rebuild when sources are newer than the image, or make the README quick start say to pass --build after pulling changes"]
