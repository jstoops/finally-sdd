---
phase: 02
review: 02-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "A huge finite quantity raises `decimal.InvalidOperation` and returns 500 instead of 400"
  - id: WR-01
    severity: warning
    disposition: open
    title: "Half-up cost rounding lets tiny buys underpay, and tiny sells can give shares away for $0.00"
  - id: WR-02
    severity: warning
    disposition: open
    title: "Reset does not clear the sparklines (PLAN §10)"
  - id: WR-03
    severity: warning
    disposition: open
    title: "`TradeRequest.quantity` accepts JSON `true` as 1 share"
  - id: WR-04
    severity: warning
    disposition: open
    title: "Portfolio load failures are never shown, so panels show \"no positions\" for an account that may hold positions"
  - id: IN-01
    severity: info
    disposition: open
    title: "A failure after the commit turns a filled trade into a 500, and the user may retry"
  - id: IN-02
    severity: info
    disposition: open
    title: "`view_sync`'s `finally: COMMIT` can mask the real error"
  - id: IN-03
    severity: info
    disposition: open
    title: "Live valuation is recomputed three times per SSE frame in separate components"
  - id: IN-04
    severity: info
    disposition: open
    title: "Snapshot-loop tests depend on wall-clock timing"
open: 9
total: 9
recorded: 2026-10-29T04:08:28.231Z
---

# Phase 02: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
