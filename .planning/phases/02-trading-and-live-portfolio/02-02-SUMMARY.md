---
phase: 02-trading-and-live-portfolio
plan: 02
subsystem: api
tags: [fastapi, sqlite, decimal, asyncio, trading, snapshots, pytest]

requires:
  - phase: 02-trading-and-live-portfolio
    provides: "02-01 TradeService.execute, money.py, value_portfolio, PortfolioService.view_sync"
  - phase: 01-foundation
    provides: "Database.transaction (BEGIN IMMEDIATE), TickerTracker, SnapshotRecorder, shared state_lock"
provides:
  - "insert_snapshot(conn, cache): a snapshot written inside the caller's transaction, taking no lock"
  - "portfolio_value delegates to value_portfolio, so snapshots and GET /api/portfolio agree to the cent"
  - "TickerTracker.reconcile_quietly(context), shared by the watchlist and trade paths"
  - "TradeService writes each fill's snapshot in the trade transaction and reconciles tracked tickers after commit"
  - "Trade input gate: math.isfinite, > 0, round4 > 0, MIN_ORDER_VALUE = 0.01 for buys"
  - "trade_env pytest fixture (TradeEnv) wiring every service on one shared lock"
affects: [02-05, 02-06, phase-03-ai-executor]

actuals:
  tokens: 11016
  tasks: 2
  commits: 4
plan_head_before: 57792644a9098cfd9a244ca36c67cc6ca3243a3a
plan_head_after: a74b5d3714c305bfe08ed3a75c88af33637762ea

tech-stack:
  added: []
  patterns:
    - "Lock holders write snapshots with insert_snapshot(conn, cache) on their own transaction; SnapshotRecorder (lock-taking) serves only lifespan and the 30 s loop"
    - "Post-commit reconcile via tracker.reconcile_quietly(context): log, never fail a committed change"
    - "Service tests wrap every await in asyncio.wait_for(timeout=5) so lock re-entry fails instead of hanging"

key-files:
  created:
    - backend/tests/test_trading.py
    - backend/tests/test_money.py
    - backend/tests/test_valuation.py
  modified:
    - backend/app/snapshots.py
    - backend/app/tracker.py
    - backend/app/watchlist.py
    - backend/app/trading.py
    - backend/tests/conftest.py
    - backend/tests/test_snapshots.py

key-decisions:
  - "OQ-1 adopted: a buy whose cost rounds below $0.01 is rejected; sells of any positive quantity are allowed so a tiny remainder can always be closed"
  - "Quantity is validated before the lock and before the price lookup, so an unpriced ticker with a NaN quantity reports the quantity error"
  - "Non-numeric quantity (TypeError/ValueError from float()) maps to 'Quantity must be a positive number.' so the Phase 3 AI path cannot raise a 500"

patterns-established:
  - "Rejected-trade helper: snapshot cash, positions, trades and snapshots plus source calls before the call; assert identical after the DomainError"

requirements-completed: [TRD-01, TRD-02, TRD-03, TRD-04, TRD-05, TRD-06, WL-06, PF-01, PF-02]

