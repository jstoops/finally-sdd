---
phase: 02-trading-and-live-portfolio
verified: 2026-10-28T18:15:00Z
status: gaps_found
score: 25/28 must-haves verified
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
  - backend/app/api/portfolio.py
  - backend/app/main.py
  - backend/app/money.py
  - backend/app/portfolio.py
  - backend/app/snapshots.py
  - backend/app/tracker.py
  - backend/app/trading.py
  - backend/app/valuation.py
  - frontend/src/components/Header.tsx
  - frontend/src/components/Heatmap.tsx
  - frontend/src/components/PnlChart.tsx
  - frontend/src/components/PositionsTable.tsx
  - frontend/src/components/Terminal.tsx
  - frontend/src/components/TradeBar.tsx
  - frontend/src/components/TradeHistory.tsx
  - frontend/src/domain/portfolio.ts
  - frontend/src/store/portfolio.ts
covered_digest: "v3:sha256:3da0377bc7bf08d674a464358f19e6ea6d253e683f4f06781ca70a8f6e100f23"
behavior_unverified: 2
overrides_applied: 0
gaps:
  - truth: "An invalid order (insufficient cash, selling more than held, a quantity that rounds to zero, a malformed or unpriced ticker) shows the server's message inline and changes nothing; POST /api/portfolio/trade returns 400 {\"error\": ...} for every business-rule failure (ROADMAP SC2; TRD-06, TRD-01)"
    status: failed
    reason: "A huge finite quantity (about 1e24 or more) escapes TradeService as an unhandled decimal.InvalidOperation and returns 500 Internal Server Error instead of 400. Reproduced against a live app: POST {AAPL, 1e24, buy} -> 500 and {AAPL, 1e30, sell} -> 500, while 1e15 correctly returns 400 'Insufficient cash'. The trade bar's QTY_RE accepts any digit string, so a user typing such a quantity sees 'Request failed (500)' rather than the server's insufficient cash/shares message. The same defect breaks TradeService.execute's documented 'rule failures raise DomainError' contract that the Phase 3 AI executor depends on (a per-action DomainError handler would not catch it). Open as CR-01 in 02-REVIEW-DISPOSITION.md. The test matrix covers 1e400 (inf) but no large finite value, and 02-SECURITY.md T-02-01 is marked closed without covering it."
    artifacts:
      - path: "backend/app/trading.py"
        issue: "_valid_quantity calls round4() on any finite positive float; Decimal.quantize raises InvalidOperation above ~1e24 (28-digit context)"
      - path: "backend/app/money.py"
        issue: "round4/to_cents/notional have no range guard"
      - path: "backend/tests/test_trading.py"
        issue: "Rejection matrix (line ~200) lacks 1e24/1e30 buy and sell cases"
    missing:
      - "Cap quantity before any Decimal work (e.g. MAX_QUANTITY) and raise DomainError, and/or catch decimal.InvalidOperation in _valid_quantity and convert to DomainError"
      - "Add 1e24 and 1e30 buy and sell cases to the rejection matrix in test_trading.py and a 400 route test in test_portfolio_api.py"
  - truth: "POST /api/portfolio/trade: a missing field or a non-numeric quantity returns FastAPI's 422 (TRD-06, 02-01 truth 2)"
    status: partial
    reason: "TradeRequest.quantity is a lax pydantic float. JSON true is accepted and buys exactly 1 share (reproduced: 200), and numeric strings such as \"10\" are coerced. A wrong-typed body should be 422 under PLAN section 8. Low severity (no UI path sends a boolean) but it is a real trade executed from a malformed body, and it will matter to the Phase 3 AI path. Open as WR-03."
    artifacts:
      - path: "backend/app/api/portfolio.py"
        issue: "quantity: float (lax mode)"
    missing:
      - "Use StrictFloat (or an equivalent strict validator) for quantity and add 422 tests for true and \"10\""
deferred:
  - truth: "After a reset the sparklines are cleared (PLAN section 10; review WR-02)"
    addressed_in: "Phase 3"
    evidence: "ROADMAP Planning Notes: 'Reset clearing sparklines (MD-05) and resetting the chart selection (MD-07) ships with PF-10 in Phase 3. Phase 2's reset (PF-09) restores server state and refreshes the portfolio and watchlist panels.' Phase 3 SC4: 'Reset ... clears the chat panel, sparklines and chart selection'. Confirmed in code: store/prices.ts has no clear action and Header ResetButton does not clear sparklines."
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
---

# Phase 2: Trading and Live Portfolio Verification Report

