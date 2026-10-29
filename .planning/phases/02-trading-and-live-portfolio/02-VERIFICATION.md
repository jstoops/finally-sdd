---
phase: 02-trading-and-live-portfolio
verified: 2026-10-28T23:20:00Z
status: passed
score: 36/38 must-haves verified
covered_files:
  - .planning/phases/02-trading-and-live-portfolio/02-01-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-01-SUMMARY.md
  - .planning/phases/02-trading-and-live-portfolio/02-02-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-02-SUMMARY.md
  - .planning/phases/02-trading-and-live-portfolio/02-03-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-03-SUMMARY.md
  - .planning/phases/02-trading-and-live-portfolio/02-04-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-04-SUMMARY.md
  - .planning/phases/02-trading-and-live-portfolio/02-05-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-05-SUMMARY.md
  - .planning/phases/02-trading-and-live-portfolio/02-06-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-06-SUMMARY.md
  - .planning/phases/02-trading-and-live-portfolio/02-07-PLAN.md
  - .planning/phases/02-trading-and-live-portfolio/02-07-SUMMARY.md
  - backend/app/api/portfolio.py
  - backend/app/main.py
  - backend/app/money.py
  - backend/app/portfolio.py
  - backend/app/snapshots.py
  - backend/app/tracker.py
  - backend/app/trading.py
  - backend/app/valuation.py
  - backend/tests/test_money.py
  - backend/tests/test_portfolio_api.py
  - backend/tests/test_trading.py
  - frontend/src/components/Header.tsx
  - frontend/src/components/Heatmap.tsx
  - frontend/src/components/PnlChart.tsx
  - frontend/src/components/PositionsTable.tsx
  - frontend/src/components/Terminal.tsx
  - frontend/src/components/TradeBar.test.tsx
  - frontend/src/components/TradeBar.tsx
  - frontend/src/components/TradeHistory.tsx
  - frontend/src/domain/portfolio.ts
  - frontend/src/store/portfolio.ts
covered_digest: "v3:sha256:5122726155ade04815abb1552af29acd40fcf4a7bdc21ed151086572934e439e"
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 25/28
  gaps_closed:
    - "CR-01: a huge finite quantity (1e24, 1e30, 25-digit integer) returned 500; now 400 with the cap message and nothing changes (ROADMAP SC2, TRD-01, TRD-06)"
    - "WR-03: JSON true, false, \"10\" and \"1e24\" were accepted or coerced as quantity; now 422 at the route and a DomainError at the service (TRD-06)"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "After a reset the sparklines are cleared (PLAN section 10; review WR-02)"
    addressed_in: "Phase 3"
    evidence: "ROADMAP Planning Notes: 'Reset clearing sparklines (MD-05) and resetting the chart selection (MD-07) ships with PF-10 in Phase 3. Phase 2's reset (PF-09) restores server state and refreshes the portfolio and watchlist panels.' Phase 3 SC4: 'Reset ... clears the chat panel, sparklines and chart selection'. Unchanged by 02-07: store/prices.ts has no clear action and Header ResetButton does not clear sparklines."
behavior_unverified_items:
  - truth: "GET /api/portfolio reads cash and positions inside one deferred read transaction, so a concurrent trade yields the before or the after state, never a mix (02-01, verification: backstop)"
    test: "Under load, issue GET /api/portfolio repeatedly while 20 concurrent buys run, and assert cash_balance + positions at cost is always consistent with a committed state"
    expected: "Every response equals the state before or after some committed trade; never cash from one trade and positions from another"
    why_human: "view_sync does BEGIN (deferred) then two SELECTs and COMMIT, which gives SQLite snapshot isolation in WAL mode, but no test interleaves a read with a write; presence of the transaction cannot prove the isolation level (journal mode) actually yields a stable snapshot"
  - truth: "GET /api/portfolio/history during a trade returns the snapshot list from before or after that trade's commit, never a partial row (02-06, verification: backstop)"
    test: "Poll /api/portfolio/history while trades commit and assert each response is a prefix-consistent list (no row without its trade)"
    expected: "Snapshot count only ever steps by whole committed rows"
    why_human: "A single SELECT is atomic by SQLite semantics, but no test exercises the interleaving"