coverage:
  - id: D1
    description: "Every fill writes exactly one portfolio snapshot inside the trade transaction, valued by value_portfolio; same-second fills keep separate rows; a rejected trade adds none"
    requirement: PF-02
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestSnapshot"
        status: pass
      - kind: unit
        ref: "backend/tests/test_snapshots.py#TestInsertSnapshot"
        status: pass
    human_judgment: false
  - id: D2
    description: "Tracked tickers follow watchlist ∪ positions across buys, sells and watchlist removals; a failing source call after a sell is logged and the fill still returns"
    requirement: WL-06
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestTracked"
        status: pass
      - kind: unit
        ref: "backend/tests/test_watchlist.py#TestReconcileFailure"
        status: pass
    human_judgment: false
  - id: D3
    description: "NaN, Infinity, 1e400, zero, negative and sub-0.0001 quantities, bad side, malformed ticker and unpriced ticker return the fixed DomainError messages in ticker/side/quantity/price order"
    requirement: TRD-01
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestValidation"
        status: pass
    human_judgment: false
  - id: D4
    description: "Buy and sell rules: cash boundary, buy max, avg cost stored full and served at 4 dp, $0.01 minimum buy, half-cent debit, sell tolerance, dust delete, loss sale, never-held sell"
    requirement: TRD-02
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestBuy"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestSell"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cent-exact money: 100 buys of 0.1 @ 33.33 leave cash 9667.0 and quantity 10.0; half-up Decimal helpers"
    requirement: TRD-04
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestRounding"
        status: pass
      - kind: unit
        ref: "backend/tests/test_money.py"
        status: pass
    human_judgment: false
  - id: D6
    description: "Rejected trades change no table and make no source call; each fill adds exactly one trades row and one snapshot"
    requirement: TRD-05
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestAtomicity"
        status: pass
    human_judgment: false
  - id: D7
    description: "20 concurrent buys of 1 AAPL at $600.00 give 16 fills, 4 insufficient-cash errors, cash 400.0, 16 trades and 16 snapshots within 5 s"
    requirement: TRD-06
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestConcurrency::test_concurrent_buys_never_overspend"
        status: pass
    human_judgment: false
  - id: D8
    description: "value_portfolio edges and the half-cent parity table shared with plan 02-03's portfolio.test.ts"
    requirement: PF-01
    verification:
      - kind: unit
        ref: "backend/tests/test_valuation.py"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 02: Trade Rules, Snapshots and Tracked Tickers Summary

**Each fill now writes its portfolio snapshot inside the same BEGIN IMMEDIATE transaction as cash, position and trade row. Tracked tickers are reconciled after commit while the state lock is still held. A service-level input gate rejects NaN, Infinity, non-positive, sub-0.0001 and sub-cent buy orders before any SQL runs. 128 new tests cover the PLAN §7 rules, including the 20-way parallel-buy race and the half-cent P&L parity table.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-10-28T14:11:33Z
- **Completed:** 2026-10-28T14:17:48Z
- **Tasks:** 2 (both TDD: RED and GREEN commits)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments
- `insert_snapshot(conn, cache)` values the portfolio through `value_portfolio` on the caller's open connection. `TradeService._trade_tx` calls it after the trades insert, so the snapshot commits or rolls back with the trade. `SnapshotRecorder._record_tx` is now a one-line wrapper around it.
- `portfolio_value` returns `value_portfolio(...)["total_value"]`. Snapshots and `GET /api/portfolio` therefore use the same half-up cents. The old float `round` stored 0.12 for a 0.125 notional.
- `TickerTracker.reconcile_quietly(context)` replaces `WatchlistService._reconcile`. `TradeService.execute` calls it between `_trade_tx` and `view_sync`, still under the lock. Buying an unwatched ticker starts tracking it, and selling one to zero stops tracking it.
- The input gate in `execute` runs `float()`, then `math.isfinite` and `> 0`, then `round4` and `> 0`. `MIN_ORDER_VALUE = 0.01` applies to buys only.

## Task Commits

1. **Task 1 RED: failing snapshot and tracked-ticker tests** - `62ad462` (test)
2. **Task 1 GREEN: in-transaction snapshot and post-commit reconcile** - `2a929d3` (feat)
3. **Task 2 RED: failing input-gate and trade-rule tests** - `320cf42` (test)
4. **Task 2 GREEN: quantity gate and minimum order value** - `a74b5d3` (feat)

No REFACTOR commits were needed.

## Files Created/Modified
- `backend/app/snapshots.py` - `insert_snapshot`; `portfolio_value` delegates to `value_portfolio`; the docstring explains the lock split (Pitfall 1)
- `backend/app/tracker.py` - `reconcile_quietly(context)`
- `backend/app/watchlist.py` - `_reconcile` removed; add and remove call `reconcile_quietly`
- `backend/app/trading.py` - snapshot inside `_trade_tx`, reconcile after commit, `_valid_quantity` gate, `MIN_ORDER_VALUE`
- `backend/tests/conftest.py` - `TradeEnv` dataclass and the async `trade_env` fixture
- `backend/tests/test_trading.py` - TestSnapshot, TestTracked, TestValidation, TestBuy, TestSell, TestRounding, TestAtomicity, TestConcurrency
- `backend/tests/test_money.py` - half-up helper cases
- `backend/tests/test_valuation.py` - empty, uncached, precision and parity-table cases
- `backend/tests/test_snapshots.py` - TestInsertSnapshot