**Phase Goal:** The user can buy and sell shares from the trade bar and watch cash, positions, the heatmap, the P&L chart and trade history update live and stay correct to the cent, then reset to a fresh $10,000 account
**Verified:** 2026-10-28T18:15:00Z
**Status:** gaps_found
**Re-verification:** No - initial verification

## Verification Approach

SUMMARY claims were not used as evidence. I read the backend (`trading.py`, `money.py`, `valuation.py`, `portfolio.py`, `snapshots.py`, `tracker.py`, `watchlist.py`, `api/portfolio.py`, `main.py`) and frontend (`store/portfolio.ts`, `domain/portfolio.ts`, `Header`, `TradeBar`, `TradeHistory`, `PositionsTable`, `Heatmap`, `PnlChart`, `Terminal`) directly, ran the full backend suite (365 passed, ruff clean) and frontend suite (254 passed), drove a real app instance through every user flow with a throwaway script, and fuzzed client-vs-server cent parity with 20,000 random portfolios (0 mismatches; temporary files removed).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Enter ticker + quantity (fractional ok), Buy/Sell fills instantly at streamed price with no dialog; self-clearing "Bought 10 AAPL @ $190.52"; qty field clears; cash moves by exactly the trade cost to the cent even under rapid clicks; trade appears atop history | VERIFIED (rapid-click real-browser timing is a human item) | Live probe: buy 10 AAPL @189.97 -> cash 8100.30 (exact); fractional 0.5 MSFT fills. `TradeBar.tsx`: no `window.confirm`, `pendingRef` + `disabled={pending}`, message from `outcome.trade` only, `MESSAGE_MS=3000`, `setQty("")` keeps ticker. `portfolio.ts trade()` prepends fill to `trades` and refetches `/api/trades`. Backend: `test_concurrent_buys_never_overspend` (20 parallel buys) passes; `asyncio.Lock` + `BEGIN IMMEDIATE` verified in `trading.py` / `db/__init__.py` |
| SC2 | Invalid order shows server message inline, changes nothing, clears on next edit; selling a whole position removes it from table and heatmap at once | FAILED (edge) | Verified 400s: oversell "Insufficient shares (need 11, have 10)", 0.00004 "Quantity must be at least 0.0001.", bad ticker, unpriced ZZZZ, 1e6 shares insufficient cash. Sell-all removes position (portfolio `positions: []`). **But qty 1e24 / 1e30 returns 500** (see Gaps). Inline error rendering + clear-on-edit verified in `TradeBar.tsx` (`show(null)` on change) |
| SC3 | Header total, cash, P&L since start, positions table and heatmap move live with streamed prices, no `/api/portfolio` polling; empty heatmap text; row/tile click charts that ticker | VERIFIED | `Header`/`PositionsTable`/`Heatmap` all `useMemo(livePortfolio(cash, positions, ticks))` on the shared `usePrices.ticks`. Grep: `/api/portfolio` is requested only in `store/portfolio.ts` (mount, reconnect, post-trade), no interval besides `/history`. Empty text exactly "No positions — buy something or ask FinAlly". Row click and tile click call `useWatchlist.select`. Client cent math fuzzed against server `value_portfolio`: 20,000 cases, 0 mismatches |
| SC4 | P&L chart plots snapshots recorded at startup, every 30 s and after each trade; renders with a single point; refreshes every 30 s and after each trade | VERIFIED | Lifespan `recorder.record()` then `run_snapshot_loop(30s)`; `insert_snapshot` inside the trade transaction; probe: history 7 rows after 6 actions then exactly 1 after reset. `PnlChart.tsx`: `BaselineSeries` base 10,000, `pointMarkersVisible: data.length <= 1`, `PNL_REFRESH_MS=30000`, `trade()` calls `loadHistory()`. `toSnapshotSeries` collapses same-second and drops out-of-order points |
| SC5 | Held ticker removed from watchlist keeps streaming and live P&L; selling an unwatched ticker to zero stops pricing it; Reset restores $10,000, no positions/trades, fresh P&L start, default watchlist | VERIFIED | Probe: bought TSLA, DELETE watchlist -> source still tracks TSLA with price; sold -> `Tracker: removed TSLA`. Reset (even `text/plain` POST) -> cash 10000, positions [], trades [], 1 snapshot @10000, watchlist = 10 defaults in order, source tickers = defaults (PYPL removed, TSLA re-added). Confirm gate and refresh in `Header.tsx`/`store.reset()` |

