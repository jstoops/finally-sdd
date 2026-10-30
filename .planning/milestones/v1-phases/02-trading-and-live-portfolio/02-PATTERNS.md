# Phase 2: Trading and Live Portfolio - Pattern Map

**Mapped:** 2026-10-27
**Files analyzed:** 40 (new + modified, backend + frontend + tests)
**Analogs found:** 37 / 40 (all paths below verified with `git ls-files`)

## File Classification

### Backend

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `backend/app/money.py` (NEW) | utility (pure) | transform | `backend/app/tickers.py` (pure helper module) | partial |
| `backend/app/valuation.py` (NEW) | utility (pure) | transform | `backend/app/snapshots.py::portfolio_value` (lines 22-35) | exact (supersedes it) |
| `backend/app/trading.py` (NEW, `TradeService`, `Trade`/`TradeResult`) | service | CRUD (lock + txn) | `backend/app/watchlist.py` (`WatchlistService`) | exact |
| `backend/app/portfolio.py` (NEW, `PortfolioService`: view, history, trades, reset) | service | CRUD | `backend/app/watchlist.py` + `snapshots.py::_record_tx` | exact |
| `backend/app/snapshots.py` (EDIT: extract `insert_snapshot(conn, cache)`; `portfolio_value` delegates to valuation) | service | CRUD | itself, lines 54-72 | self |
| `backend/app/tracker.py` (EDIT: add `reconcile_quietly(context)`) | service | event-driven | `backend/app/watchlist.py::_reconcile` lines 81-90 | exact (move) |
| `backend/app/watchlist.py` (EDIT: use `tracker.reconcile_quietly`) | service | CRUD | itself | self |
| `backend/app/api/portfolio.py` (NEW, `create_portfolio_router`) | route | request-response | `backend/app/api/watchlist.py` | exact |
| `backend/app/api/__init__.py` (EDIT) | config | — | itself | self |
| `backend/app/main.py` (EDIT: wire services with same `state_lock`, include router before `install_api_not_found`) | config | — | itself lines 53-57, 99-103 | self |
| `backend/tests/conftest.py` (EDIT: `trade_env` fixture, price seed helper) | test fixture | — | itself (`RecordingSource`, `make_app`) | self |
| `backend/tests/test_money.py`, `test_valuation.py` (NEW) | test | unit | `backend/tests/test_snapshots.py` (`TestPortfolioValue`) | role-match |
| `backend/tests/test_trading.py`, `test_reset.py` (NEW) | test | async service | `backend/tests/test_watchlist.py` (service + concurrency) | exact |
| `backend/tests/test_portfolio_api.py` (NEW) | test | integration | `backend/tests/test_watchlist.py` (TestClient sections) | exact |
| `backend/tests/test_tracker.py`, `test_snapshots.py` (EXTEND) | test | — | themselves | self |

