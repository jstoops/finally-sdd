---
phase: 02-trading-and-live-portfolio
plan: 01
subsystem: api
tags: [fastapi, sqlite, decimal, zustand, nextjs, trading]

requires:
  - phase: 01-foundation
    provides: create_app with shared state_lock, Database.transaction (BEGIN IMMEDIATE), DomainError envelope, normalize_ticker, TickerTracker, PriceCache, apiFetch/ApiError, watchlist store pattern
provides:
  - money.py half-up Decimal helpers (to_cents, round4, notional, position_pnl, format_money, format_qty)
  - value_portfolio pure valuation in the PLAN section 8 shape
  - TradeService.execute(ticker, quantity, side), the single trade path (Trade, TradeResult, DUST)
  - PortfolioService.view / view_sync (deferred read transaction)
  - GET /api/portfolio and POST /api/portfolio/trade (create_portfolio_router, TradeRequest)
  - frozen Phase 2 wire types in frontend/src/api/types.ts
  - usePortfolio store with trade(); TradeBar and TradePanel in the terminal
affects: [02-02, 02-03, 02-04, 02-05, 02-06, phase-03-ai-executor, e2e]

actuals:
  tokens: 10950
  tasks: 1
  commits: 1
plan_head_before: 495e2fd54de2dedc5076a968295f2729915d26f3
plan_head_after: b384a91fe4736cc983458f525f9168235bd54c4a

tech-stack:
  added: []
  patterns:
    - "Money math only through money.py (Decimal(str(x)), ROUND_HALF_UP); never builtin round on money"
    - "Trade = lock -> to_thread(one BEGIN IMMEDIATE tx) -> to_thread(view_sync) under the same lock"
    - "Portfolio reads use one deferred BEGIN ... COMMIT so cash and positions are consistent"
    - "Request models carry no Literal/pattern so rule failures are 400 DomainError, not 422"

key-files:
  created:
    - backend/app/money.py
    - backend/app/valuation.py
    - backend/app/trading.py
    - backend/app/portfolio.py
    - backend/app/api/portfolio.py
    - backend/tests/test_portfolio_api.py
    - frontend/src/domain/portfolio.ts
    - frontend/src/store/portfolio.ts
    - frontend/src/components/TradeBar.tsx
  modified:
    - backend/app/api/__init__.py
    - backend/app/main.py
    - frontend/src/api/types.ts
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx

key-decisions:
  - "avg_cost stored at full precision, served at 4 dp; P&L, P&L % and the uncached-price fallback use the served value (A4)"
  - "Positions ordered by rowid; the buy UPSERT keeps the original rowid so order is first-purchase"
  - "TradeRequest.side is a plain str validated in the service (bad side = 400) (A5)"
  - "Buy is bg-up green, Sell bg-down red; purple stays on form-submit buttons (OQ-4)"
  - "Error fragments 'need $X, have $Y' / 'need N, have M' so Phase 3 can build failure notes (E-1)"
  - "TradeBar does a client-side ticker/quantity check (UX only) before calling the store; the server stays authoritative"

patterns-established:
  - "TradeService is the only writer of cash, positions and trades; Phase 3 calls execute() per action and catches DomainError"
  - "Wire dicts built with keys in PLAN section 8 order; tests assert list(body) == KEYS"

requirements-completed: [TRD-01, TRD-02, TRD-03, TRD-05, TRD-06, TRD-07, PF-01]