### Plan must-have truths (selected, beyond the roadmap contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | TradeService is the only code path mutating cash/positions/trades; price read under the lock | VERIFIED | Route is a thin call to `trade_service.execute`; `_cache.get_price` in `_trade_tx` under `self._lock` |
| 2 | Exact trade response shape; GET /api/portfolio shape; avg_cost 4dp; uncached price falls back to avg | VERIFIED | Probe output matches PLAN section 8; `value_portfolio` reviewed |
| 3 | Cent rounding half-up via Decimal; cash never shows float noise | VERIFIED | `money.py`; cash 7890.31 etc. exact in probe; 100 x 0.1 @33.33 test passes |
| 4 | Snapshot written in the trade's own transaction (no lock re-entry) | VERIFIED | `insert_snapshot(conn, cache)` in `_trade_tx`; no deadlock in 20-way test |
| 5 | Tracked tickers = watchlist union held; reconcile after commit, failures logged not raised | VERIFIED | Probe + `reconcile_quietly` |
| 6 | Reset: one BEGIN IMMEDIATE tx, shared lock, any POST resets, no 400 path | VERIFIED | `_reset_tx`, `reset()` under `self._lock`, route takes no body; `text/plain` probe returned 200 |
| 7 | Header sign/format, flat for sub-cent, SERVER parity to the cent | VERIFIED | `moneySign`/`formatSignedMoney` use cent-rounded value; fuzz parity |
| 8 | Stale GET /api/portfolio never overwrites a newer trade (sequence guard); same for trades and history lists | VERIFIED | `claim()`/`claimTrades`/`historyApplied` in `store/portfolio.ts`; unit tests pass |
| 9 | Held but unwatched selection survives watchlist changes, falls back after full sell | VERIFIED | `nextSelection(..., held)` and `setHeld` bridge in `Terminal.tsx` |
| 10 | Treemap/positions/heatmap behaviors (sign flat on 0.00, +/-5% clamp, label hidden on tiny tiles, text nodes) | VERIFIED | `Heatmap.tsx`, `PositionsTable.tsx`, `pnlColor`; tests green |
| 11 | Trade list newest first, LIMIT 100, same-second order by rowid | VERIFIED | `_load_trades` `ORDER BY executed_at DESC, rowid DESC LIMIT ?` |
| 12 | MUST NOT present simulated money as real (prohibitions, judgment-tier) | VERIFIED (non-authoritative) | Labels read Total / Cash / P&L since start / Positions / Heatmap; grep finds no "brokerage" or "real account" wording |
| 13 | MUST NOT show confirmation differing from the recorded fill (prohibition, test-tier) | VERIFIED | Message built only from `outcome.trade`; TradeBar tests assert it |
| 14 | GET /api/portfolio read is a stable snapshot under concurrent trades (backstop) | PRESENT_BEHAVIOR_UNVERIFIED | Deferred read tx present in `view_sync`; no interleaving test |
| 15 | GET /api/portfolio/history never returns a partial row during a trade (backstop) | PRESENT_BEHAVIOR_UNVERIFIED | Single SELECT; no interleaving test |
| 16 | Quantity validation: NaN/inf/1e400/zero/negative -> 400 before SQL | VERIFIED | Probe and tests; BUT see 1e24 gap for large finite values |

