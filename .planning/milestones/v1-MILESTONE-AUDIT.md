---
milestone: v1
audited: 2026-10-30T22:30:00Z
status: tech_debt
scores:
  requirements: 64/64
  phases: 3/3
  integration: 10/10
  flows: 7/7
gaps:
  requirements: []
  integration: []
  flows: []
tech_debt:
  - phase: 01-live-market-terminal
    items:
      - "IN-02: loadWatchlist (frontend/src/store/watchlist.ts:63-72) has no sequence guard; a slow GET can overwrite a newer add/remove (more likely after a chat-reply refetch). Affects WL-02, WL-03, MD-07, AI-15"
      - "IN-04: wrong HTTP method on a real /api route returns 404 instead of 405 (catch-all at main.py:134-135; documented). Affects OPS-05. Info"
      - "IN-01, IN-03, IN-05..IN-11 from 01-REVIEW-DISPOSITION.md remain open (info only), e.g. live ticks during an in-flight history fetch are not charted"
      - "Backlog 999.1: UAT test 5 (start_mac.sh browser launch via open/xdg-open on a macOS/Linux desktop) skipped and deferred"
  - phase: 02-trading-and-live-portfolio
    items:
      - "WR-04: PositionsTable.tsx and Heatmap.tsx never read loaded/loadError, so a failed /api/portfolio load shows the empty state. Affects PF-06, PF-07"
      - "WR-01: quantity rounds half-up to 4dp (trading.py:145), so a 0.00005-share buy fills 0.0001 shares. Affects TRD-01, TRD-02. Low"
      - "IN-01: post-commit view_sync at trading.py:113 is unguarded; if it raises, the caller gets a 500 (or the AI executor reports 'failed') for a fill that committed. Affects TRD-05, AI-05. Low probability"
      - "Bookkeeping: 02-REVIEW-DISPOSITION.md still lists CR-01, WR-02 and WR-03 as open although they were closed by 02-07 (CR-01, WR-03) and PF-10 in Phase 3 (WR-02)"
      - "behavior_unverified: read isolation of GET /api/portfolio and /api/portfolio/history under concurrent trades has no concurrency test (backstop truths)"
  - phase: 03-ai-copilot-and-complete-terminal
    items:
      - "At 768px the watchlist column clips ticker symbols to their first letter (pre-existing, deferred by quick task 261029-vpc). Cosmetic"
      - "IN-01..IN-07 from 03-REVIEW.md (info): mock matches on word boundaries where PLAN §9 says 'contains'; long ticker echo; os.environ read from a worker thread; dead loaded state; repeated empty-submit bubbles; CI retries=1; fresh-start reset not asserted"
      - "03-VALIDATION.md is still status: draft (validate-phase never reconciled it)"
nyquist:
  compliant_phases: ["01", "02"]
  partial_phases: []
  not_validated_phases: ["03"]
  missing_phases: []
  overall: partial
---

# Milestone v1 Audit: FinAlly AI Trading Workstation

**Audited:** 2026-10-30
**Status:** ⚡ tech_debt (no blockers)

## Summary

All 64 v1 requirements are satisfied, and all three sources agree on each one: REQUIREMENTS.md traceability, SUMMARY frontmatter `requirements-completed`, and the VERIFICATION.md requirements tables. All three phases passed verification and human UAT. The integration checker traced all 10 cross-phase wiring points and all 7 PLAN §12 end-to-end flows and found no broken links. The remaining items are minor tech debt carried over from the code reviews, plus one skipped platform-specific UAT test.

Init reported `completed_phases: 1` and flagged Phases 1 and 2 as "stale". That is only because Phase 3 and quick task 261029-vpc changed covered files after those phases were verified. Phase 3's verification re-ran the full suites on the merged tree (backend 577 tests, frontend 347, E2E 17), and the integration check confirmed that the Phase 1 and 2 wiring is intact.

## Phases

| Phase | Plans | Verification | UAT | Security | Nyquist |
|-------|-------|--------------|-----|----------|---------|
| 01 Live Market Terminal | 7/7 | passed (5/5) | 4 pass, 1 skipped (macOS auto-open) | verified, 0 open | COMPLIANT |
| 02 Trading and Live Portfolio | 7/7 | passed (36/38; 2 backstop truths not exercised by any test) | 5/5 pass | verified, 0 open | COMPLIANT |
| 03 AI Copilot and Complete Terminal | 5/5 | passed (5/5) | 3/3 pass | verified, 0 open | NOT-VALIDATED (draft) |

## Requirements Coverage (3-source cross-reference)

