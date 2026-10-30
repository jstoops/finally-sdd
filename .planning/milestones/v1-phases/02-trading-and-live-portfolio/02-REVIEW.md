---
phase: 02-trading-and-live-portfolio
reviewed: 2026-10-28T00:00:00Z
depth: standard
files_reviewed: 43
files_reviewed_list:
  - backend/app/api/__init__.py
  - backend/app/api/portfolio.py
  - backend/app/main.py
  - backend/app/money.py
  - backend/app/portfolio.py
  - backend/app/snapshots.py
  - backend/app/tracker.py
  - backend/app/trading.py
  - backend/app/valuation.py
  - backend/app/watchlist.py
  - backend/tests/conftest.py
  - backend/tests/test_money.py
  - backend/tests/test_portfolio_api.py
  - backend/tests/test_reset.py
  - backend/tests/test_snapshots.py
  - backend/tests/test_trading.py
  - backend/tests/test_valuation.py
  - frontend/src/api/types.ts
  - frontend/src/components/header.test.tsx
  - frontend/src/components/Header.tsx
  - frontend/src/components/Heatmap.test.tsx
  - frontend/src/components/Heatmap.tsx
  - frontend/src/components/PnlChart.test.tsx
  - frontend/src/components/PnlChart.tsx
  - frontend/src/components/PositionsTable.test.tsx
  - frontend/src/components/PositionsTable.tsx
  - frontend/src/components/terminal.test.tsx
  - frontend/src/components/Terminal.tsx
  - frontend/src/components/TradeBar.test.tsx
  - frontend/src/components/TradeBar.tsx
  - frontend/src/components/TradeHistory.test.tsx
  - frontend/src/components/TradeHistory.tsx
  - frontend/src/domain/market.test.ts
  - frontend/src/domain/market.ts
  - frontend/src/domain/pnl.test.ts
  - frontend/src/domain/pnl.ts
  - frontend/src/domain/portfolio.test.ts
  - frontend/src/domain/portfolio.ts
  - frontend/src/domain/treemap.test.ts
  - frontend/src/domain/treemap.ts
  - frontend/src/store/portfolio.ts
  - frontend/src/store/watchlist.ts
  - frontend/src/test/stubFetch.ts
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-10-28
**Depth:** standard
**Files Reviewed:** 43
**Status:** issues_found

## Summary

I reviewed the Phase 2 trading and live-portfolio slice. On the backend that means the trade path, valuation, money rounding, snapshots, reset, tracker reconcile, watchlist service and app wiring. On the frontend it means the portfolio store, the header, heatmap, P&L chart, positions table, trade bar, trade history and the pure domain helpers. I also read the supporting modules the reviewed files call (`app/db`, `app/errors.py`, `app/tickers.py`, `frontend/src/api/client.ts`, `frontend/src/store/prices.ts`, `frontend/src/domain/chart.ts`) so I could trace behavior across those calls.

