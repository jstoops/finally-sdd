---
status: testing
phase: 03-ai-copilot-and-complete-terminal
source: [03-VERIFICATION.md]
started: 2026-10-30T07:58:13Z
updated: 2026-10-30T08:10:00Z
---

## Current Test

number: 1
name: Sign off on CR-01 (reset is not serialized with an in-flight chat turn)
expected: |
  Decide whether the backend race is acceptable (plan threat T-03-12 accepted it as a demo
  limitation) or must be fixed before the phase closes. PF-10's written text is met: Reset is
  disabled while this tab's chat is pending. A second tab, a direct API call, or a send during a
  reset can still run the model's actions on the fresh $10,000 account and store an orphan reply.
  Fix if rejected: reset route waits on the chat turn lock, Send is disabled while a reset runs,
  the chat clears as soon as the reset POST succeeds, plus a reset-mid-turn test.
awaiting: user response

## Tests

### 1. Sign off on CR-01 (reset is not serialized with an in-flight chat turn)
expected: Either an explicit acceptance of the race as a demo limitation, or a fix (reset waits on the chat turn lock) with a reset-mid-turn test.
result: [pending]

### 2. Live "Analyze my portfolio" with the real model
expected: With OPENROUTER_API_KEY set and a few positions held, asking "Analyze my portfolio" returns a reply that cites the actual cash, positions and P&L, and a "buy"/"add" request through the real model executes and shows chips.
result: [pending]
notes: 2026-10-30 partial: real model replied "Placing order to buy 5 shares of NVDA." and the trade executed with chips (live trade path works). Portfolio analysis citing real cash/positions/P&L still to check.

### 3. Tablet layout at 1024x768 and 768x1024
expected: Every panel is usable with no overlap or horizontal scroll. Below 1280px wide (both tablet sizes) the chat sits under the center column and the page scrolls; the three starter prompts are readable and clickable in an empty chat; the collapse toggle shrinks the chat to its header row and restores it. (The thin side rail exists only at 1280px and wider.)
result: pass
notes: 2026-10-30 user: every panel usable at 1024x768 with chat stacked below Positions/Trade (by design below 1280px). After a hard refresh (cached pre-Phase-3 page earlier), the empty chat showed 3 starter prompts; clicking "Buy 5 NVDA" executed and NVDA appeared in Trades, Positions and Heatmap; collapse toggle shrinks the chat to a thin strip and restores it.

## Summary

total: 3
passed: 1
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