coverage:
  - id: D1
    description: "POST /api/portfolio/trade fills a buy at the cached price and returns trade + committed portfolio with exact keys; GET /api/portfolio matches"
    requirement: TRD-06
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_buy_returns_trade_and_committed_portfolio"
        status: pass
    human_judgment: false
  - id: D2
    description: "Selling the full position deletes the row and restores cash to 10000.0"
    requirement: TRD-03
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_sell_all_deletes_position_and_restores_cash"
        status: pass
    human_judgment: false
  - id: D3
    description: "Missing field or non-numeric quantity returns 422; unpriced ticker returns 400 with the verbatim no-price message and changes nothing"
    requirement: TRD-01
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_malformed_body_is_422"
        status: pass
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_unpriced_ticker_is_400_with_verbatim_message"
        status: pass
    human_judgment: false
  - id: D4
    description: "Insufficient cash, insufficient shares and a bad side return 400 with fixed messages and change nothing"
    requirement: TRD-02
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_insufficient_cash_and_shares_are_400_and_change_nothing"
        status: pass
    human_judgment: false
  - id: D5
    description: "Trade bar Buy sends one POST with the exact JSON body, shows 'Bought 10 AAPL @ $190.52', updates the store, and never calls window.confirm; errors render inline"
    requirement: TRD-07
    verification:
      - kind: automated_ui
        ref: "frontend/src/components/terminal.test.tsx#buys from the trade bar and confirms the fill"
        status: pass
      - kind: automated_ui
        ref: "frontend/src/components/terminal.test.tsx#shows a trade error inline"
        status: pass
    human_judgment: false
  - id: D6
    description: "Trade panel layout and Buy/Sell styling look right in the terminal grid"
    verification: []
    human_judgment: true
    rationale: "Visual layout and color judgment; no test asserts appearance"

duration: 9min
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 01: Trade Tracer Summary

**A trade bar Buy or Sell now fills instantly at the cached price through one `TradeService`. Each fill runs in a single BEGIN IMMEDIATE transaction under the shared state lock, uses half-up Decimal money math, returns the committed portfolio from POST /api/portfolio/trade, and is confirmed inline as "Bought 10 AAPL @ $190.52".**

## Performance

- **Duration:** 9 min
- **Started:** 2026-10-28T08:57:21Z
- **Completed:** 2026-10-28T09:05:52Z
- **Tasks:** 1 (tracer)
- **Files modified:** 14 (9 created, 5 modified)

## Accomplishments
- `TradeService.execute` is the only code path that changes cash, positions or trades. It reads the fill price from `PriceCache` inside the lock, applies the PLAN section 7 rules (buy cost check, avg-cost formula, sell tolerance with clamp, dust deletion) and writes everything in one transaction. The response portfolio is built under the same lock.
- `money.py` and `valuation.py` give cent-exact, half-up math. Unrealized P&L is computed in Decimal from the served 4 dp avg_cost, so a client holding only the wire values can reproduce it.
- `GET /api/portfolio` and `POST /api/portfolio/trade` are mounted before the `/api` catch-all and return the exact PLAN section 8 key order.
- On the frontend, every Phase 2 wire type is frozen. The `usePortfolio` store has `trade()`, and the Trade panel sits beside the Positions placeholder in a rebalanced 50/25/25 center column.

## Task Commits

1. **Task 1: Tracer: buy and sell from the trade bar end to end** - `b384a91` (feat)

## Files Created/Modified
- `backend/app/money.py` - Half-up Decimal rounding plus money and quantity formatting
- `backend/app/valuation.py` - `value_portfolio`, pure PLAN section 8 valuation
- `backend/app/trading.py` - `TradeService`, `Trade`, `TradeResult`, `DUST`
- `backend/app/portfolio.py` - `PortfolioService.view` / `view_sync` (deferred read transaction)
- `backend/app/api/portfolio.py` - `TradeRequest`, `create_portfolio_router`
- `backend/app/api/__init__.py` - exports `create_portfolio_router`
- `backend/app/main.py` - builds PortfolioService and TradeService on the shared `state_lock`, sets `app.state.trade_service` / `portfolio_service`, includes the router before `install_api_not_found`
- `backend/tests/test_portfolio_api.py` - `TestTradeTracer` (6 tests)
- `frontend/src/api/types.ts` - Position, Portfolio, Side, TradeRequest, Trade, TradeResponse, TradesResponse, Snapshot, SnapshotsResponse, ResetResponse
- `frontend/src/domain/portfolio.ts` - `STARTING_CASH`, `formatQty`, `formatMoney`
- `frontend/src/store/portfolio.ts` - `usePortfolio` (cash, positions, applyPortfolio, trade)
- `frontend/src/components/TradeBar.tsx` - `TradeBar`, `TradePanel`
- `frontend/src/components/Terminal.tsx` - Positions placeholder plus Trade panel in the bottom row; 50/25/25 rows
- `frontend/src/components/terminal.test.tsx` - updated panels test; trade tracer test and inline-error test