human_verification:
  - test: "Rapid-click timing in a real browser: type AAPL and 1, click Buy 10 times as fast as possible, then compare the header Cash to 10000 minus the sum of the trade-history costs"
    expected: "Exactly one in-flight request at a time (buttons disabled while pending); cash equals the starting balance minus the displayed fills to the cent; no duplicate fills beyond what was clicked after each response"
    why_human: "pendingRef and the disabled state are unit-tested under jsdom, but real event-loop timing and double-click coalescing can only be judged in a browser"
  - test: "Open http://localhost:8000 at 1920x1080 and 1280x800 and inspect the terminal layout: header, watchlist, chart, heatmap, P&L chart, positions, trade bar and history"
    expected: "Dense, readable, no clipped or overlapping panels; heatmap tiles legible; P&L chart shows its baseline at 10,000; green/red coloring matches P&L sign"
    why_human: "Visual density and layout (the UI review scored 17/24, advisory) cannot be asserted from jsdom tests"
  - test: "Watch the header Total/P&L, positions table and heatmap for 30 seconds while holding two positions, one of them removed from the watchlist"
    expected: "All three update on every price tick with no network calls to /api/portfolio (check DevTools Network); the unwatched held ticker keeps streaming"
    why_human: "Live visual tick behavior and network-tab absence of polling are runtime observations"
  - test: "Click Reset in a real browser after trading, confirm the dialog, and inspect all panels"
    expected: "$10,000 cash, no positions or trades, one P&L point, default watchlist. Note: sparklines will still hold pre-reset history (deferred to Phase 3 PF-10)"
    why_human: "window.confirm and full-panel refresh are stubbed in unit tests"
  - test: "Type a very large quantity (for example 1000000000000000000000000) in the real trade bar and click Buy"
    expected: "The inline alert reads 'Quantity must be at most 1,000,000,000.' and cash, positions and history are unchanged (the unit test pins this under jsdom with a stubbed fetch; this confirms it against the real server)"
    why_human: "The end-to-end UI-to-server path is covered by a stubbed-fetch Vitest case plus a TestClient route test, never by one real browser run"
---

# Phase 2: Trading and Live Portfolio Verification Report

**Phase Goal:** The user can buy and sell shares from the trade bar and watch cash, positions, the heatmap, the P&L chart and trade history update live and stay correct to the cent, then reset to a fresh $10,000 account
**Verified:** 2026-10-28T23:20:00Z
**Status:** human_needed
**Re-verification:** Yes - after gap closure (plan 02-07, commits c1472f7..a547264, merge c8f24e9)

## Verification Approach

This is a re-verification. The two gaps from the previous report (CR-01, WR-03) got a full three-level check against the live code. Everything that passed before got a regression check. Only `backend/app/trading.py`, `backend/app/money.py` (docstring only), `backend/app/api/portfolio.py` and three test files changed since the plan was written (`git diff --name-only 20773c7 HEAD`). The frontend source is untouched, so the earlier frontend verification stands. SUMMARY claims were not used as evidence.

Evidence gathered this round:

- Read `trading.py` and `api/portfolio.py` in full, and the diff of `money.py` (only a docstring paragraph added).
- Reproduced the original failing requests, plus boundary and wrong-type variants, through a real `TestClient` app with a throwaway test file (deleted afterward). After every request the cash, position count and trade count were asserted unchanged. See the spot-check table.
- Ran the full backend suite once: 388 passed. `ruff check` and `ruff format --check` are clean. The 23 tests selected by `-k "max_quantity or overflow or oversized or huge or wrong_typed"` pass. All nine named tests from the plan exist at the expected files.
- Ran `TradeBar.test.tsx`: 29 passed, including the new 25-digit case. The orchestrator ran the full Vitest suite (255 passed) and lint and typecheck (clean).
- `git diff` of `backend/pyproject.toml`, `backend/uv.lock`, `frontend/package.json` and `frontend/package-lock.json` against 245a40c is empty. `git diff b811769 HEAD -- frontend/src/components/TradeBar.tsx` is empty.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Buy/Sell fills instantly at the streamed price with no dialog; self-clearing fill message; qty field clears; cash exact to the cent even under rapid clicks; trade atop history | VERIFIED (rapid-click real-browser timing is a human item) | Unchanged since the previous report. Re-check this round: integer `10` buy returns 200 with quantity 10.0, and a 0.5 sell returns 200. The 20-way concurrent buy test is in the 388 passing tests |
| SC2 | An invalid order shows the server's message inline and changes nothing; selling a whole position removes it from the table and heatmap | VERIFIED (was FAILED edge) | Reproduced live: 1e24 buy, 1e30 sell and a 25-digit integer buy each give `400 {"error": "Quantity must be at most 1,000,000,000."}`. 9e23 and 1,000,000,001 give the same 400. The state check after each request showed cash, positions and trades unchanged. The earlier 400s (oversell, below 0.0001, unpriced ticker, insufficient cash) are still in the passing suite. The UI path is pinned by the Vitest case, which asserts a JSON number body `1e24` and an inline `role="alert"` `data-kind="error"` message |
| SC3 | Header, cash, P&L, positions table and heatmap move live with SSE prices and no `/api/portfolio` polling; empty-heatmap text; row/tile click charts that ticker | VERIFIED (regression check) | No frontend source changed. The 255-test Vitest suite is green |
| SC4 | P&L chart plots snapshots recorded at startup, every 30 s and after each trade; single point renders; refreshes | VERIFIED (regression check) | Backend snapshot code untouched; `trading.py` still calls `insert_snapshot(conn, self._cache)` inside `_trade_tx` (line 239). Suite green |
| SC5 | A held ticker removed from the watchlist keeps streaming; selling an unwatched ticker to zero stops pricing; Reset restores $10,000, default watchlist, no positions/trades | VERIFIED (regression check) | `reconcile_quietly` after commit (line 112) unchanged; reset tests green in the 388 |