### Frontend

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `frontend/src/api/types.ts` (EDIT) | model (types) | — | itself (`WatchlistEntry`, `HistoryResponse`) | self |
| `frontend/src/domain/portfolio.ts` (NEW: `livePortfolio`, `pnlColor`, `formatQty`, `STARTING_CASH`) | utility (pure) | transform | `frontend/src/domain/market.ts` | exact |
| `frontend/src/domain/treemap.ts` (NEW: `squarify`) | utility (pure) | transform | `frontend/src/domain/market.ts::sparkPoints` | role-match |
| `frontend/src/domain/pnl.ts` (NEW: `toSnapshotSeries`) | utility (pure) | transform | `frontend/src/domain/chart.ts::toSeriesData` | exact |
| `frontend/src/domain/market.ts` (EDIT: `nextSelection` valid set = watchlist ∪ held) | utility | transform | itself line 70-73 | self |
| `frontend/src/store/portfolio.ts` (NEW `usePortfolio`) | store | request-response | `frontend/src/store/watchlist.ts` | exact |
| `frontend/src/components/TradeBar.tsx` (NEW) | component (form) | request-response | `frontend/src/components/Watchlist.tsx` (add form + inline error slot) | exact |
| `frontend/src/components/PositionsTable.tsx` (NEW) | component | streaming (SSE-derived) | `frontend/src/components/Watchlist.tsx` (`WatchlistRow`) | exact |
| `frontend/src/components/Heatmap.tsx` (NEW) | component | streaming | `Watchlist.tsx` (store selectors) + `ChartPanel.tsx` (effect-only browser APIs) | partial |
| `frontend/src/components/PnlChart.tsx` (NEW) | component (chart) | request-response + timer | `frontend/src/components/ChartPanel.tsx` | exact |
| `frontend/src/components/TradeHistory.tsx` (NEW) | component (list) | request-response | `frontend/src/components/Watchlist.tsx` | role-match |
| `frontend/src/components/Header.tsx` (EDIT: total, cash, P&L since start, Reset) | component | streaming | itself + `Watchlist.tsx` formatting | self |
| `frontend/src/components/Terminal.tsx` (EDIT: replace ComingSoon, load portfolio on mount + reconnect, selection sync) | component (shell) | event-driven | itself lines 38-58 | self |
| `frontend/src/test/stubFetch.ts` (NEW, URL-routing fetch stub) | test helper | — | `frontend/src/components/ChartPanel.test.tsx` (`jsonResponse`, `stubDeferredFetch`) | role-match |
| `frontend/src/domain/{portfolio,treemap,pnl}.test.ts` (NEW) | test | unit | `frontend/src/domain/market.test.ts`, `chart.test.ts` | exact |
| `frontend/src/components/{TradeBar,PositionsTable,Heatmap,PnlChart,TradeHistory,header}.test.tsx` (NEW) | test | component | `frontend/src/components/watchlist.test.tsx`, `ChartPanel.test.tsx` (LWC mock) | exact |
| `frontend/src/components/terminal.test.tsx` (EDIT: URL routing, drop placeholder asserts) | test | — | itself | self |

---

## Pattern Assignments

### `backend/app/trading.py` (service, CRUD) and `backend/app/portfolio.py`

**Analog:** `backend/app/watchlist.py`

**Imports / header** (lines 1-17) — copy shape; swap in `money`, `valuation`, `snapshots.insert_snapshot`:
```python
"""Watchlist service: reads, adds and removes tickers, joining live prices from the cache."""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import uuid
from contextlib import closing

from .db import DEFAULT_USER_ID, Database, now_iso
from .errors import DomainError, NotFoundError
from .market import PriceCache
from .tickers import normalize_ticker
from .tracker import TickerTracker

logger = logging.getLogger(__name__)
```

**Constructor injection, shared lock** (lines 32-47):
```python
    def __init__(self, db: Database, cache: PriceCache, tracker: TickerTracker, lock: asyncio.Lock) -> None:
        self._db = db
        self._cache = cache
        self._tracker = tracker
        self._lock = lock
```

**Core: validate outside lock → lock → to_thread txn → reconcile → return** (lines 54-77):
```python
    async def add(self, raw: str) -> tuple[dict, bool]:
        ticker = normalize_ticker(raw)
        async with self._lock:
            row, created = await asyncio.to_thread(self._add_tx, ticker)
            if created:
                logger.info("Watchlist: added %s", ticker)
            await self._reconcile("adding", ticker)
            return self._entry(*row), created
```
For TradeService: `normalize_ticker`, side check, `math.isfinite`, `round_qty > 0` before the lock; inside the lock: `to_thread(_trade_tx)` → `tracker.reconcile_quietly(...)` → `to_thread(view_sync)`. See RESEARCH "Trade transaction core". Logging prefix `"Trade: ..."` / `"Reset: ..."`.

**Transaction body** (lines 92-114) — `with self._db.transaction() as conn:` raising `DomainError` inside rolls back automatically (`backend/app/db/__init__.py` `transaction()` lines ~55-69). Use `?` params, `str(uuid.uuid4())`, `now_iso()`, `DEFAULT_USER_ID`.

**Read-only query pattern** (lines 124-130) — for `view_sync`, `history`, `list_trades`:
```python
    def _load_rows(self) -> list[tuple[str, str]]:
        with closing(self._db.connect()) as conn:
            rows: list[sqlite3.Row] = conn.execute(
                "SELECT ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at, rowid",
                (DEFAULT_USER_ID,),
            ).fetchall()
        return [(row["ticker"], row["added_at"]) for row in rows]
```

