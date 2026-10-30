---
phase: 02-trading-and-live-portfolio
plan: 07
subsystem: api
tags: [fastapi, pydantic, decimal, trading, validation, vitest]

requires:
  - phase: 02-trading-and-live-portfolio
    provides: "TradeService.execute and _valid_quantity (02-02), money helpers (02-01), TradeBar (02-06)"
provides:
  - "MAX_QUANTITY = 1_000_000_000 cap and QUANTITY_TOO_LARGE message in app.trading, checked on the raw value before any Decimal work"
  - "OverflowError (int beyond float range) and decimal.InvalidOperation (round4) converted to DomainError in _valid_quantity"
  - "Service type gate: bool and non-number quantities raise DomainError before float()"
  - "TradeRequest.quantity: StrictFloat (JSON true/false/strings/null are 422)"
  - "money.py module docstring: the Decimal precision range and who bounds the inputs"
affects: [03-ai-chat-executor, 02-verification, 02-security]

actuals:
  tokens: 3900
  tasks: 3
  commits: 5
plan_head_before: 20773c78ebf2d6efa286b81bfb443519cb2adc47
plan_head_after: a547264595f87f363e7f0287e8587f7c0573f791

tech-stack:
  added: []
  patterns:
    - "Range-cap user-controlled numbers before Decimal quantize; pure money helpers stay range-agnostic"
    - "Strict Pydantic types on request numbers (StrictFloat) plus a matching service-level type gate for direct callers"

key-files:
  created: []
  modified:
    - backend/app/trading.py
    - backend/app/money.py
    - backend/app/api/portfolio.py
    - backend/tests/test_trading.py
    - backend/tests/test_money.py
    - backend/tests/test_portfolio_api.py
    - frontend/src/components/TradeBar.test.tsx

key-decisions:
  - "Quantity cap MAX_QUANTITY = 1,000,000,000, compared on the raw float before round4; oversized orders are rejected, never clamped (G-1, G-2)"
  - "decimal.InvalidOperation from round4 is reported as the cap message; OverflowError from float() is reported as 'Quantity must be a positive number.'"
  - "TradeRequest.quantity is StrictFloat, reversing the 02-02 lax-mode choice (G-4, G-5); the service also rejects bool and non-number quantities for the Phase 3 executor"

patterns-established:
  - "Quantity gate order: type, float conversion, finite and positive, cap, round4, 0.0001 minimum; all before the state lock"

requirements-completed: [TRD-01, TRD-06]

coverage:
  - id: D1
    description: "POST /api/portfolio/trade with 1e24 buy, 10**24 buy or 1e30 sell returns 400 with the cap message and changes nothing"
    requirement: TRD-06
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_huge_quantity_is_400_and_changes_nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "A 25-digit quantity typed in the trade bar is sent as a JSON number and the server's 400 cap message renders inline as an alert"
    requirement: TRD-06
    verification:
      - kind: automated_ui
        ref: "frontend/src/components/TradeBar.test.tsx#sends a 25-digit quantity as a JSON number and shows the server's 400 cap message inline"
        status: pass
    human_judgment: false
  - id: D3
    description: "TradeService.execute raises only DomainError for oversized or overflowing quantities, including at the cap boundary"
    requirement: TRD-01
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestValidation::test_above_max_quantity_is_rejected"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestValidation::test_at_max_quantity_reaches_the_cash_and_share_rules"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestValidation::test_int_overflow_is_a_domain_error"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestValidation::test_decimal_overflow_is_a_domain_error"
        status: pass
      - kind: unit
        ref: "backend/tests/test_money.py#TestRound4::test_max_quantity_stays_in_decimal_range"
        status: pass
    human_judgment: false
  - id: D4
    description: "The quantity gate runs before the state lock; parallel oversized and valid buys leave exactly 5 fills"
    requirement: TRD-06
    verification:
      - kind: unit
        ref: "backend/tests/test_trading.py#TestConcurrency::test_oversized_quantity_is_rejected_without_taking_the_lock"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestConcurrency::test_oversized_orders_in_parallel_leave_valid_fills_exact"
        status: pass
    human_judgment: false
  - id: D5
    description: "Wrong-typed quantity: 422 at the route (true, false, \"10\", \"1e24\"), DomainError in the service (True, False, \"10\", None)"
    requirement: TRD-06
    verification:
      - kind: integration
        ref: "backend/tests/test_portfolio_api.py#TestTradeTracer::test_wrong_typed_quantity_is_422_and_changes_nothing"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestValidation::test_wrong_typed_quantity_is_rejected"
        status: pass
      - kind: unit
        ref: "backend/tests/test_trading.py#TestAtomicity::test_every_rejection_changes_nothing"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-10-28
status: complete
---

# Phase 2 Plan 07: Quantity Cap and Strict Quantity Typing Summary

**Trade quantities are capped at 1,000,000,000 on the raw value before any Decimal work. Int and Decimal overflow become DomainError, and `StrictFloat` plus a service type gate stop boolean and text quantities from filling. This closes gaps CR-01 (500 on a huge quantity) and WR-03 (`true` buying 1 share).**

## Performance

- **Duration:** about 25 min
- **Completed:** 2026-10-28
- **Tasks:** 3 of 3
- **Files modified:** 7