### Gap Closure Check (02-07 must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| G1 | 1e24 buy, 25-digit integer buy and 1e30 sell return 400 with the exact cap message, nothing changes, never 500 | VERIFIED | Live repro: 400 for all three; `_valid_quantity` checks `value > MAX_QUANTITY` (line 142) before the first `round4` (line 145) |
| G2 | Typing a 25-digit quantity sends JSON number 1e24 and shows the server 400 inline | VERIFIED (stubbed fetch; real-browser run is a human item) | `TradeBar.test.tsx:151` passes. `TradeBar.tsx` is byte-identical to b811769 |
| G3 | `TradeService.execute` raises only DomainError for every rejected quantity (above cap, 9e23, int beyond float range, InvalidOperation backstop) | VERIFIED | `_valid_quantity` wraps float() with `(TypeError, ValueError, OverflowError)` and round4 with `except InvalidOperation`. Tests `test_above_max_quantity_is_rejected`, `test_int_overflow_is_a_domain_error` and `test_decimal_overflow_is_a_domain_error` pass. The route returns 400 for 9e23, which previously would have overflowed `notional` inside the transaction |
| G4 | Exactly MAX_QUANTITY reaches the cash and share rules; just above is rejected on the raw value | VERIFIED | Live: 1e9 buy gives "Insufficient cash (need $190,520,000,000.00, have $10,000.00)."; 1e9 sell gives "Insufficient shares (need 1000000000, have 0)."; 1,000,000,001 gives the cap message. `test_at_max_quantity_reaches_the_cash_and_share_rules` passes |
| G5 | Rounding contract unchanged; no quantity at or below the cap can overflow quantize | VERIFIED | `money.py` function bodies unchanged (diff is a docstring paragraph only). `test_max_quantity_stays_in_decimal_range` passes |
| G6 | The quantity gate runs before the shared lock and before any SQL; parallel oversized and valid buys leave exactly 5 fills | VERIFIED | In `execute`, `_valid_quantity` is called at line 107 before `async with self._lock` at line 108. `test_oversized_quantity_is_rejected_without_taking_the_lock` and `test_oversized_orders_in_parallel_leave_valid_fills_exact` pass |
| G7 | Quantity JSON true, false, "10" or "1e24" returns 422 and changes nothing; integer 10 still fills 200 | VERIFIED | `TradeRequest.quantity: StrictFloat`. Live: true, false, "10", "1e24", null and missing all give 422 with state unchanged; integer 10 gives 200. A 400-digit JSON integer gives 422 (pydantic float overflow), not 500. The 25-digit integer still reaches the service and gets the 400 |
| G8 | `execute` called directly with True, False, "10" or None raises DomainError 'Quantity must be a positive number.' | VERIFIED | The type gate at line 133 (`isinstance(quantity, bool) or not isinstance(quantity, (int, float))`). `test_wrong_typed_quantity_is_rejected` passes |
| P1 | MUST NOT silently resize an order: above-cap is rejected, never clamped (test tier) | VERIFIED | The code raises at line 143; there is no clamp path. Live repro showed state unchanged after every oversized request, and the 5-fill test asserts exact cash. Enforcement is wired to named tests, so this is not an unverified-prohibition flag |
| P2 | MUST NOT turn a non-number quantity into a real fill (test tier) | VERIFIED | Route 422 plus service DomainError, both tested; live repro showed no fill for true, false, "10" |

### Plan must-have truths carried from the previous report

Items 1-13 and 16 from the previous report (single trade path, response shapes, half-up cent rounding, in-transaction snapshot, tracker reconcile, reset, header sign and parity, sequence guards, selection handling, heatmap and table behavior, trade list ordering, the two prohibitions, quantity validation) still hold. Item 16's earlier caveat (large finite values) is now resolved. No file they depend on changed except `trading.py` and `api/portfolio.py`, whose other logic is as before.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 14 | GET /api/portfolio read is a stable snapshot under concurrent trades (backstop) | PRESENT_BEHAVIOR_UNVERIFIED | Deferred read tx in `view_sync`; no interleaving test |
| 15 | GET /api/portfolio/history never returns a partial row during a trade (backstop) | PRESENT_BEHAVIOR_UNVERIFIED | Single SELECT; no interleaving test |