**Reset:** use the same txn form; reuse `DEFAULT_CASH`, `DEFAULT_WATCHLIST`, `DEFAULT_USER_ID` from `app.db` / `app/db/seed.py` lines 8-10. Do NOT call `seed()` or `executescript` (see `db/__init__.py` comment "executescript commits implicitly").

**Value objects:** `Trade` / `TradeResult` as `@dataclass(frozen=True, slots=True)` with explicit `to_dict()` — copy from `backend/app/market/models.py` (`PricePoint.to_dict`).

---

### `backend/app/snapshots.py` (EDIT) — deadlock fix

**Source to extract** (lines 54-72): move the body of `_record_tx` into a module function `insert_snapshot(conn, cache) -> float` taking an open connection; `_record_tx` becomes `with self._db.transaction() as conn: return insert_snapshot(conn, self._cache)`. `record()` (lines 49-52) keeps `async with self._lock` — never call it from trade/reset (lock is non-reentrant).
```python
            value = portfolio_value(cash, positions, self._cache.get_price)
            conn.execute(
                "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
                "VALUES (?, ?, ?, ?)",
                (str(uuid.uuid4()), DEFAULT_USER_ID, value, now_iso()),
            )
```
`portfolio_value` (lines 22-35) → `return value_portfolio(cash, positions, price_of)["total_value"]`. Signature `(cash, Iterable[tuple[str, float, float]], Callable[[str], float | None])` is the template for `valuation.value_portfolio`.

---

### `backend/app/tracker.py` (EDIT)

Move `WatchlistService._reconcile` (watchlist.py lines 81-90) here as `async def reconcile_quietly(self, context: str) -> None`:
```python
        try:
            await self._tracker.reconcile()
        except Exception:
            logger.exception("Tracker: reconcile failed after %s %s", action, ticker)
```
Existing `reconcile()` (tracker.py lines 28-38) is the only caller of `source.add_ticker/remove_ticker` — keep it so.

---

### `backend/app/api/portfolio.py` (route, request-response)

**Analog:** `backend/app/api/watchlist.py` (whole file, 40 lines)
```python
from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..watchlist import WatchlistService


class WatchlistAdd(BaseModel):
    """POST body. No regex here: a malformed ticker must be a 400, not a 422."""

    ticker: str


def create_watchlist_router(service: WatchlistService) -> APIRouter:
    """Create the watchlist router bound to `service` (a new router per call)."""
    router = APIRouter(tags=["watchlist"])

    @router.get("/api/watchlist")
    async def list_watchlist() -> dict:
        return {"tickers": await service.list_entries()}
    ...
    return router
```
`TradeRequest(ticker: str, quantity: float, side: str)` — no `Literal`/regex (side checked in service → 400). Handlers stay thin; errors raised as `DomainError` render via `backend/app/errors.py` `error_handlers()`. Reset route: no header or body checks; any POST returns `{"status": "ok"}` after the reset (PLAN §8, user decision U-1; RESEARCH A7 is not adopted).

### `backend/app/api/__init__.py` (EDIT)
Add `from .portfolio import create_portfolio_router` and append to `__all__` (current file lists `create_system_router`, `create_watchlist_router`).

### `backend/app/main.py` (EDIT)
Wire at lines 53-57 with the same `state_lock`:
```python
    state_lock = asyncio.Lock()
    tracker = TickerTracker(db, source)
    watchlist = WatchlistService(db, cache, tracker, state_lock)
    recorder = SnapshotRecorder(db, cache, state_lock)
```
Include at lines 99-102 **before** `install_api_not_found(app)  # after every /api router`.

---

### Backend tests

**Fixtures:** `backend/tests/conftest.py` — `RecordingSource` (lines 22-53, never writes cache, so prices are fixed by `cache.update(...)`), `make_app(source_factory=lambda cache: recording_source())`, `client` (TestClient with lifespan). New `trade_env` fixture: `Database(str(tmp_path/"t.db"))` + `db.init()` + `PriceCache()` + `RecordingSource()` + `TickerTracker` + one `asyncio.Lock()` + services.

