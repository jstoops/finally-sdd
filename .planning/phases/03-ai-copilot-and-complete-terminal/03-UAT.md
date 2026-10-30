---
status: testing
phase: 03-ai-copilot-and-complete-terminal
source: [03-VERIFICATION.md]
started: 2026-10-30T07:58:13Z
updated: 2026-10-30T07:58:13Z
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

### 3. Tablet layout at 1024x768 and 768x1024
expected: Every panel is usable with no overlap or horizontal scroll; the three starter prompts are readable and clickable in an empty chat; the chat collapse toggle shrinks it to a rail (landscape) or header row (portrait) and restores it.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