## TDD Gate Compliance

- **Task 1 RED (`62ad462`):** 11 target tests failed. TestSnapshot and TestTracked failed on their planned assertions (no snapshot rows, PYPL never added or removed, no reconcile-failure log). The `insert_snapshot` cases failed with `AttributeError` on the missing function. The test module accesses it as a module attribute, so collection still succeeded and only the target tests failed. The parity case failed on `assert 0.12 == 0.13`. Semantic assessment: valid RED. Every failure was a target test, and none was caused by a collection or fixture error.
- **Task 1 GREEN (`2a929d3`):** all target tests pass. The existing TestReconcileFailure tests pass unchanged.
- **Task 2 RED (`320cf42`):** 12 target tests failed: the quantity gate (NaN produced a `NOT NULL constraint failed: positions.quantity` IntegrityError instead of a DomainError, and zero or negative quantities filled or hit other rules), the check-order test, the sub-cent buy and the atomicity sweep. Semantic assessment: valid RED for the gate. The pytest console output is not in a format `tdd-red-evidence` can classify, so the classifier was not run and this assessment comes from inspecting the output.
- **Characterization tests:** test_money.py, test_valuation.py and the TestBuy, TestSell, TestRounding and TestConcurrency tests passed at RED. They pin behavior that 02-01 already implemented correctly. Task 2 step 3 says to change `money.py` or `valuation.py` only when a test exposes a defect, and none did, so neither file changed.
- **Task 2 GREEN (`a74b5d3`):** 151 targeted tests pass; full suite 348 passed, 1 skipped.

## Decisions Made
- OQ-1 was adopted as planned: buys have a minimum value of $0.01, and sells have no minimum.
- The quantity gate runs before the lock and before the price lookup, which follows the planned check order (ticker, side, quantity, price, cash or shares).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Non-numeric quantity maps to a DomainError**
- **Found during:** Task 2 GREEN
- **Issue:** `float(quantity)` raises `TypeError` or `ValueError` for `None` or non-numeric text. The REST route never sends those because Pydantic gives a 422 first, but the Phase 3 AI executor calls `execute` directly and would get a 500.
- **Fix:** `_valid_quantity` catches those errors and raises "Quantity must be a positive number.".
- **Files modified:** backend/app/trading.py
- **Committed in:** a74b5d3

---

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** Hardening only. No contract or scope change.

## Issues Encountered
- `ruff format` rewrapped a few test lines. Formatting was run before each commit.

## Verification Results
- `pytest -q tests/test_trading.py -k "snapshot or tracked"`: 10 passed
- `pytest -q tests/test_snapshots.py tests/test_watchlist.py tests/test_tracker.py tests/test_portfolio_api.py`: 77 passed
- `pytest -q tests/test_money.py tests/test_valuation.py tests/test_trading.py tests/test_snapshots.py tests/test_watchlist.py tests/test_tracker.py`: 151 passed
- VALIDATION `-k` filter (validation, price, buy, sell, round, concurrent, atomic, snapshot, tracked): 46 passed
- Full backend suite: 348 passed, 1 skipped (the existing `test_main.py:255` skip, which needs a `frontend/out` build)
- `ruff check app tests` clean; `ruff format --check app tests` clean (46 files)
- Grep gates: `insert_snapshot(conn` and `reconcile_quietly(` appear in trading.py, `reconcile_quietly(` appears in watchlist.py, `math.isfinite` appears in trading.py, and no app module other than tracker.py and app/market calls `source.add_ticker` or `source.remove_ticker`
- `git diff --quiet 245a40c -- backend/pyproject.toml backend/uv.lock` exits 0: dependencies are unchanged

## Known Stubs
None.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness
- Reset (02-06) should call `insert_snapshot(conn, cache)` inside its own transaction and `tracker.reconcile_quietly("reset")` after commit, under the state lock.
- Phase 3's AI executor can call `TradeService.execute` per action and catch `DomainError`. Every invalid input, including non-numeric quantities, comes back as a DomainError.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*