**Test module header** — copy `backend/tests/test_watchlist.py` lines 1-40: `run_sql(db_path, sql, params)` helper with `closing(sqlite3.connect(...))`, `ISO_RE`, exact-key list constant (`ENTRY_KEYS = [...]`) → use `PORTFOLIO_KEYS`, `POSITION_KEYS`, `TRADE_KEYS` with `set(body) == {...}`. Wrap service calls in `asyncio.wait_for(..., timeout=2)` to surface deadlocks.

---

### `frontend/src/store/portfolio.ts` (store, request-response)

**Analog:** `frontend/src/store/watchlist.ts`

Imports and failure helper (lines 1-14):
```ts
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import type { WatchlistEntry, WatchlistResponse } from "@/api/types";

const NETWORK_ERROR = "Could not reach the server. Try again.";

function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
}
```
State interface + `create<State>()((set, get) => ({...}))` (lines 16-31); async actions that resolve to an inline error string or `null` (lines 55-72, `addTicker`) — use that contract for `trade()` (return `{error}` or `{trade}`). POST body form: `apiFetch<T>(url, { method: "POST", body: JSON.stringify({...}) })`. Add the module-scoped seq guard from RESEARCH F2 and a `pending` flag. Tolerate malformed bodies (`Array.isArray(res?.positions)`), as ChartPanel does (`Array.isArray(res?.points)`).

### `frontend/src/domain/portfolio.ts`, `treemap.ts`, `pnl.ts` (pure)