**Score:** 25/28 must-haves verified, 2 present but behavior-unverified (backstop), 1 failed (SC2 edge) - the partial 422 item is counted with the gaps, not as verified.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Reset clears sparklines (review WR-02, PLAN section 10) | Phase 3 (PF-10) | ROADMAP Planning Notes and Phase 3 SC4 assign sparkline/chart-selection clearing on reset to PF-10 |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/app/trading.py` | Single trade service | VERIFIED (with CR-01 defect) | Substantive, wired from route, tested |
| `backend/app/money.py` | Half-up Decimal helpers | VERIFIED | Wired into trading/valuation |
| `backend/app/valuation.py` | Shared value_portfolio | VERIFIED | Used by view_sync and snapshots |
| `backend/app/portfolio.py` | View, trades, history, reset | VERIFIED | All four implemented and routed |
| `backend/app/snapshots.py` | insert_snapshot + 30 s loop | VERIFIED | Started in lifespan |
| `backend/app/tracker.py` | reconcile / reconcile_quietly | VERIFIED | Used by watchlist, trade, reset |
| `backend/app/api/portfolio.py` | 5 routes | VERIFIED | `include_router` before `install_api_not_found` in `main.py` |
| `frontend/src/store/portfolio.ts` | Store with guards | VERIFIED | |
| `frontend/src/domain/portfolio.ts` | livePortfolio, toCents, pnlColor | VERIFIED | Server parity fuzzed |
| `frontend/src/domain/treemap.ts`, `pnl.ts` | squarify, snapshot series | VERIFIED | Imported by Heatmap / PnlChart |
| `Header`, `TradeBar`, `TradeHistory`, `PositionsTable`, `Heatmap`, `PnlChart` | Panels | VERIFIED | All mounted in `Terminal.tsx` |
| `backend/tests/test_reset.py`, `test_trading.py` | Reset/trade tests | VERIFIED | Present and passing |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `api/portfolio.py` | `trading.py` | `trade_service.execute(...)` | WIRED |
| `portfolio.py` | `valuation.py` | `value_portfolio(...)` | WIRED |
| `main.py` | `api/portfolio.py` | `create_portfolio_router(...)` | WIRED |
| `TradeBar.tsx` | `store/portfolio.ts` | `usePortfolio.getState().trade(...)` | WIRED |
| `store/portfolio.ts` | `/api/portfolio/trade`, `/api/trades`, `/api/portfolio/history`, `/api/reset` | `apiFetch` | WIRED |
| `Terminal.tsx` | portfolio store / watchlist store | `refresh()`, `setHeld()` | WIRED |
| `Header.tsx` | `domain/portfolio.ts` | `livePortfolio(...)` | WIRED |
| `Heatmap.tsx` | `treemap.ts`, `pnlColor` | `squarify(...)`, `pnlColor(pct)` | WIRED |
| `PnlChart.tsx` | `pnl.ts` | `toSnapshotSeries(...)` | WIRED |
| `trading.py` / `portfolio.py` | `snapshots.py`, `tracker.py` | `insert_snapshot(conn, ...)`, `reconcile_quietly(...)` | WIRED |
| `Header.tsx` Reset | `store.reset()` then `loadWatchlist()` | confirm gate | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Header total/P&L | `cash`, `positions`, `ticks` | `/api/portfolio` + SSE store | Yes | FLOWING |
| PositionsTable / Heatmap | `livePortfolio(...).rows` | same | Yes | FLOWING |
| TradeHistory | `trades` | `/api/trades` (SQL) + fills | Yes | FLOWING |
| PnlChart | `snapshots` | `/api/portfolio/history` (SQL) | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend suite | `uv run --extra dev pytest -q` | 365 passed | PASS |
| Lint | `ruff check .` | clean | PASS |
| Frontend suite | `npx vitest run` | 254 passed | PASS |
| Live flows (buy, fractional, oversell, dust, unwatched hold, sell-to-zero untrack, reset) | throwaway TestClient script | as expected | PASS |
| Huge quantity | POST qty 1e24 buy / 1e30 sell | 500 / 500 | FAIL |
| Boolean quantity | POST quantity true | 200, 1 share bought | FAIL (warning) |
| Client vs server cent parity | 20,000 random portfolios, node vs python | 0 mismatches | PASS |

### Probe Execution

SKIPPED - no probe scripts declared by the phase plans.

### Requirements Coverage

All 21 phase IDs appear in PLAN frontmatter and in REQUIREMENTS.md traceability as Phase 2; none are orphaned (PF-10 is Phase 3 and correctly absent).

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| TRD-01 | 02-01, 02-02 | PARTIAL | Normalization, 4dp, no-price message all verified; large finite quantity raises unhandled InvalidOperation (CR-01) |
| TRD-02 | 02-01, 02-02 | SATISFIED | Avg-cost formula, insufficient-cash message, exact boundary |
| TRD-03 | 02-01, 02-02 | SATISFIED | Oversell 400, tolerance clamp, dust delete, avg unchanged |
| TRD-04 | 02-02 | SATISFIED | Decimal half-up at write time |
| TRD-05 | 02-01, 02-02 | SATISFIED | Lock + BEGIN IMMEDIATE + in-tx snapshot |
| TRD-06 | 02-01 | PARTIAL | 200/400/422 shapes correct; 1e24 -> 500 and `true` accepted (CR-01, WR-03) |
| TRD-07 | 02-01, 02-05 | SATISFIED | Fractional, no dialog, pending-disable |
| TRD-08 | 02-05 | SATISFIED | Inline 400, 422 "Invalid request", clears on edit |
| TRD-09 | 02-05 | SATISFIED | Fill message from response, 3 s clear, qty cleared / ticker kept |
| TRD-10 | 02-05 | SATISFIED | `/api/trades` newest first, panel under trade bar |
| WL-06 | 02-02, 02-06 | SATISFIED | Probe: held stays priced, sell-to-zero untracks, reset resyncs |
| PF-01 | 02-01, 02-02 | SATISFIED | Shape, fallbacks, percent units, 4dp (read-isolation backstop unverified) |
| PF-02 | 02-02, 02-06 | SATISFIED | Startup, 30 s, per-trade, post-reset snapshots |
| PF-03 | 02-06 | SATISFIED | History oldest first |
| PF-04 | 02-03 | SATISFIED | Live header, no polling |
| PF-05 | 02-03 | SATISFIED | P&L since start with data-sign |
| PF-06 | 02-04 | SATISFIED | Live table, percent units |
| PF-07 | 02-04 | SATISFIED | In-house squarify, +/-5% scale, empty text |
| PF-08 | 02-06 | SATISFIED | BaselineSeries, single point, 30 s refetch |
| PF-09 | 02-06 | SATISFIED | Confirm, one transaction, shared lock, re-sync |
| MD-08 | 02-03, 02-04 | SATISFIED | Row and tile click chart a held but unwatched ticker |

### Open Review Findings Weighed Against Must-Haves

| Finding | Breaks a must-have? | Treatment |
|---------|--------------------|-----------|
| CR-01 huge quantity -> 500 | Yes: ROADMAP SC2, TRD-06, TRD-01 (insufficient cash / shares must be a 400 with the server message) and the Phase 3 per-action DomainError contract | Gap (BLOCKER) |
| WR-01 half-up cost lets a 0.0001-share buy underpay by up to half a cent; zero-proceeds sells | No: TRD-04 mandates half-up cent rounding, which the code implements exactly; it is a rounding-direction policy concern, not an incorrect-to-the-cent defect against the stated contract | Warning, recommend decision before AI auto-trading in Phase 3 |
| WR-02 reset keeps sparklines | No for Phase 2: ROADMAP explicitly assigns it to Phase 3 PF-10 | Deferred |
| WR-03 `true` accepted as quantity | Marginally: wrong-typed body should be 422 (TRD-06) | Partial gap (low) |
| WR-04 load failure never shown, empty states look like "no positions" | No stated must-have; resilience/UX defect that can mislead after a failed load | Warning |
| IN-01..IN-04 | No | Info, not blocking |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `backend/app/trading.py` | ~119-128 | Unguarded `round4` on arbitrary-magnitude float | BLOCKER | 500 on huge quantity (CR-01) |
| `backend/app/api/portfolio.py` | 12-20 | Lax `float` body field | Warning | Boolean/string coerced into a real trade |
| `frontend/src/components/PositionsTable.tsx`, `Heatmap.tsx` | - | `loaded`/`loadError` never read | Warning | Empty state shown for failed load (WR-04) |
| `backend/app/trading.py` | ~147-176 | Half-up cost on tiny orders | Warning | Up to half-cent underpay (WR-01) |
| `backend/app/trading.py` | ~106 | Post-commit `view_sync` unguarded | Info | Possible 500 for a committed fill (IN-01) |

No TBD/FIXME/XXX/TODO markers in the phase files. Stub scan clean.

### Human Verification Required

See frontmatter `human_verification` (4 items: real-browser rapid-click timing, layout density at two viewports, live no-polling check, real Reset) and `behavior_unverified_items` (2 backstop truths: concurrent read isolation for `/api/portfolio` and `/api/portfolio/history`).

### Gaps Summary

The phase delivers its goal in every normal flow: trades fill at the cached price to the cent, cash/positions/heatmap/header/P&L chart/trade history are driven live from SSE with no polling, held tickers stay priced, selling to zero untracks, and Reset restores the seeded account in one transaction. Client and server cent math agree on 20,000 fuzzed portfolios.

One defect blocks calling the phase complete: CR-01. A huge finite quantity (1e24 and above) turns a legitimate "insufficient cash" or "insufficient shares" case into a 500, contradicting ROADMAP SC2, TRD-06 and TRD-01, and silently breaking the `DomainError` contract that Phase 3's AI executor will rely on. The fix is small (cap quantity or catch `InvalidOperation` in `_valid_quantity`, plus test cases). WR-03 (strict quantity typing) is cheap to fix in the same change. Both should be closed with `/gsd-plan-phase --gaps` before Phase 3 starts. WR-01 and WR-04 are not must-have failures but deserve triage before the AI copilot can fire many small orders and before users hit a failed first load. Sparkline clearing on reset is correctly deferred to Phase 3 PF-10.

---

_Verified: 2026-10-28T18:15:00Z_
_Verifier: Claude (gsd-verifier)_