## Decisions Made
- These planner assumptions were adopted as written: A3 (layout), A4 (served 4 dp avg_cost), A5 (side as str), OQ-4 (green Buy, red Sell) and E-1 (message fragments).
- The insufficient-shares message formats quantities with `format_qty`, e.g. "Insufficient shares (need 1, have 0).".
- Before calling the store, TradeBar runs a UX-only client check: `tickerError` and a finite quantity > 0. This follows RESEARCH F3. The server stays authoritative.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Restored frontend dependencies in the worktree**
- **Found during:** Task 1 (frontend verification)
- **Issue:** The fresh worktree had no `frontend/node_modules`, so vitest, lint, typecheck and build could not run.
- **Fix:** Ran `npm --prefix frontend ci` from the existing lockfile. No packages were added, and `package.json` and `package-lock.json` are unchanged (the dependency diff check against 245a40c passes).
- **Files modified:** none tracked
- **Committed in:** n/a

**2. [Rule 2 - Missing critical] Added a second trade-error UI test and backend rule-failure tests**
- **Found during:** Task 1
- **Issue:** The plan's tracer tests covered the success path and the no-price 400. It had no inline error-rendering test and no insufficient-cash, insufficient-shares or bad-side assertions on this path.
- **Fix:** Added `shows a trade error inline` (frontend) and `test_insufficient_cash_and_shares_are_400_and_change_nothing` (backend). Plan 02-02 still owns the exhaustive rule proof.
- **Files modified:** frontend/src/components/terminal.test.tsx, backend/tests/test_portfolio_api.py
- **Committed in:** b384a91

---

**Total deviations:** 2 (1 blocking environment fix, 1 added coverage)
**Impact on plan:** Neither changes behavior or scope; the contract is exactly as planned.

## Issues Encountered
- `ruff format` rewrapped one line in `valuation.py`, and a docstring that mentioned `SnapshotRecorder` had to be reworded to meet the "no reference" acceptance criterion. Both were fixed before the commit.

## Verification Results
- `pytest -q tests/test_portfolio_api.py -k Tracer`: 6 passed
- Full backend suite: 264 passed; `ruff check` clean; `ruff format --check` clean
- `npm test`: 119 passed (terminal.test.tsx 28 passed); lint, typecheck and static build green
- Key-link grep/awk check passed: the route delegates to `trade_service.execute(`, valuation uses `position_pnl(`, and the router is included before `install_api_not_found(app)`
- No dependency change: `git diff --quiet 245a40c -- backend/pyproject.toml backend/uv.lock frontend/package.json frontend/package-lock.json`
- Tracer feedback gate: interactive run, `end-of-phase` mode, automated-only verify, so the verify was re-run (green) and no checkpoint was raised

## Known Stubs
- `frontend/src/components/Terminal.tsx`: the `panel-positions` ComingSoon placeholder ("Positions — coming in Phase 2") is intentional. Plan 02-04 replaces it with the positions table.
- `TradeService` stores `tracker` but does not call it yet. Plan 02-02 adds the in-lock reconcile and the snapshot, as designed.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness
- Plan 02-02 can put the snapshot insert inside `_trade_tx`, call the reconcile between `_trade_tx` and `view_sync`, and add the finite, positive and minimum quantity checks in front of `round4`.
- Plan 02-03 can add `loadPortfolio`, `refresh` and the sequence guard around `usePortfolio.trade`.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*