**Analog:** `frontend/src/domain/market.ts` — pure exported functions, finite-number guards:
```ts
export function formatPct(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return EM_DASH;
  ...
}
export function signOf(n: number | null | undefined): Sign {
  if (typeof n !== "number" || n === 0 || !Number.isFinite(n)) return "flat";
  return n > 0 ? "up" : "down";
}
```
Reuse `formatPct`, `formatPrice`, `signOf` (don't re-implement); percent values are already in percent units, never ×100. `pnl.ts` mirrors `domain/chart.ts::toSeriesData` (ISO→seconds, dedupe same second, drop out-of-order). Code bodies for `livePortfolio`, `squarify`, `toSnapshotSeries` are in RESEARCH Code Examples.

**`nextSelection` edit** (market.ts lines 70-73):
```ts
export function nextSelection(tickers: readonly string[], selected: string | null): string | null {
  if (selected !== null && tickers.includes(selected)) return selected;
  return tickers[0] ?? null;
}
```
Keep signature; callers pass watchlist ∪ held as the valid set, but fallback must be the first *watchlist* ticker (add a second param or split arrays). Wire in `Terminal` effect, not cross-store imports.

### `frontend/src/components/TradeBar.tsx`, `PositionsTable.tsx`, `TradeHistory.tsx`

**Analog:** `frontend/src/components/Watchlist.tsx`
- Header: `"use client";` + comment naming requirement IDs; imports `@/api/ticker` (`sanitizeTickerInput`, `tickerError`), `@/domain/market`, stores.
- Status → class map: `const CHG_CLASS = { up: "text-up", down: "text-down", flat: "text-muted" } as const;` — use for P&L cells with `data-sign={sign}`.
- Rows: `memo(function Row(...))` selecting a single tick `usePrices((s) => s.ticks[ticker])`. For PositionsTable/Heatmap/Header instead select raw `positions`, `cash`, `ticks` separately and `useMemo(livePortfolio(...))` (Pitfall 8 — never return fresh objects from a selector).
- Single inline message slot cleared on edit (Watchlist add form `onError(message | null)`); `data-testid` on every read element (`trade-ticker`, `trade-qty`, `trade-buy`, `trade-sell`, `trade-message` with `data-kind`).
- Row click → `useWatchlist.getState().select(ticker)` (MD-08).

### `frontend/src/components/PnlChart.tsx` (chart)

**Analog:** `frontend/src/components/ChartPanel.tsx`
Create-once effect (lines ~95-130):
```ts
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: CHART_THEME.background }, textColor: CHART_THEME.text },
      grid: { vertLines: { color: CHART_THEME.grid }, horzLines: { color: CHART_THEME.grid } },
      timeScale: { timeVisible: true, secondsVisible: true, tickMarkFormatter: formatLocalTime },
      localization: { timeFormatter: formatLocalTime },
    });
    const series = chart.addSeries(AreaSeries, { ... });
    chartRef.current = chart; seriesRef.current = series;
    return () => { chartRef.current = null; seriesRef.current = null; chart.remove(); };
  }, []);
```
Swap `AreaSeries` → `BaselineSeries` with `baseValue: { type: "price", price: STARTING_CASH }`; `series.setData(toSnapshotSeries(...))`, `applyOptions({ pointMarkersVisible: data.length <= 1 })`, `timeScale().fitContent()`. Request-id stale guard (`requestIdRef`) from the history effect. `setInterval(30_000)` in an effect with cleanup.

### `frontend/src/components/Heatmap.tsx`
Browser APIs only in effects (ResizeObserver, like ChartPanel's createChart effect). Tiles are absolutely positioned `<button>`s with percent geometry from `squarify`, `data-testid="heatmap-tile-{TICKER}"`, `data-sign`, `title` tooltip; empty text exactly `No positions — buy something or ask FinAlly`. Panel chrome: copy `ComingSoon` section markup in `Terminal.tsx` lines 15-37 (`border border-border bg-panel`, `h2 ... text-xs font-semibold uppercase tracking-wide`).

### `frontend/src/components/Header.tsx` (EDIT)
Keep `ConnectionDot` (lines 13-26, `data-testid` + `data-status` pattern). Add total/cash/P&L via `useMemo(livePortfolio)`, Reset button calling `window.confirm` inside the click handler only.

### `frontend/src/components/Terminal.tsx` (EDIT)
Extend the mount effect (lines 38-58): call portfolio/history/trades loaders alongside `loadWatchlist()`, and in the `usePrices.subscribe` reconnect branch re-fetch them too (Pitfall 11). Add a subscription to `usePortfolio` + `useWatchlist` that reconciles selection. Replace the three Phase-2 `ComingSoon` slots; keep chat slot.

### Frontend tests
- LWC mock: copy `ChartPanel.test.tsx` lines 10-31 (`vi.hoisted` spies + `vi.mock("lightweight-charts", async (importOriginal) => ({...actual, createChart}))`); add `applyOptions` spy on series.
- `jsonResponse(body, status)` (lines 33-38) → lift into `frontend/src/test/stubFetch.ts` with URL routing.
- SSE frames via `frontend/src/test/FakeEventSource.ts`.

---

## Shared Patterns

### Error envelope
**Source:** `backend/app/errors.py` — `raise DomainError(msg)` (400) / `NotFoundError` (404); no per-route `JSONResponse` for errors. **Apply to:** trading.py, portfolio.py, api/portfolio.py.

### Lock + transaction + reconcile
**Source:** `backend/app/watchlist.py` lines 54-90; `backend/app/db/__init__.py` `transaction()` (BEGIN IMMEDIATE, rollback-safe). One shared `state_lock` from `main.py`. Never take the lock twice (no `recorder.record()` inside).

### Router factory, no module state
**Source:** `backend/app/api/watchlist.py` `create_watchlist_router(service)`.

### Logging
`logger = logging.getLogger(__name__)`; `%s` args; component prefix (`"Trade: %s %s %s @ %s"`); `logger.exception` in broad excepts (snapshots.py lines 83-88).

### Frontend API access
`apiFetch` / `ApiError` from `@/api/client` only (422 already → "Invalid request"); browser APIs only inside effects/handlers; one EventSource (`@/store/prices`).

### Selectors
Select raw slices, derive with `useMemo` (Zustand v5).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `backend/app/money.py` | utility | transform | No Decimal/rounding code exists; use RESEARCH "money.py" verbatim |
| `frontend/src/domain/treemap.ts` | utility | transform | No layout algorithm exists; use RESEARCH squarify code |
| `frontend/src/components/Heatmap.tsx` (layout part) | component | streaming | No positioned-div visualization exists; combine Watchlist selectors + ChartPanel effect rules |

## Metadata

**Analog search scope:** `backend/app/`, `backend/tests/`, `frontend/src/` (git-tracked only)
**Files scanned:** 14 read
**Pattern extraction date:** 2026-10-27
