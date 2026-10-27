| WR-05 |  | fixed | 1aa139a (01-REVIEW-FIX.md) || WR-04 |  | fixed | cbcee40 (01-REVIEW-FIX.md) || WR-03 |  | fixed | 4a93b73 (01-REVIEW-FIX.md) || WR-02 |  | fixed | 71b7447 (01-REVIEW-FIX.md) || WR-01 |  | fixed | cb3ce2b (01-REVIEW-FIX.md) || CR-01 |  | fixed | 6524d2d (01-REVIEW-FIX.md) |---
phase: 01
review: 01-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "Blank `DB_PATH` puts the Docker database outside the persistent volume (data loss)"
  - id: WR-01
    severity: warning
    disposition: open
    title: "A watchlist add that commits but fails to reconcile is never repaired by a retry"
  - id: WR-02
    severity: warning
    disposition: open
    title: "`npm run typecheck` fails on a clean checkout"
  - id: WR-03
    severity: warning
    disposition: open
    title: "The red \"disconnected\" state is effectively unreachable when the server is down"
  - id: WR-04
    severity: warning
    disposition: open
    title: "The watchlist is fetched once and never recovers from a failed load"
  - id: WR-05
    severity: warning
    disposition: open
    title: "Rollback can mask the original SQLite error"
  - id: IN-01
    severity: info
    disposition: open
    title: "Live ticks that arrive while history is in flight are dropped from the chart"
  - id: IN-02
    severity: info
    disposition: open
    title: "A stale `loadWatchlist` response can overwrite a newer add or remove"
  - id: IN-03
    severity: info
    disposition: open
    title: "DELETE with a malformed path ticker returns 400, not 404"
  - id: IN-04
    severity: info
    disposition: open
    title: "The `/api/*` catch-all hides 405s and misses HEAD and OPTIONS"
  - id: IN-05
    severity: info
    disposition: open
    title: "The ticker error message echoes unbounded user input"
  - id: IN-06
    severity: info
    disposition: open
    title: "Client sanitizer silently rewrites \"BRK B\" into \"BRKB\""
  - id: IN-07
    severity: info
    disposition: open
    title: "`apiFetch` header merge drops `Headers` instances"
  - id: IN-08
    severity: info
    disposition: open
    title: "The image can include stale `backend/static` assets and test code, and runs as root"
  - id: IN-09
    severity: info
    disposition: open
    title: "The compose file needs Compose 2.24+, and the app is reachable from the LAN by default"
  - id: IN-10
    severity: info
    disposition: open
    title: "A chart time-format test depends on the host locale"
  - id: IN-11
    severity: info
    disposition: open
    title: "A cancelled snapshot can still write after shutdown starts"
open: 17
total: 17
recorded: 2026-10-27T16:12:50.991Z
---

# Phase 01: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |
| IN-08 | info | open | - |
| IN-09 | info | open | - |
| IN-10 | info | open | - |
| IN-11 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved.