| Group | IDs | Traceability | SUMMARY | VERIFICATION | Final |
|-------|-----|--------------|---------|--------------|-------|
| Ops | OPS-01..08 | [x] Phase 1 | listed | SATISFIED | satisfied |
| Watchlist | WL-01..05 | [x] Phase 1 | listed | SATISFIED | satisfied |
| Watchlist | WL-06 | [x] Phase 2 | listed | SATISFIED | satisfied |
| Market data | MD-01..07 | [x] Phase 1 | listed | SATISFIED | satisfied |
| Market data | MD-08 | [x] Phase 2 | listed | SATISFIED | satisfied |
| Trading | TRD-01..10 | [x] Phase 2 | listed | SATISFIED | satisfied |
| Portfolio | PF-01..09 | [x] Phase 2 | listed | SATISFIED | satisfied |
| Portfolio | PF-10 | [x] Phase 3 | listed | SATISFIED | satisfied |
| AI | AI-01..16 | [x] Phase 3 | listed | SATISFIED | satisfied |
| UX | UX-01 / UX-02 | [x] Phase 1 / 3 | listed | SATISFIED | satisfied |
| Testing | TST-01..04 | [x] Phase 3 | listed | SATISFIED | satisfied |

**Score:** 64/64 satisfied. There are no orphaned and no unclaimed requirements.

## Cross-Phase Integration

| # | Wiring | Status | Evidence |
|---|--------|--------|----------|
| 1 | The AI executor uses the same trade and watchlist services as REST; watchlist changes run first; each action runs independently | CONNECTED | `chat/actions.py:67-137`, shared instances at `main.py:76,129,131` |
| 2 | The tracker keeps watchlist ∪ positions priced across add/remove, sell-to-zero, reset and startup | CONNECTED | `tracker.py:28-38`, `watchlist.py:66,78`, `trading.py:112`, `portfolio.py:116`, `main.py:89-90` |
| 3 | Reset runs in one transaction, shares its locks with trades and chat turns, and the frontend clears its state | CONNECTED | `portfolio.py:114-140`, `service.py:86`, `Header.tsx:91-113`, `store/portfolio.ts:206-217` |
| 4 | A chat reply with actions makes the frontend refetch | CONNECTED | `ChatPanel.tsx:168-176` |
| 5 | The LLM context comes from the same valuation as `GET /api/portfolio` | CONNECTED | `service.py:91-93`, `prompt.py:35` |
| 6 | Live values are computed client-side from the shared SSE map; `/api/portfolio` is not polled | CONNECTED | `store/portfolio.ts:169`, `Terminal.tsx:65-66` |
| 7 | Snapshots are recorded at startup, every 30s, on each trade (AI trades included) and on reset | CONNECTED | `main.py:93-94`, `trading.py:239`, `portfolio.py:140` |
| 8 | Lifespan order and clean shutdown | CONNECTED | `main.py:82-105` |
| 9 | Unknown `/api/*` paths return a JSON 404, chat routes included | CONNECTED | `main.py:134-135` |
| 10 | E2E covers all 7 PLAN §12 scenarios | CONNECTED | `test/e2e/*.spec.ts` |

## E2E Flows

| Flow | Status |
|------|--------|
| Watch prices, select a ticker, see history plus live appends | complete |
| Manual buy (cash down, position appears, panels update) | complete |
| Manual sell to zero (position removed, tracker reconciled) | complete |
| Chat "buy" (mock LLM to trade service, chips, refetch) | complete |
| Chat failed action (⚠️ note plus failed chip) | complete |
| Reset (server state, chat, sparklines and selection cleared) | complete |
| Page reload (chat history restored) | complete |

## Tech Debt

See the `tech_debt` frontmatter for the full list. The items most worth a cleanup pass are:

1. **WR-04**: the positions table and heatmap show "No positions" when `/api/portfolio` fails to load. This is the user-visible one.
2. **IN-02**: `loadWatchlist` has no stale-response guard, unlike the portfolio and chat stores.
3. **IN-01 (Phase 2)**: the post-commit `view_sync` is unguarded, so in an unlikely case an AI trade that committed could be reported as failed.
4. **WR-01**: tiny quantities round half-up.
5. **Backlog 999.1**: the macOS/Linux `start_mac.sh` browser launch has never been tested on a real desktop.

## Nyquist Coverage

| Phase | VALIDATION.md | Compliant | Action |
|-------|---------------|-----------|--------|
| 01 | validated | true | none |
| 02 | validated | true | none |
| 03 | draft | not validated | `/gsd-validate-phase 3` |

---
_Audited: 2026-10-30_
_Auditor: Claude (gsd-audit-milestone orchestrator + gsd-integration-checker)_