**Score:** 36/38 must-haves verified (28 from the first round plus the 10 gap-closure truths and prohibitions), 2 present but behavior-unverified (backstop). No failed items.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Reset clears sparklines (review WR-02, PLAN section 10) | Phase 3 (PF-10) | ROADMAP Planning Notes and Phase 3 SC4 assign sparkline and chart-selection clearing on reset to PF-10 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/app/trading.py` | Cap, backstops, type gate | VERIFIED | Contains `MAX_QUANTITY = 1_000_000_000` (line 40), `QUANTITY_TOO_LARGE`, `InvalidOperation` and `OverflowError` handling; wired from the route |
| `backend/app/api/portfolio.py` | `quantity: StrictFloat` | VERIFIED | Line 24; `ticker` and `side` remain plain `str` so those stay 400s |
| `backend/app/money.py` | Precision-range docstring | VERIFIED | Docstring only; mentions `InvalidOperation` |
| `backend/tests/test_trading.py`, `test_money.py`, `test_portfolio_api.py` | Named tests | VERIFIED | All nine named tests found and passing |
| `frontend/src/components/TradeBar.test.tsx` | Cap-message UI test | VERIFIED | Line 151 case passes |
| Remaining Phase 2 artifacts (`valuation.py`, `portfolio.py`, `snapshots.py`, `tracker.py`, stores, panels) | As before | VERIFIED | Unchanged since the previous report |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `api/portfolio.py` | `trading.py` | `trade_service.execute(body.ticker, body.quantity, body.side)` (line 40) | WIRED |
| `trading.py` `_valid_quantity` | `money.py` `round4` | cap check at line 142, then `round4` in try/except InvalidOperation | WIRED |
| `TradeBar.tsx` | `/api/portfolio/trade` | store posts JSON `{ticker, quantity, side}`; 400 text shown in the message slot | WIRED (stubbed-fetch test) |
| All earlier links (route to service, service to snapshots and tracker, panels to the store) | | | WIRED, unchanged |

### Data-Flow Trace (Level 4)

Unchanged and FLOWING for Header, PositionsTable, Heatmap, TradeHistory and PnlChart (no frontend source changed). The new 400 path flows from `DomainError` to the error envelope to the trade bar message.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Original CR-01 probe: 1e24 buy | TestClient POST | 400 `Quantity must be at most 1,000,000,000.` (was 500) | PASS |
| Original CR-01 probe: 1e30 sell | TestClient POST | 400, same message (was 500) | PASS |
| 25-digit JSON integer buy | raw JSON body | 400, same message | PASS |
| 9e23 buy (overflowed `notional` in the transaction) | raw JSON body | 400, same message | PASS |
| Cap boundary: 1e9 buy / 1e9 sell / 1,000,000,001 | raw JSON body | Insufficient cash / Insufficient shares / cap message | PASS |
| 1e400, NaN, zero, 0.00004 | raw JSON body | 400 "Quantity must be a positive number." / "at least 0.0001." | PASS |
| Original WR-03 probe: quantity `true` | TestClient POST | 422 (was 200, bought 1 share) | PASS |
| false, "10", "1e24", null, missing field | TestClient POST | 422 each | PASS |
| 400-digit integer | raw JSON body | 422 (no 500) | PASS |
| State after every rejected request | cash, positions, trades via API | unchanged (10000.0, 0, 0) | PASS |
| Positive controls: integer 10 buy, 0.5 sell | TestClient POST | 200, quantities 10.0 and 0.5 | PASS |
| Backend suite | `uv run --extra dev pytest -q` | 388 passed | PASS |
| Lint and format | `ruff check`, `ruff format --check` | clean | PASS |
| TradeBar Vitest | `npx vitest run src/components/TradeBar.test.tsx` | 29 passed | PASS |
| Full Vitest, lint, typecheck | orchestrator run, not repeated | 255 passed, clean | PASS (reported by orchestrator) |

### Probe Execution

SKIPPED - no probe scripts declared by the phase plans.

### Requirements Coverage

All 21 phase IDs appear in PLAN frontmatter (02-01 through 02-07) and in REQUIREMENTS.md traceability as Phase 2. None are orphaned (PF-10 is Phase 3).

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| TRD-01 | 02-01, 02-02, 02-07 | SATISFIED | Normalization, 4dp, no-price message, and now every quantity (any size or type) is a DomainError |
| TRD-02 | 02-01, 02-02 | SATISFIED | Avg-cost formula, insufficient-cash message |
| TRD-03 | 02-01, 02-02 | SATISFIED | Oversell 400, tolerance clamp, dust delete |
| TRD-04 | 02-02 | SATISFIED | Decimal half-up at write time |
| TRD-05 | 02-01, 02-02 | SATISFIED | Lock, BEGIN IMMEDIATE, in-transaction snapshot |
| TRD-06 | 02-01, 02-07 | SATISFIED | 200/400/422 shapes correct; huge quantity is 400, wrong-typed body is 422 |
| TRD-07 | 02-01, 02-05 | SATISFIED | Fractional, no dialog, pending-disable |
| TRD-08 | 02-05 | SATISFIED | Inline 400, 422 "Invalid request", clears on edit |
| TRD-09 | 02-05 | SATISFIED | Fill message from the response, 3 s clear |
| TRD-10 | 02-05 | SATISFIED | `/api/trades` newest first |
| WL-06 | 02-02, 02-06 | SATISFIED | Held stays priced, sell-to-zero untracks, reset resyncs |
| PF-01 | 02-01, 02-02 | SATISFIED | Shape and fallbacks (read-isolation backstop unverified) |
| PF-02 | 02-02, 02-06 | SATISFIED | Startup, 30 s, per-trade, post-reset snapshots |
| PF-03 | 02-06 | SATISFIED | History oldest first |
| PF-04 | 02-03 | SATISFIED | Live header, no polling |
| PF-05 | 02-03 | SATISFIED | P&L since start |
| PF-06 | 02-04 | SATISFIED | Live table |
| PF-07 | 02-04 | SATISFIED | Squarify heatmap |
| PF-08 | 02-06 | SATISFIED | Baseline series, single point |
| PF-09 | 02-06 | SATISFIED | Confirm, one transaction, shared lock |
| MD-08 | 02-03, 02-04 | SATISFIED | Row and tile click chart a held but unwatched ticker |

Bookkeeping note (not a code gap): `.planning/REQUIREMENTS.md` still lists these rows as "Pending" (and MD-08, PF-06, PF-07 as "Gaps Found"), and `02-REVIEW-DISPOSITION.md` still marks CR-01 and WR-03 "open". `02-SECURITY.md` does not yet record T-02-18, T-02-19 and T-02-20. The orchestrator should update these after this verification (the 02-07 SUMMARY lists the same follow-ups).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `backend/app/trading.py` | ~147-176 | Half-up cost on tiny orders (WR-01) | Warning (carried) | Up to half-cent underpay on 0.0001-share buys; a rounding-direction policy decision to settle before Phase 3 auto-trading |
| `frontend/src/components/PositionsTable.tsx`, `Heatmap.tsx` | - | `loaded`/`loadError` never read (WR-04) | Warning (carried) | Empty state is shown for a failed load |
| `backend/app/trading.py` | ~113 | Post-commit `view_sync` unguarded (IN-01) | Info (carried) | Possible 500 for a committed fill |

The earlier blocker (unguarded `round4`) and the lax `float` field are resolved. No TBD, FIXME or XXX markers in files changed by 02-07.

### Human Verification Required

See frontmatter `human_verification` (5 items: real-browser rapid-click timing, layout density at two viewports, live no-polling check, real Reset, and one real-browser run of the oversized-quantity message) and `behavior_unverified_items` (2 backstop truths: concurrent read isolation for `/api/portfolio` and `/api/portfolio/history`). These need a person or a concurrency harness; none is a code defect found by this verification.

### Gaps Summary

No gaps remain. CR-01 and WR-03 are closed in the live code, and the originally failing requests now behave as the plan requires: 1e24 and 1e30 return 400 with a fixed message, `true` and `"10"` return 422, and every rejected request left cash, positions and trades unchanged. The service raises only `DomainError` for quantity failures, so the Phase 3 per-action executor contract holds. The cap check sits ahead of every Decimal operation and ahead of the shared lock. Dependency manifests and `TradeBar.tsx` are unchanged. The status is `human_needed` rather than `passed` because of the two backstop truths that no test exercises and the browser-only checks listed above. The earlier warnings WR-01 and WR-04 remain open as non-blocking advisories, and sparkline clearing on reset stays deferred to Phase 3 PF-10.

---

_Verified: 2026-10-28T23:20:00Z_
_Verifier: Claude (gsd-verifier)_