## Accomplishments
- An absurd quantity (1e24, 10**24, 1e30) now returns 400 "Quantity must be at most 1,000,000,000." instead of a 500, and the trade bar shows that message inline.
- `TradeService.execute` raises only `DomainError` for every rejected quantity: above the cap, 9e23 (which round4 accepts but which would overflow `notional` inside the transaction), 10**400, and a lifted cap (InvalidOperation backstop). This keeps the Phase 3 per-action executor contract intact.
- The gate runs before the shared lock. An oversized order fails within 1 s while another holder keeps the lock, and parallel oversized and valid buys leave exactly 5 fills with cash at 9500.0.
- JSON `true`, `false`, `"10"` and `"1e24"` are a 422 that changes nothing. Integer quantities still fill (200). The service rejects True, False, "10" and None directly.

## Task Commits

1. **Task 1 (tracer): cap a huge quantity end to end** - `c1472f7` (fix)
2. **Task 2: overflow backstops, boundary and concurrency** - RED `1c93670` (test), GREEN `14e7933` (feat)
3. **Task 3: strict quantity typing** - RED `002f726` (test), GREEN `a547264` (feat)

## TDD Notes

- **Task 1 RED:** before the cap was added, the new route test failed in all 3 cases with `decimal.InvalidOperation` raised from `round4` via `_valid_quantity`. The route test and the cap went into one tracer commit, as the plan specified (type="tracer").
- **Task 2 RED:** of 12 selected tests, exactly the 2 targets failed for the planned reasons: `test_int_overflow_is_a_domain_error` (OverflowError: int too large to convert to float) and `test_decimal_overflow_is_a_domain_error` (decimal.InvalidOperation). The other new cases pin Task 1's behavior and passed, as the plan anticipated. Semantic assessment: valid RED, the target assertions failed on the intended exceptions. GREEN: 12 of 12 passed.
- **Task 3 RED:** the 4 route cases returned non-422 responses. At the service, `[true]` and `[numeric-string]` filled trades and `TestAtomicity` failed on the True case. The `[false]` and `[none]` service cases already raised POSITIVE, as the plan's behavior notes predicted. Semantic assessment: valid RED. GREEN: 8 of 8 `wrong_typed` tests passed.
- No REFACTOR commits were needed.

## Files Created/Modified
- `backend/app/trading.py` - `MAX_QUANTITY`, `QUANTITY_TOO_LARGE`, and in `_valid_quantity`: the type gate, the OverflowError catch, the cap, and the InvalidOperation backstop. Docstrings updated.
- `backend/app/money.py` - module docstring only: the precision range note.
- `backend/app/api/portfolio.py` - `quantity: StrictFloat` and an explanatory docstring.
- `backend/tests/test_trading.py` - `TOO_LARGE`, above-max, at-max, overflow and wrong-type tests, extra atomicity cases, and 2 concurrency tests.
- `backend/tests/test_money.py` - `test_max_quantity_stays_in_decimal_range`.
- `backend/tests/test_portfolio_api.py` - the huge-quantity 400 test and the wrong-typed 422 test.
- `frontend/src/components/TradeBar.test.tsx` - the 25-digit quantity case with the inline cap message. `TradeBar.tsx` is unchanged.

## Decisions Made
Followed the plan's G-1 to G-6 decisions as written. One detail: the type gate uses `isinstance(quantity, bool) or not isinstance(quantity, (int, float))`, so numpy and other non-builtin numerics are also rejected. Every current caller passes a builtin int or float.

## Deviations from Plan

None. The plan was executed as written.

Environment note: the worktree had no `frontend/node_modules`, so `npm ci` restored the lockfile-pinned dependencies before the Vitest runs. No package was added, and `git diff --quiet 245a40c -- backend/pyproject.toml backend/uv.lock frontend/package.json frontend/package-lock.json` is clean.

## Verification
- `uv run --directory backend --extra dev pytest -q`: 387 passed, 1 skipped. The skip is the existing `test_main.py:255` "frontend/out not built" case.
- `ruff check app tests`: all checks passed. `ruff format --check app tests`: 47 files already formatted.
- `npm --prefix frontend test -- src/components/TradeBar.test.tsx src/components/terminal.test.tsx`: 71 passed. `npm --prefix frontend run lint` is clean.
- `git diff --quiet b811769 -- frontend/src/components/TradeBar.tsx` exits 0.
- The probes from 02-VERIFICATION now behave as required: `{AAPL, 1e24, buy}` and `{AAPL, 1e30, sell}` return 400 with the cap message, and `{AAPL, true, buy}` returns 422.

## Issues Encountered
None.

## User Setup Required
None. No external service configuration is required.

## Next Phase Readiness
- CR-01 and WR-03 are closed. Orchestrator follow-ups: re-run phase verification, re-run `/gsd-secure-phase 02` to record T-02-18, T-02-19 and T-02-20 (T-02-18 extends T-02-01), and mark CR-01 and WR-03 fixed in 02-REVIEW-DISPOSITION.md.
- Phase 3's AI executor can rely on `TradeService.execute` raising only `DomainError` for rule failures.

## Self-Check: PASSED
- All 7 modified files exist, and all 5 commits (c1472f7, 1c93670, 14e7933, 002f726, a547264) are ancestors of HEAD.

---
*Phase: 02-trading-and-live-portfolio*
*Completed: 2026-10-28*