Baseline: `pytest` passes (365 tests), `ruff check` is clean, and `vitest` passes (254 tests). The locking design (one `asyncio.Lock`, snapshots written on the trade's own transaction, tracker reconcile after commit) is sound. I found no deadlocks or lock-ordering problems.

I confirmed every defect below by running it against the real code:

- A huge finite quantity crashes the trade path with an unhandled `decimal.InvalidOperation`. It returns 500 instead of the 400 that PLAN §8 requires. It also breaks `TradeService.execute`'s documented "raises DomainError" contract, which the Phase 3 AI executor will depend on.
- Buy cost rounding favors the buyer on tiny orders. A buy of 0.0001 shares at $149.99 costs $0.01 against a true value of $0.015. Selling a tiny quantity can also give up shares for $0.00.
- Reset does not clear the sparklines, which PLAN §10 requires.
- JSON `true` is accepted as a quantity of 1 share.
- A failed portfolio load is never shown to the user, so the panels show "No positions" empty states for an account that may hold positions.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: A huge finite quantity raises `decimal.InvalidOperation` and returns 500 instead of 400

**File:** `backend/app/trading.py:119-128` (via `backend/app/money.py:25-27`)
**Issue:** `_valid_quantity` rejects NaN, infinity, zero and negatives, then calls `round4(value)`. `round4` runs `Decimal(str(value)).quantize(Decimal("0.0001"))`. The default decimal context has 28 digits of precision, so `quantize` raises `decimal.InvalidOperation` for any value of about 1e24 or more. That exception is not a `DomainError`, so it escapes to Starlette as an unhandled 500. I verified this with a running app:

```
POST /api/portfolio/trade {"ticker":"AAPL","quantity":1e24,"side":"buy"}  -> 500 Internal Server Error
POST /api/portfolio/trade {"ticker":"AAPL","quantity":1e30,"side":"sell"} -> 500 Internal Server Error
```

PLAN §8 requires a bad quantity to return `400 {"error": ...}`. The trade bar's `QTY_RE` (`TradeBar.tsx:267`) accepts any digit string, so a user can type such a value and sees "Request failed (500)". It is also more serious than a wrong status code. The `TradeService.execute` docstring promises that rule failures raise `DomainError`, and the Phase 3 chat executor will catch `DomainError` for each action so that "a failure doesn't stop the remaining actions" (PLAN §9). If an LLM asks for an absurd quantity, the `InvalidOperation` would escape that per-action handler and abort the whole chat request after earlier actions have already committed. The executed actions would then not be recorded in `chat_messages`. The test matrix at `test_trading.py:200` covers `1e400` (which is infinity) but no large finite value.
**Fix:** Cap the quantity before any Decimal work, and catch the decimal error as a backstop:

```python
MAX_QUANTITY = 1_000_000_000  # far above anything $10k can buy; keeps Decimal within precision

@staticmethod
def _valid_quantity(quantity: float) -> float:
    try:
        value = float(quantity)
    except (TypeError, ValueError):
        raise DomainError("Quantity must be a positive number.") from None
    if not math.isfinite(value) or value <= 0:
        raise DomainError("Quantity must be a positive number.")
    if value > MAX_QUANTITY:
        raise DomainError(f"Quantity must be at most {MAX_QUANTITY:,}.")
    qty = round4(value)
    ...
```

Add `1e24` and `1e30` cases (for both buy and sell) to the rejection matrix in `test_trading.py`.

## Warnings

### WR-01: Half-up cost rounding lets tiny buys underpay, and tiny sells can give shares away for $0.00

**File:** `backend/app/trading.py:147-157` and `backend/app/trading.py:176`
**Issue:** A buy charges `notional(qty, price)`, which is `qty × price` rounded half-up to cents. The user still receives exactly `qty` shares, so any notional whose fractional cent is below 0.5 is undercharged. I verified this against `app.money`:

```
notional(0.0001, 149.99) -> 0.01   (true value 0.014999; 33% discount)
notional(0.0004, 137.49) -> 0.05   (true value 0.054996)
notional(0.0001, 44.00)  -> 0.00   (a sell of 0.0001 @ $44 removes shares for $0.00)
```

Repeated tiny buys of a ticker priced near $149.99 build up shares at roughly two-thirds of market value. A later large sell, which is priced exactly, turns the gap into a profit. That conflicts with the project's core value that "every number (cash, positions, P&L) stays correct". The AI copilot in Phase 3 makes it easy to fire off many small orders. In the other direction, `MIN_ORDER_VALUE` guards only buys, so a sell whose notional rounds to $0.00 is recorded and removes shares for nothing.
**Fix:** Round in the house's favor at the fill boundary, and reject zero-proceeds partial sells:

```python
# money.py
def buy_cost(quantity: float, price: float) -> float:
    return float((_dec(quantity) * _dec(price)).quantize(_CENT, rounding=ROUND_CEILING))

def sell_proceeds(quantity: float, price: float) -> float:
    return float((_dec(quantity) * _dec(price)).quantize(_CENT, rounding=ROUND_FLOOR))
```

In `_trade_tx`, use `buy_cost` for buys. For sells, raise `DomainError("Order value must be at least $0.01.")` when `sell_proceeds(filled, price) < MIN_ORDER_VALUE` and the sell does not close the position. Leave the valuation code (`value_portfolio`) on half-up, since it values positions and does not charge anyone.

### WR-02: Reset does not clear the sparklines (PLAN §10)

**File:** `frontend/src/components/Header.tsx:186-188`, `frontend/src/store/prices.ts:26-51`
**Issue:** PLAN §10 Data Flow says: "After a reset, re-fetch everything and clear the chat panel and sparklines." After a successful reset, `ResetButton.onClick` calls `usePortfolio.reset()` (which refetches portfolio, trades and history) and `loadWatchlist()`. The prices store has no action that clears `spark` or `lastTs`. `ingestFrame` carries forward each surviving ticker's buffer (`s.spark[ticker] ?? []`), so all ten default tickers keep their pre-reset sparkline history. Only tickers dropped from the frame lose theirs. No test in `header.test.tsx` checks sparkline state after a reset.
**Fix:** Add a clearing action to the prices store and call it after a successful reset:

```ts
// store/prices.ts
clearSparks: () => set({ spark: {}, lastTs: {} }),

// Header.tsx ResetButton.onClick
if (err === null) {
  usePrices.getState().clearSparks();
  void useWatchlist.getState().loadWatchlist();
}
```

Add a header test that seeds `spark`, resets, and asserts the store is empty.

### WR-03: `TradeRequest.quantity` accepts JSON `true` as 1 share

**File:** `backend/app/api/portfolio.py:12-20`
**Issue:** `quantity: float` uses Pydantic's lax mode, which coerces booleans and numeric strings. I verified that `POST /api/portfolio/trade {"ticker":"AAPL","quantity":true,"side":"buy"}` returns 200 and buys 1.0 share. PLAN §8 says a wrong-type field is a malformed body and should get FastAPI's default 422. An agent that sends a boolean by mistake (Phase 3 tool output, a test harness, a script) executes a real trade instead of getting an error. `"10"` as a string is also silently accepted.
**Fix:** Make the field strict so that only JSON numbers parse (a strict float still accepts ints):

```python
from pydantic import BaseModel, StrictFloat

class TradeRequest(BaseModel):
    ticker: str
    quantity: StrictFloat
    side: str
```

Add API tests asserting that `true` and `"10"` return 422.

### WR-04: Portfolio load failures are never shown, so panels show "no positions" for an account that may hold positions

**File:** `frontend/src/store/portfolio.ts:522-538`, `frontend/src/components/PositionsTable.tsx:314-361`, `frontend/src/components/Heatmap.tsx:47-111`, `frontend/src/components/Header.tsx:217-236`
**Issue:** `loadPortfolio` sets `loadError` and `loaded`, but no component reads either field. The search for `loadError` and `loaded` across `components/*.tsx` finds them only in `Watchlist.tsx` and `ChartPanel.tsx`. So:
- Before the first load, and after any failed load, `PositionsTable` renders "No positions yet" and `Heatmap` renders "No positions — buy something or ask FinAlly", because `positions` is `[]`. A user with real holdings sees a confident empty state instead of a loading or error message.
- After a successful `POST /api/reset` whose follow-up `refresh()` fails (`store/portfolio.ts:563-571`), `reset()` still resolves `null`. The header then shows no error, and the panels keep showing the pre-reset positions, cash and trades until a stream reconnect triggers another refresh.
**Fix:** Have the positions table and heatmap show the load state, for example:

```tsx
const loaded = usePortfolio((s) => s.loaded);
const loadError = usePortfolio((s) => s.loadError);
...
{loadError && <p role="alert" className="... text-down">{loadError}</p>}
{loaded && !loadError && rows.length === 0 && <p data-testid="positions-empty">No positions yet</p>}
```

Also have `reset()` return an error message (for example "Reset done, but reloading failed. Refresh the page.") when `loadError` is set after `refresh()`.

## Info

### IN-01: A failure after the commit turns a filled trade into a 500, and the user may retry

**File:** `backend/app/trading.py:101-108`
**Issue:** The trade commits inside `_trade_tx`, and `reconcile_quietly` swallows its own errors. But `self._portfolio.view_sync` (line 106) runs after the commit with no handling. A `sqlite3.OperationalError` there (busy past the 5 s timeout, disk I/O) returns 500 for a trade that already filled. The trade bar then shows an error, and a user who retries buys twice.
**Fix:** Wrap the post-commit view and, on failure, log it and still return the trade, either with a portfolio built from a retry or with an explicit flag that tells the client to refetch. Do not let the 500 hide a committed fill.

### IN-02: `view_sync`'s `finally: COMMIT` can mask the real error

**File:** `backend/app/portfolio.py:50-64`
**Issue:** If a SELECT inside the read transaction fails in a way that ends the transaction, the unconditional `conn.execute("COMMIT")` in `finally` raises "cannot commit - no transaction is active" and replaces the original exception. `Database.transaction()` already guards against this with `if conn.in_transaction`.
**Fix:** `finally: if conn.in_transaction: conn.execute("COMMIT")`

### IN-03: Live valuation is recomputed three times per SSE frame in separate components

**File:** `frontend/src/components/Header.tsx:220-223`, `frontend/src/components/Heatmap.tsx:47-50`, `frontend/src/components/PositionsTable.tsx:314-317`
**Issue:** Each component calls `livePortfolio(cash ?? 0, positions, ticks)` with its own `useMemo`. The logic is duplicated, and the Header passes `cash` while the other two pass `cash ?? 0`, so a future change to one call site can make the panels disagree.
**Fix:** Add one shared hook, `useLivePortfolio()`, in `store/portfolio.ts` (or a `hooks/` module) that returns the memoized `LivePortfolio | null`, and use it in all three components.

### IN-04: Snapshot-loop tests depend on wall-clock timing

**File:** `backend/tests/test_snapshots.py:169-189`
**Issue:** `test_records_every_interval` and `test_failure_is_logged_and_loop_continues` use real `asyncio.sleep(0.2)` or `sleep(0.15)` with a 0.01 s interval and assert a minimum count of iterations. On a loaded CI runner (thread-pool contention for `to_thread`, or Windows' about 15.6 ms timer granularity) these can flake.
**Fix:** Inject the sleep function into `run_snapshot_loop` (for example `sleep: Callable[[float], Awaitable[None]] = asyncio.sleep`), drive it with an `asyncio.Event`-based fake in tests, and assert exact iteration counts.

---

_Reviewed: 2026-10-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
