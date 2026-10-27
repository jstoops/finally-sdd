# Phase 2: Trading and Live Portfolio - Research

**Researched:** 2026-10-27
**Domain:** Transactional trade execution on stdlib SQLite inside async FastAPI, plus client-side live portfolio valuation (Zustand, Lightweight Charts 5, in-house squarified treemap) in a Next.js 16 static export
**Confidence:** HIGH (the codebase was read directly, and runtime behavior was probed in the project venv; the few judgment calls are marked)

## Summary

Phase 1 left almost every seam Phase 2 needs. `create_app` builds one `asyncio.Lock` (`state_lock`) and shares it between `WatchlistService` and `SnapshotRecorder`. `Database.transaction()` already runs `BEGIN IMMEDIATE … COMMIT/ROLLBACK` on a fresh connection per unit of work. `TickerTracker.reconcile()` already diffs watchlist ∪ positions against the source. All six tables exist. On the frontend, a single Zustand prices store holds the full SSE map, and `apiFetch` already turns the `{"error": ...}` envelope (and 422 → "Invalid request") into `ApiError`. Phase 2 is mostly composition: one `TradeService`, one pure valuation module, one portfolio router, a reset path, and five panels that read `positions × ticks`.

The real risks are specific, and most come from the code itself:

1. **Deadlock.** `SnapshotRecorder.record()` acquires `state_lock`, and `asyncio.Lock` is not reentrant. The Phase 1 summary says to "call `recorder.record()` after trades and reset". Doing that while holding the lock hangs the request forever. Write the snapshot inside the trade or reset transaction through a lock-free helper instead.
2. **Cent rounding.** Python `round()` is banker's rounding on binary floats (`round(0.125, 2) == 0.12`, `round(2.675, 2) == 2.67`, probed). Compute notional with `Decimal(str(qty)) * Decimal(str(price))` and `ROUND_HALF_UP`. Also round the resulting position quantity to 4dp (`0.1 + 0.2 = 0.30000000000000004`, probed).
3. **NaN and Infinity reach the service.** FastAPI 0.162 / Pydantic 2.12 accept `NaN`, `Infinity`, `1e400`, `"10"` and `true` as a `float` body field and return 200 (probed). The trade service must reject non-finite quantities itself.
4. **MD-08 is overridden by Phase 1 selection logic.** `nextSelection` keeps a selection only if it is on the watchlist. Clicking a held but unwatched position would chart it, and the next `setEntries` would silently move the selection back.
5. **Zustand v5 loops.** A selector that returns a new object or array on every call causes an infinite render loop ("Maximum update depth exceeded"). Select the raw `positions`, `cash` and `ticks` and derive with `useMemo`.

**Primary recommendation:** Lead with a tracer slice: `TradeService.execute()` (lock → `asyncio.to_thread` → one `BEGIN IMMEDIATE` transaction that writes cash, position, trade and snapshot → reconcile → portfolio) behind `POST /api/portfolio/trade`, with a minimal trade bar that updates header cash from the returned `portfolio`. Then fan out in parallel: the portfolio/history/trades/reset endpoints, and the positions table, heatmap, P&L chart and trade-history panels on a pure `livePortfolio(cash, positions, ticks)` function.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trade rules (ticker, qty, cash or shares check, avg cost, dust, cent rounding) | API / Backend (`TradeService`) | — | Must be shared with the Phase 3 AI executor; the client never decides a fill |
| Fill price | API / Backend (reads `PriceCache`) | — | One price path for SSE and execution; the client never sends a price |
| Serialization of mutations | API / Backend (`state_lock` + `BEGIN IMMEDIATE`) | Database | Single worker, so an in-process lock is sufficient; SQLite is the second defence |
| Cash, positions, trades, snapshots persistence | Database (SQLite) | — | PLAN §7 |
| Tracked tickers (watchlist ∪ positions) | API / Backend (`TickerTracker.reconcile`) | — | Only caller of `source.add_ticker`/`remove_ticker` (STATE decision) |
| Periodic and post-trade snapshots | API / Backend | Database | Background task in lifespan, plus in-transaction writes |
| Authoritative portfolio valuation (`GET /api/portfolio`, snapshots) | API / Backend (pure `valuation` function) | — | Same function for the API, snapshots, and Phase 3 LLM context |
| Live valuation (header, positions table, heatmap) | Browser / Client | — | PLAN §10: positions from the API × SSE prices, no polling |
| Treemap layout and P&L colors | Browser / Client | — | PLAN §10: in-house layout, positioned divs |
| P&L chart | Browser / Client (Lightweight Charts) | API (`/api/portfolio/history`) | Refetch every 30s plus after each trade or reset (G-03) |
| Trade-bar validation | Browser / Client (UX only) | API (authoritative) | Mirrors the Phase 1 D-08 pattern |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRD-01 | Single trade service; ticker normalize/regex; qty > 0, 4dp, reject rounds-to-0; fill at cached price; exact no-price message | Pattern 1 (`TradeService`), reuse `normalize_ticker`; Pitfall 3 (NaN/inf) |
| TRD-02 | Buy cash check; weighted avg cost | Pattern 2 (money math), Code Example "trade transaction" |
| TRD-03 | Sell tolerance 1e-6, clamp, avg unchanged, dust deletes row | Pattern 2; Pitfall 4 (qty float noise) |
| TRD-04 | Cost and cash rounded to cents at write | Pattern 2 (`Decimal` + `ROUND_HALF_UP`); Pitfall 2 |
| TRD-05 | One `BEGIN IMMEDIATE` txn, in-process lock shared with reset, then snapshot | Pattern 1; Pitfall 1 (deadlock); existing `Database.transaction()` |
| TRD-06 | `POST /api/portfolio/trade` 200 / 400 / 422 | Pattern 5 (router factory); errors via `DomainError` |
| TRD-07 | Trade bar: ticker + fractional qty, Buy/Sell, no confirm | Frontend Pattern F3 (TradeBar) |
| TRD-08 | Inline 400 / generic 422, clears on edit | `apiFetch` already maps 422 to "Invalid request" (client.ts:31) |
| TRD-09 | Auto-clearing "Bought 10 AAPL @ $190.52", clear qty, keep ticker | Pattern F3; uses `trade.price` from the response |
| TRD-10 | Trade history panel from `GET /api/trades`, newest first | New endpoint (Pattern 5); prepend the returned trade client-side |
| WL-06 | Tracked set = watchlist ∪ positions across trade, sell-to-zero, reset | Reconcile after every trade and reset (Pattern 1/4); tests in Validation |
| PF-01 | `GET /api/portfolio` shape, avg-cost fallback, 0-safe weight, percent units 4dp | Pattern 3 (pure valuation) |
| PF-02 | Snapshots at startup, every 30s, after trade, after reset | Existing loop; in-transaction `insert_snapshot` (Pitfall 1) |
| PF-03 | `GET /api/portfolio/history` oldest first | Pattern 5 |
| PF-04 | Header total and cash live, no polling | Frontend Pattern F1 (`livePortfolio`) |
| PF-05 | Header "P&L since start" = total − 10,000, green/red | F1; `DEFAULT_CASH = 10000.0` |
| PF-06 | Positions table live, colored, 2dp percent with no ×100 | F1 + Pitfall 7 (percent units) |
| PF-07 | Squarified treemap, live weights, ±5% diverging color, tiny-tile tooltip, empty text | Frontend Pattern F4 + code example |
| PF-08 | P&L line chart, single point OK, refetch 30s and after trade/reset | Frontend Pattern F5 (BaselineSeries + `pointMarkersVisible`), Pitfall 6 (duplicate seconds) |
| PF-09 | Reset with `window.confirm`; one txn; re-sync; fresh snapshot; shares lock | Pattern 4 (reset) |
| MD-08 | Click a position row or heatmap tile to chart it | Pitfall 5 (`nextSelection` override) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `./CLAUDE.md` (which includes `planning/PLAN.md`), `./.claude/CLAUDE.md`, `backend/CLAUDE.md`, and `frontend/CLAUDE.md` + `frontend/AGENTS.md`:

- **Stack fixed:** FastAPI + uv (Python 3.12), stdlib `sqlite3` with no ORM, Next.js static export + TypeScript + Tailwind, Lightweight Charts, LiteLLM (Phase 3). No other charting libraries: sparklines are inline SVG and the heatmap is positioned divs.
- **Contracts:** API shapes, status codes and timestamps must match PLAN §6–§8 exactly. REST and DB timestamps are ISO 8601 UTC; SSE and history timestamps are Unix float seconds.
- **Startup:** all initialization happens in `lifespan`; nothing is deferred to the first request.
- **Single worker:** `PriceCache` is process-local; run `--workers 1`.
- **Python conventions:** `from __future__ import annotations`; PEP 604 unions; Ruff (line length 100, `E,F,I,N,W`); `%s` logging with component prefixes (`"Trade: ..."`); frozen dataclasses with explicit `to_dict()` for wire shapes (never `asdict`); router factories `create_*_router(deps)` with no module-level state; blocking I/O via `asyncio.to_thread`; source calls stay on the event loop; only market sources write to `PriceCache`.
- **Errors:** business failures raise `DomainError` (400) or `NotFoundError` (404) and render as `{"error": ...}`; malformed bodies keep FastAPI's 422.
- **Tests:** never `MagicMock` Massive snapshots; inject fakes through constructors; patch env with `patch.dict(os.environ, ..., clear=True)`.
- **Frontend:** read `NEXT_PUBLIC_API_BASE` only in `src/api/client.ts`; use `apiUrl()` and `apiFetch()`; browser APIs (`window`, `ResizeObserver`, Lightweight Charts, `window.confirm`) only inside effects or handlers, because the export prerenders; exactly one `EventSource`, owned by `src/store/prices.ts`; no `next/font/google`; never create `frontend/.env.local`.
- **Next.js 16 note (`frontend/AGENTS.md`):** "This is NOT the Next.js you know." Read `node_modules/next/dist/docs/` before using any Next API beyond what Phase 1 already uses. This phase needs no new Next APIs: everything is client components.
- **Visual:** dark theme `#0d1117` / `#1a1a2e`, no pure black; accent `#ecad0a`, blue `#209dd7`, purple `#753991` for submit buttons (Buy and Sell are submit-type actions: see Open Question 4); tabular numerals; desktop-first.
- **GSD workflow:** file changes only through GSD commands. This is relevant to the executor, not the plan content.
- **Test hooks (TST-04, planned now per ROADMAP planning notes):** `data-testid` on every element a test reads, and a `data-sign` attribute on P&L-bearing elements, added as each panel is built.

## Standard Stack

No new dependencies. Everything is already locked or installed and verified in this session.

### Core (existing, reused)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | 0.162.0 (installed) | Portfolio, trade, history, trades and reset routes | Already the app framework [VERIFIED: `fastapi.__version__` probe in backend venv] |
| Pydantic | 2.12.5 | Request bodies (`TradeRequest`) | Ships with FastAPI [VERIFIED: probe] |
| stdlib `sqlite3` | SQLite 3.53.1 | Transactions (`BEGIN IMMEDIATE`) | PLAN §3/§7 [VERIFIED: `sqlite3.sqlite_version` probe] |
| stdlib `decimal` | Python 3.12.15 | Exact cent rounding of notional and cash | No dependency; exact half-up [VERIFIED: probe output below] |
| lightweight-charts | 5.2.1 | P&L chart (`BaselineSeries` or `AreaSeries`) | PLAN §10; already used by `ChartPanel` [VERIFIED: `node_modules/lightweight-charts/package.json`] |
| zustand | 5.0.16 | `usePortfolio` store next to `usePrices` / `useWatchlist` | Already the store library [VERIFIED: `node_modules/zustand/package.json`] |
| React | 19.3.0, Next 16.4.3 | UI | Existing [VERIFIED: frontend/package.json] |

### Supporting (existing test stack)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest + pytest-asyncio (`asyncio_mode = "auto"`) | pytest 9.0.2 | Service, concurrency and API tests | All backend tests [VERIFIED: backend/pyproject.toml] |
| httpx / `fastapi.testclient.TestClient` | 0.28.1 | Route tests through lifespan | API shape tests (existing `client` fixture) |
| Vitest 5 + Testing Library + jsdom 30 | vitest ^5.0.5 | Component and domain tests | All frontend tests [VERIFIED: frontend/package.json] |
| `src/test/FakeEventSource.ts` | in-repo | Drive SSE frames in tests | Live-valuation component tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| float + `Decimal` at rounding points | Integer cents in INTEGER columns | Would change PLAN §7's `REAL` schema and every wire field; rejected |
| float + `Decimal` at rounding points | Full `Decimal` arithmetic and storage | `sqlite3` would need adapters; REAL columns round-trip floats anyway; overkill |
| In-transaction snapshot | `recorder.record()` after releasing the lock | Works, but the snapshot is not atomic with the trade and needs a second lock acquisition; a later caller copying the Phase 1 hint would deadlock |
| `BaselineSeries` (baseValue 10,000) for P&L | `AreaSeries` (same as the main chart) | Baseline gives green-above / red-below the starting cash for free; Area matches the main chart. Both are built in. **Recommend Baseline** (see Open Question 3) |
| 30s refetch of `/api/portfolio/history` | Append the client live total as a moving last point | G-03 and PF-08 already chose the 30s refetch |

**Installation:** none.

## Package Legitimacy Audit

This phase installs no external packages. Every library it uses is already in `backend/uv.lock` or `frontend/package-lock.json` and passed the Phase 1 Wave 0 legitimacy gate (ROADMAP 01-01).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| *(none new)* | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

If an executor reaches for a treemap or decimal library (for example a squarify package), that breaks PLAN §10 and this audit. Use the in-house code below.

## Architecture Patterns

### System Architecture Diagram

```
 Browser                                                         Backend (single uvicorn worker)
 ───────                                                         ───────────────────────────────
 TradeBar ──POST /api/portfolio/trade {ticker,quantity,side}──▶ portfolio router
                                                                     │ (parse only; side/qty checked in service)
                                                                     ▼
                                                               TradeService.execute()
                                                                     │ async with state_lock  ◀── shared with WatchlistService,
                                                                     │                            SnapshotRecorder, ResetService
                                                                     ▼
                                                               asyncio.to_thread(_trade_tx)
                                                                 ├─ normalize ticker / validate qty, side
                                                                 ├─ price = PriceCache.get_price(t) ── none ─▶ DomainError 400
                                                                 ├─ BEGIN IMMEDIATE
                                                                 │    read cash + position
                                                                 │    buy: cost<=cash?  sell: qty<=held+1e-6?  ─ no ─▶ ROLLBACK, 400
                                                                 │    write cash, upsert/delete position, insert trade
                                                                 │    insert_snapshot(conn, cache)   (PF-02)
                                                                 └─ COMMIT
                                                                     ▼
                                                               TickerTracker.reconcile()  (sell-to-zero of unwatched → remove)
                                                                     ▼                     (failure logged, not raised)
                                                               PortfolioService.snapshot_view() → {trade, portfolio}
                                                                     │
 usePortfolio.applyPortfolio(seq) ◀──────── 200 JSON ────────────────┘
       │ prepend trade to trades list; refetch /api/portfolio/history
       ▼
 livePortfolio(cash, positions, usePrices.ticks) ──▶ Header (total, cash, P&L since start)
       (pure, recomputed per SSE frame)          ──▶ PositionsTable (rows, colors)   ──click──▶ select(ticker) ─▶ ChartPanel
                                                 ──▶ Heatmap (squarify → divs)        ──click──┘
 SSE /api/stream/prices ──▶ usePrices.ticks (exists)

 Header Reset ─ window.confirm ─▶ POST /api/reset ─▶ ResetService: lock → txn(cash=10000, delete positions/trades/
                                                     snapshots/chat, restore default watchlist, insert_snapshot)
                                                     → reconcile → {"status":"ok"}
       ◀── then refetch portfolio, watchlist, history, trades

 Snapshot loop (exists): every 30s → SnapshotRecorder.record() (takes lock) → insert_snapshot
 PnlChart: GET /api/portfolio/history on mount, every 30s, after trade and reset → ISO→sec, dedupe → setData
```

### Recommended Project Structure

Follow Phase 1's flat service layout (`app/watchlist.py`, `app/tracker.py`, `app/snapshots.py`). Don't introduce the `app/portfolio/` package that `.planning/research/ARCHITECTURE.md` sketched: the real code chose flat modules.

```
backend/app/
├── money.py              # NEW pure: to_cents(), notional(), round_qty(); Decimal ROUND_HALF_UP
├── valuation.py          # NEW pure: value_portfolio(cash, positions, price_of) -> dict (PF-01 shape)
├── trading.py            # NEW TradeService (+ TradeResult dataclass); the Phase 3 executor calls this
├── portfolio.py          # NEW PortfolioService: read view, history, trades list, reset()
├── snapshots.py          # EDIT: extract insert_snapshot(conn, cache) -> float; portfolio_value delegates to valuation
├── api/portfolio.py      # NEW create_portfolio_router(trade_service, portfolio_service)
├── api/__init__.py       # EDIT: export create_portfolio_router
└── main.py               # EDIT: build services with the SAME state_lock; include router BEFORE install_api_not_found

backend/tests/
├── test_money.py, test_valuation.py, test_trading.py, test_portfolio_api.py, test_reset.py   # NEW
└── test_tracker.py / test_snapshots.py                                                         # EXTEND

frontend/src/
├── api/types.ts          # EDIT: Position, Portfolio, Trade, TradeResponse, SnapshotsResponse, TradesResponse
├── domain/portfolio.ts   # NEW pure: livePortfolio(), pnlColor(), formatQty(), STARTING_CASH
├── domain/treemap.ts     # NEW pure: squarify()
├── domain/pnl.ts         # NEW pure: toSnapshotSeries() (ISO→sec, dedupe same second)
├── store/portfolio.ts    # NEW usePortfolio: cash, positions, snapshots, trades, load*/trade/reset, seq guard
├── components/TradeBar.tsx, PositionsTable.tsx, Heatmap.tsx, PnlChart.tsx, TradeHistory.tsx   # NEW
├── components/Header.tsx # EDIT: total, cash, P&L since start, Reset
└── components/Terminal.tsx # EDIT: replace ComingSoon slots; load portfolio data on mount and on reconnect
```

### Pattern 1: TradeService: lock → thread → one transaction → reconcile → view

**What:** One async entry point used by the HTTP route now and by the AI executor in Phase 3. It takes `state_lock`, does every DB step (including the snapshot) in one `BEGIN IMMEDIATE` transaction on a worker thread, reconciles tracked tickers on the event loop, and builds the portfolio view while still under the lock, so the response matches the committed state.

**When to use:** Every trade. Phase 3 calls `await trade_service.execute(ticker, quantity, side)` per action and catches `DomainError` to record `failed`.

**Existing seams it composes** (read this session):
- `backend/app/main.py:53-57`: `state_lock = asyncio.Lock()`, `tracker = TickerTracker(db, source)`, `watchlist = WatchlistService(db, cache, tracker, state_lock)`, `recorder = SnapshotRecorder(db, cache, state_lock)` [VERIFIED: backend/app/main.py:53-57]
- `backend/app/db/__init__.py:49` and `:59`: `conn = sqlite3.connect(self._path, timeout=5.0, isolation_level=None)` … `conn.execute("BEGIN IMMEDIATE")` [VERIFIED: backend/app/db/__init__.py:48-69]
- `backend/app/watchlist.py:81-90`: the `_reconcile` pattern. Wrap `await self._tracker.reconcile()` in `try/except Exception: logger.exception(...)` because the DB change is already committed [VERIFIED: backend/app/watchlist.py:81-90]
- `backend/app/tickers.py:9`: `TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")  # PLAN §7`; `normalize_ticker(raw)` raises `DomainError` [VERIFIED: backend/app/tickers.py:9-27]

Extract the reconcile-without-raising helper into `TickerTracker` (for example `async def reconcile_quietly(self, context: str)`) so watchlist, trade and reset share one implementation instead of three copies.

### Pattern 2: Money math with explicit rounding points (TRD-02/03/04, G-07, G-10)

| Value | Rounding | Where |
|---|---|---|
| price | 2dp, already done by `PriceCache.update` (`price = round(float(price), 2)`) [VERIFIED: backend/app/market/cache.py:48] | none needed |
| requested quantity | 4dp, half-up; reject if non-finite or `<= 0` after rounding | service entry |
| notional (cost or proceeds) | `Decimal(str(qty)) * Decimal(str(price))` → `quantize(Decimal("0.01"), ROUND_HALF_UP)` | `money.notional()` |
| cash after trade | `to_cents(cash - cost)` / `to_cents(cash + proceeds)` | write time |
| position quantity after trade | `round_qty(old + qty)` / `round_qty(held - sold)` | write time (Pitfall 4) |
| avg_cost | **not rounded** when stored (full precision); rounded to 4dp only on the wire | write: full; read: 4dp |
| buy check | `cost <= cash` using the **rounded** cost (what is actually debited) | service |

Probe results from the backend venv this session [VERIFIED: python probe]:
```
round(2.675,2)= 2.67          # binary float + banker's rounding
round(0.125,2)= 0.12          # half-even, not half-up
0.1+0.2= 0.30000000000000004 round4= 0.3
drift cash= 9999.000999999998 # three naive `cash -= 0.1*3.33` steps
Decimal(str(0.0125))*Decimal(str(190.5)) quantized HALF_UP -> 2.38
```

"Buy max" always succeeds. Cash is on the cent grid and half-up rounding is monotone, so `raw_cost <= cash` implies `rounded_cost <= cash`. A client computing `floor(cash / price, 4dp)` never gets a spurious "insufficient cash". Add a test for this (ROADMAP research flag: "buy max succeeds").

### Pattern 3: Pure valuation shared by `/api/portfolio`, snapshots and (Phase 3) LLM context

```python
def value_portfolio(cash, positions, price_of) -> dict:
    """positions: iterable of (ticker, quantity, avg_cost). Returns the PLAN §8 shape."""
    rows = []
    for ticker, qty, avg in positions:
        cached = price_of(ticker)
        price = cached if cached is not None else avg          # PF-01 fallback
        mv = to_cents(qty * price)                             # (or notional(qty, price))
        pnl = to_cents((price - avg) * qty)
        pct = round((price - avg) / avg * 100, 4) if avg > 0 else 0.0   # percent units (G-12)
        rows.append({...})
    positions_value = to_cents(sum(r["market_value"] for r in rows))
    for r in rows:
        r["weight"] = round(r["market_value"] / positions_value, 4) if positions_value > 0 else 0.0
    total = to_cents(cash + positions_value)
    unrealized = to_cents(sum(r["unrealized_pnl"] for r in rows))
    return {"cash_balance": to_cents(cash), "positions_value": positions_value,
            "total_value": total, "unrealized_pnl": unrealized, "positions": rows}
```
Sum the **rounded** market values, so `cash + positions_value == total_value` exactly as displayed. Then make `snapshots.portfolio_value(...)` return `value_portfolio(...)["total_value"]`. Snapshots and `GET /api/portfolio` can then never disagree by a cent. The existing `TestPortfolioValue` cases still pass: the edge case `0.1 + 0.3333×3.0` gives 1.1 either way.

Position row keys, verbatim from PLAN §8: `ticker, quantity, avg_cost, current_price, market_value, unrealized_pnl, unrealized_pnl_percent, weight`. Top-level keys: `cash_balance, positions_value, total_value, unrealized_pnl, positions`. Order positions deterministically: `ORDER BY rowid` (insertion), or by market value descending. Pick one and test it.

### Pattern 4: Reset (PF-09) = one transaction + reconcile, under the same lock

Inside `async with state_lock:` → `to_thread(_reset_tx)`:
```sql
UPDATE users_profile SET cash_balance = 10000.0 WHERE id = 'default';
DELETE FROM positions WHERE user_id = 'default';
DELETE FROM trades WHERE user_id = 'default';
DELETE FROM portfolio_snapshots WHERE user_id = 'default';
DELETE FROM chat_messages WHERE user_id = 'default';
DELETE FROM watchlist WHERE user_id = 'default';
-- executemany INSERT of DEFAULT_WATCHLIST with one shared now_iso(); rowid preserves default order
-- insert_snapshot(conn, cache)  -> 10000.0, the "fresh P&L starting point"
```
Then `reconcile` removes held or added non-default tickers and re-adds removed defaults, then return `{"status": "ok"}`. Don't reuse `seed()`: it inserts the watchlist only when the user row is new (`if cur.rowcount != 1: return False`) [VERIFIED: backend/app/db/seed.py:21-26]. Reuse the constants instead. `DEFAULT_USER_ID = "default"`, `DEFAULT_CASH = 10000.0`, `DEFAULT_WATCHLIST = ("AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX")` [VERIFIED: backend/app/db/seed.py:8-10]. Never call `executescript` inside the transaction: it commits implicitly, as the comment at `db/__init__.py:76` notes [VERIFIED: backend/app/db/__init__.py:76-77].

### Pattern 5: Router factory and mount order

`create_portfolio_router(trade_service, portfolio_service) -> APIRouter` with:
- `GET /api/portfolio` → `PortfolioService.view()`
- `POST /api/portfolio/trade` body `TradeRequest(ticker: str, quantity: float, side: str)`. Use no `Literal` or regex on the model, matching the `WatchlistAdd` precedent ("No regex here: a malformed ticker must be a 400, not a 422" [VERIFIED: backend/app/api/watchlist.py:12-15]). The service validates `side in {"buy","sell"}` and raises a 400. Missing fields or wrong JSON types still produce FastAPI's 422.
- `GET /api/portfolio/history` → `{"snapshots": [{"total_value", "recorded_at"}]}` `ORDER BY recorded_at, rowid`
- `GET /api/trades` (TRD-10, extra) → `{"trades": [{"id","ticker","side","quantity","price","executed_at"}]}` `ORDER BY executed_at DESC, rowid DESC LIMIT 100`
- `POST /api/reset` → `{"status": "ok"}`

In `create_app`, include the router **before** `install_api_not_found(app)`. That catch-all registers `/api/{path:path}` for GET/POST/PUT/PATCH/DELETE and must stay after every `/api` router [VERIFIED: backend/app/main.py:99-103, 107-120].

### Frontend Pattern F1: live valuation is a pure function of (cash, positions, ticks)

```ts
// src/domain/portfolio.ts
export const STARTING_CASH = 10000;
export function livePortfolio(cash: number, positions: readonly Position[], ticks: Record<string, PriceTick>) {
  const rows = positions.map((p) => {
    const price = ticks[p.ticker]?.price ?? p.current_price;   // server value already falls back to avg_cost
    const marketValue = p.quantity * price;
    const pnl = (price - p.avg_cost) * p.quantity;
    const pnlPct = p.avg_cost > 0 ? ((price - p.avg_cost) / p.avg_cost) * 100 : 0;
    return { ...p, current_price: price, market_value: marketValue, unrealized_pnl: pnl, unrealized_pnl_percent: pnlPct };
  });
  const positionsValue = rows.reduce((s, r) => s + r.market_value, 0);
  const withWeights = rows.map((r) => ({ ...r, weight: positionsValue > 0 ? r.market_value / positionsValue : 0 }));
  const total = cash + positionsValue;
  return { cash, positionsValue, total, pnlSinceStart: total - STARTING_CASH, rows: withWeights };
}
```
In components, select **raw stable references** and derive in render:
```ts
const cash = usePortfolio((s) => s.cash);
const positions = usePortfolio((s) => s.positions);
const ticks = usePrices((s) => s.ticks);           // replaced once per SSE frame, stable between frames
const live = useMemo(() => livePortfolio(cash, positions, ticks), [cash, positions, ticks]);
```
Never `usePortfolio((s) => livePortfolio(...))` or `usePrices((s) => positions.map(...))`: see Pitfall 8.

Ticks for held but unwatched tickers are already in `usePrices.ticks`, because `ingestFrame` replaces the map with the full frame of every tracked ticker (`ticks[ticker] = tick` for each entry of the frame) [VERIFIED: frontend/src/store/prices.ts:31-49]. MD-01 is satisfied with no change.

### Frontend Pattern F2: `usePortfolio` store with a response-sequence guard

The server portfolio can arrive from several places: the initial load, a trade response, a refetch after reset, and (Phase 3) a refetch after chat. Tag every request with an increasing sequence number and drop a response older than the last one applied. This avoids the stale-overwrite race Phase 1 left open for the watchlist (IN-02 in `01-REVIEW-DISPOSITION.md`).
```ts
let issued = 0; let applied = 0;
async function fetchPortfolio() { const seq = ++issued; const p = await apiFetch<Portfolio>("/api/portfolio"); apply(p, seq); }
function apply(p: Portfolio, seq: number) { if (seq < applied) return; applied = seq; usePortfolio.setState({ cash: p.cash_balance, positions: p.positions }); }
// trade(): const seq = ++issued before POST; apply(res.portfolio, seq)
```
Also disable Buy and Sell while a trade request is pending. The backend lock alone keeps cash exact under rapid clicks; the pending flag keeps the UI from stacking requests.

### Frontend Pattern F3: TradeBar (TRD-07/08/09)

- Ticker input reuses `sanitizeTickerInput` and `tickerError` from `@/api/ticker` [VERIFIED: frontend/src/api/ticker.ts:15-27]. Quantity input is `type="text" inputMode="decimal"`. Avoid `type="number"`: locale commas, a silent empty `value` on invalid text, and awkward userEvent behavior in jsdom. Client check: `Number(q)` finite and `> 0`; the server stays authoritative.
- Buy and Sell are two `type="button"` buttons (or one form with `submitter`) that call `usePortfolio.trade(ticker, qty, side)`. No `window.confirm`.
- One inline message slot. Errors show `ApiError.message`; for a 422, `client.ts` already returns `"Invalid request"` (`if (res.status === 422) return "Invalid request";` [VERIFIED: frontend/src/api/client.ts:31]). Clear the message on any edit, as in Phase 1 D-07.
- Success: `Bought 10 AAPL @ $190.52` / `Sold …`, built from `res.trade.side/quantity/ticker/price`. Clear it after about 3s with `setTimeout`, cleared in effect cleanup (test with `vi.useFakeTimers()`). Clear the quantity field and keep the ticker.
- Test ids: `trade-ticker`, `trade-qty`, `trade-buy`, `trade-sell`, `trade-message` with `data-kind="error|success"`.

### Frontend Pattern F4: Squarified treemap (PF-07)

Bruls, Huizing & van Wijk (2000), "Squarified Treemaps". Sort values descending and grow the current row along the shorter side while the worst aspect ratio improves. Otherwise lay the row out and recurse on the remaining rectangle. About 50 lines, pure, and unit-testable (see Code Examples). Render each tile as an absolutely positioned `<button>` with `left/top/width/height` in **percent** of the container. Measure the container's aspect ratio with a `ResizeObserver` inside an effect (jsdom already has a stub [VERIFIED: frontend/vitest.setup.ts]), defaulting to 16:9 before the first measurement.
- Size: live `weight` (market value) from F1. Recomputing every 500ms frame is cheap for ≤50 positions; no throttle is needed.
- Color: `pnlColor(pct)` with `t = clamp(pct / 5, -1, 1)`, mixing from a neutral (`#30363d`, the border token) toward `--color-up: #22c55e` or `--color-down: #ef4444` [VERIFIED: frontend/src/app/globals.css @theme]. Expose `data-sign` (`up/down/flat`) and `data-testid="heatmap-tile-{TICKER}"`.
- Labels: ticker + P&L % when the tile is large enough (for example ≥ 6% width and ≥ 18% height, or a pixel threshold from the measured size); otherwise no text, with a `title="AAPL +1.23%"` tooltip.
- Empty state: exactly `No positions — buy something or ask FinAlly`.
- Click → select the ticker for the chart (MD-08, Pitfall 5).

### Frontend Pattern F5: P&L chart (PF-08)

- Create the chart once in an effect, like `ChartPanel` (`createChart(el, {autoSize: true, layout, grid, timeScale: {timeVisible: true, secondsVisible: false}, localization: {timeFormatter: formatLocalTime}})`). Reuse `CHART_THEME` and `formatLocalTime` from `@/domain/chart` [VERIFIED: frontend/src/domain/chart.ts:8-16, 51-53].
- Series: `chart.addSeries(BaselineSeries, { baseValue: { type: "price", price: STARTING_CASH }, topLineColor: up, bottomLineColor: down, ... })`. `BaselineSeries` is exported from LWC 5.2.1, and its style options include `baseValue: BaseValueType` and `pointMarkersVisible: boolean` [VERIFIED: node_modules/lightweight-charts/dist/typings.d.ts lines 695, 768, 5035].
- Single point (right after a reset): with one data item the line has no segment to draw. Set `pointMarkersVisible: data.length <= 1` (via `applyOptions`) so the point shows, and call `timeScale().fitContent()`.
- Data: `toSnapshotSeries(snapshots)` converts ISO to Unix seconds (`Date.parse(iso) / 1000`), drops non-finite values, and **collapses equal seconds, keeping the last value** (Pitfall 6).
- Refresh: fetch on mount, then `setInterval(30_000)` (cleared on unmount), plus a refetch after each successful trade and after reset.

### Anti-Patterns to Avoid

- **Calling `SnapshotRecorder.record()` (or anything that takes `state_lock`) while holding `state_lock`.** It deadlocks (Pitfall 1).
- **Trade logic in the route handler.** Phase 3's executor would have to call HTTP internally or duplicate the rules.
- **Reading the price in the route and passing it in.** Read it in `_trade_tx`, under the lock, so the checked price and the filled price are the same.
- **Sending price or cost from the client.** The client sends only `{ticker, quantity, side}`.
- **Polling `/api/portfolio`** (PLAN §10 forbids it). Polling `/api/portfolio/history` every 30s is allowed (G-03).
- **A second `EventSource`** for portfolio values. Positions × ticks covers it.
- **Calling `source.add_ticker`/`remove_ticker` from trade or reset code.** Only `TickerTracker.reconcile` may (STATE decision; tracker.py docstring "This is the only module outside `app/market` that calls `source.add_ticker` or `source.remove_ticker`" [VERIFIED: backend/app/tracker.py:1-5]).
- **`dataclasses.asdict`** for wire payloads. Use explicit `to_dict()` (CONVENTIONS).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Half-up cent rounding | `int(x*100+0.5)/100`, `round(x, 2)` | `decimal.Decimal(...).quantize(Decimal("0.01"), ROUND_HALF_UP)` | Binary floats make both wrong on exact halves (probed) |
| DB transaction handling | A new connect/commit wrapper | `Database.transaction()` (exists) | Already handles the "SQLite may already have rolled back" case |
| Ticker validation | A second regex | `normalize_ticker` (backend), `tickerError`/`sanitizeTickerInput` (frontend) | Single source of truth, including the non-ASCII "ß"→"SS" trap |
| Tracked-ticker sync | Per-edge add/remove logic on sell or reset | `TickerTracker.reconcile()` diff | Handles sell-to-zero, reset re-sync and held-unwatched tickers structurally |
| `{"error": ...}` rendering | Per-route `JSONResponse` for 400s | `raise DomainError(msg)` | Handlers registered in `errors.py` |
| Error-message extraction on the client | Parsing `res.json()` in each component | `apiFetch` + `ApiError.message` | Already maps 422 and non-JSON bodies |
| Charts | Canvas or SVG line drawing for P&L | Lightweight Charts `BaselineSeries` | PLAN §10 |
| Treemap | An npm treemap library | In-house `squarify()` | PLAN §10 forbids other chart libraries |

**Key insight:** almost all of Phase 2's correctness sits in about 150 lines of backend service code that already has the lock, transaction and reconcile primitives. The work is composing them in the right order with the right rounding points, not writing infrastructure.

## Runtime State Inventory

Not a rename or refactor phase, so this section is omitted. One related note: existing dev databases (`db/finally.db`, the Docker `finally-data` volume) already contain the full schema from Phase 1 (`schema.sql` created all six tables, including `positions`, `trades` and `chat_messages`, with `CREATE TABLE IF NOT EXISTS`) [VERIFIED: backend/app/db/schema.sql:5-62]. No migration is needed.

## Common Pitfalls

### Pitfall 1: Deadlock from re-acquiring `state_lock`
**What goes wrong:** A trade request hangs forever (no error, no log), and every later watchlist edit, trade and snapshot hangs behind it.
**Why it happens:** `SnapshotRecorder.record()` does `async with self._lock:` [VERIFIED: backend/app/snapshots.py:49-52], and `asyncio.Lock` is not reentrant. `01-04-SUMMARY.md` line 217 suggests "call `recorder.record()` after trades and reset", which deadlocks if done inside the trade's critical section.
**How to avoid:** Extract `insert_snapshot(conn, cache) -> float` from `SnapshotRecorder._record_tx` and call it inside the trade or reset transaction. `record()` keeps taking the lock for the 30s loop.
**Warning signs:** A test hangs instead of failing. Add `asyncio.wait_for(..., timeout=2)` around service calls in tests.

### Pitfall 2: Float noise and banker's rounding in money
**What goes wrong:** Cash shows `8095.000000000002`, or a $0.125 notional debits $0.12 in one place and $0.13 in another.
**How to avoid:** Use the Pattern 2 rounding points in a single `money.py`. Test exact-half notionals (for example qty 0.0005 × $250.00 = $0.125 → $0.13) and 100 sequential small trades with no drift.
**Edge case to decide:** A tiny trade whose notional rounds to $0.00 (for example 0.0001 × $10.00 = $0.001) would move shares with no cash. See Open Question 1.

### Pitfall 3: NaN, Infinity and coerced values pass the request model
**What goes wrong:** `{"quantity": NaN}` → `round(nan, 4)` is `nan`, which fails `> 0` (OK). But `Infinity` passes `> 0`, and `1e400` parses as `inf`. Pydantic lax mode also turns `"10"` into `10.0` and `true` into `1.0`.
**Evidence (this session, FastAPI 0.162.0 / Pydantic 2.12.5)** [VERIFIED: TestClient probe]:
```
{"quantity": NaN, ...}      200 {"q":"nan"}
{"quantity": Infinity, ...} 200 {"q":"inf"}
{"quantity": "10", ...}     200 {"q":"10.0"}
{"quantity": true, ...}     200 {"q":"1.0"}
{"quantity": 1e400, ...}    200 {"q":"inf"}
```
**How to avoid:** First check in the service: `if not math.isfinite(quantity): raise DomainError("Quantity must be a positive number.")`. Do it in the service, not the model, so the Phase 3 executor gets the same check. Accepting `"10"` and `true` is harmless; leave lax mode alone unless the planner wants `StrictFloat` (which would make those 422s).

### Pitfall 4: Quantity float noise and the dust rule
**What goes wrong:** Buying 0.1 then 0.2 stores `0.30000000000000004`. Selling 0.3 then leaves `5.5e-17`. That is below 1e-6, so the dust rule deletes it, which hides the bug but corrupts intermediate states. Without the rounding, `quantity` shows float noise in the positions table and in the Phase 3 LLM context.
**How to avoid:** `new_qty = round_qty(old + qty)` and `remaining = round_qty(held - sold)`. Then dust (`remaining < 1e-6`) is effectively "remaining == 0". Sell check: `qty > held + 1e-6` → reject; otherwise `sold = min(qty, held)` (G-10 clamp), and log `sold` (not the requested qty) in `trades`.

### Pitfall 5: MD-08 selection snaps back for unwatched held tickers
**What goes wrong:** Clicking a position (or tile) for a ticker that is held but not on the watchlist charts it. On the next `setEntries` (any watchlist add or remove, or a reconnect re-fetch) the selection silently jumps to the first watchlist ticker.
**Why it happens:** `nextSelection` returns `selected` only if `tickers.includes(selected)`, else `tickers[0] ?? null` [VERIFIED: frontend/src/domain/market.ts:70-73], and `setEntries` always calls it with the watchlist tickers [VERIFIED: frontend/src/store/watchlist.ts:36-43].
**How to avoid:** Make the "valid selection" set watchlist ∪ held. For example, change the signature to `nextSelection(valid: readonly string[], selected)` and have the caller pass `[...watchlistTickers, ...heldTickers]`. Keep the stores free of circular imports: put the wiring in `Terminal`'s effect (or a small `src/store/sync.ts`) that subscribes to both stores and re-reconciles the selection when either list changes. Also handle the reverse case: selling an unwatched, selected ticker to zero must fall back to the first watchlist ticker. `ChartPanel` already copes with a selection that has no watchlist entry: price and open fall back from `tick` [VERIFIED: frontend/src/components/ChartPanel.tsx:41-46, 187-188].

### Pitfall 6: Duplicate-second snapshot times crash the P&L chart
**What goes wrong:** `recorded_at` has one-second precision (`now_iso()` uses `"%Y-%m-%dT%H:%M:%SZ"` [VERIFIED: backend/app/db/__init__.py:28-30]). A trade snapshot plus a 30s snapshot, or two rapid trades, can share a second. LWC's `setData` asserts `data must be asc ordered by time` [VERIFIED: node_modules/lightweight-charts/dist/lightweight-charts.development.mjs:12641].
**How to avoid:** `toSnapshotSeries` collapses equal seconds (last value wins) and drops out-of-order ones. Unit-test it with duplicate and reversed inputs.

### Pitfall 7: Percent units
`unrealized_pnl_percent` is already in percent (PLAN example `0.0105` = 0.0105%). Display it with `formatPct` from `@/domain/market` (2dp, sign, `-0.00`→`+0.00%` [VERIFIED: frontend/src/domain/market.ts:29-35]) and never multiply by 100. Compute the live value as `(price-avg)/avg*100`.

### Pitfall 8: Zustand v5 selectors returning fresh objects
**What goes wrong:** "Maximum update depth exceeded" or a frozen tab when a selector builds an array or object (`usePortfolio(s => s.positions.map(...))`, `usePrices(s => ({a: s.x, b: s.y}))`).
**Why it happens:** v5 uses `useSyncExternalStore` with reference equality; a new reference on every call loops [CITED: zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5]. `useShallow` exists in the installed version [VERIFIED: node_modules/zustand/shallow.d.ts / react/shallow.d.ts `export declare function useShallow`].
**How to avoid:** Select raw fields separately and derive with `useMemo` (Pattern F1).

### Pitfall 9: Existing Terminal tests assume one endpoint and the placeholders
**What goes wrong:** `terminal.test.tsx` stubs `fetch` to return the same body (`{tickers: ...}`) for every URL. It asserts the placeholder text `"Heatmap — coming in Phase 2"`, `"P&L — coming in Phase 2"` and `"Positions & Trade — coming in Phase 2"`, and in one test it counts total fetch calls [VERIFIED: grep of frontend/src/components/terminal.test.tsx lines 40-41, 315-327, 410]. Adding portfolio, history and trades fetches on mount breaks these tests, and a store that trusts the shape gets `{tickers}` as a portfolio.
**How to avoid:** Plan explicit updates: a URL-routing fetch stub, replaced placeholder assertions, and call counts filtered by URL. Make the loaders tolerant of malformed bodies (`Array.isArray(res?.positions)`), as `ChartPanel` does for history.

### Pitfall 10: `install_api_not_found` shadows routes registered after it
The catch-all `/api/{path:path}` covers every method. A portfolio router included after it is unreachable (always a 404) [VERIFIED: backend/app/main.py:99-120].

### Pitfall 11: Reconnect resync covers only the watchlist
`Terminal` re-fetches the watchlist when the stream reopens after a drop [VERIFIED: frontend/src/components/Terminal.tsx:40-58]. After a backend restart, the portfolio, history and trades also need re-fetching in that same subscription, or the header shows stale cash.

### Pitfall 12: The no-price message with Massive mode
With Massive, a just-added watchlist ticker has no price until the next poll. A buy then fails with PLAN's verbatim "No price available for {ticker}. Add it to your watchlist first.", which reads oddly when the ticker is already watched. Keep the verbatim text (PLAN and TRD-01 lock it). Only note it for UAT.

## Code Examples

### `money.py` (pure)
```python
# Source: stdlib decimal docs (quantize / ROUND_HALF_UP); behavior probed in backend venv this session
from __future__ import annotations

import math
from decimal import ROUND_HALF_UP, Decimal

_CENT = Decimal("0.01")
_QTY = Decimal("0.0001")


def to_cents(value: float) -> float:
    """Round a dollar amount half-up to cents."""
    return float(Decimal(str(value)).quantize(_CENT, rounding=ROUND_HALF_UP))


def round_qty(value: float) -> float:
    """Round a share quantity half-up to 4 dp (PLAN §7)."""
    return float(Decimal(str(value)).quantize(_QTY, rounding=ROUND_HALF_UP))


def notional(quantity: float, price: float) -> float:
    """Exact quantity × price, rounded half-up to cents (inputs are 4 dp and 2 dp)."""
    return float((Decimal(str(quantity)) * Decimal(str(price))).quantize(_CENT, rounding=ROUND_HALF_UP))


def is_valid_quantity(value: float) -> bool:
    return math.isfinite(value) and round_qty(value) > 0
```

### Trade transaction core (inside `TradeService`)
```python
# Composes existing seams: Database.transaction(), normalize_ticker, DomainError, PriceCache.get_price
DUST = 1e-6

async def execute(self, raw_ticker: str, quantity: float, side: str) -> TradeResult:
    ticker = normalize_ticker(raw_ticker)                       # DomainError 400
    side = side.strip().lower() if isinstance(side, str) else ""
    if side not in ("buy", "sell"):
        raise DomainError("Side must be 'buy' or 'sell'.")
    if not math.isfinite(quantity):
        raise DomainError("Quantity must be a positive number.")
    qty = round_qty(quantity)
    if qty <= 0:
        raise DomainError("Quantity must be greater than 0.")   # also covers 0.00004 → 0
    async with self._lock:
        trade = await asyncio.to_thread(self._trade_tx, ticker, qty, side)
        await self._tracker.reconcile_quietly(f"{side} {ticker}")   # sell-to-zero of unwatched → removed
        portfolio = await asyncio.to_thread(self._portfolio.view_sync)
    logger.info("Trade: %s %s %s @ %s", side, trade.quantity, ticker, trade.price)
    return TradeResult(trade=trade, portfolio=portfolio)

def _trade_tx(self, ticker: str, qty: float, side: str) -> Trade:
    price = self._cache.get_price(ticker)                       # read under the lock
    if price is None:
        raise DomainError(f"No price available for {ticker}. Add it to your watchlist first.")
    with self._db.transaction() as conn:
        (cash,) = conn.execute("SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)).fetchone()
        pos = conn.execute("SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
                           (DEFAULT_USER_ID, ticker)).fetchone()
        held, avg = (pos["quantity"], pos["avg_cost"]) if pos else (0.0, 0.0)
        if side == "buy":
            cost = notional(qty, price)
            if cost > cash:
                raise DomainError(f"Insufficient cash (need ${cost:,.2f}, have ${cash:,.2f}).")
            new_qty = round_qty(held + qty)
            new_avg = (held * avg + qty * price) / (held + qty)
            new_cash = to_cents(cash - cost)
            filled = qty
            # UPSERT position (UNIQUE(user_id, ticker)): INSERT ... ON CONFLICT(user_id, ticker) DO UPDATE
        else:
            if qty > held + DUST:
                raise DomainError(f"Insufficient shares (selling {qty:g} {ticker}, hold {held:g}).")
            filled = min(qty, held)
            remaining = round_qty(held - filled)
            new_cash = to_cents(cash + notional(filled, price))
            # remaining < DUST → DELETE position row; else UPDATE quantity (avg unchanged)
        # UPDATE users_profile cash; INSERT trades row (uuid4, side, filled, price, now_iso())
        insert_snapshot(conn, self._cache)                      # PF-02, no lock re-entry
    return Trade(...)
```
Error-message wording is your call. Phase 3 (AI-08) builds notes like `⚠️ Couldn't buy 50 TSLA: insufficient cash (need $12,450.00, have $8,095.00).`, so keep the `need $X, have $Y` fragment and a capitalized, period-terminated sentence that Phase 3 can lower-case after the colon. The `$` format: `f"{x:,.2f}"` gives `12,450.00`.

The position UPSERT works because `positions` has `UNIQUE (user_id, ticker)` [VERIFIED: backend/app/db/schema.sql:19-27]. SQLite 3.53.1 supports `ON CONFLICT(...) DO UPDATE` [VERIFIED: sqlite3 version probe; UPSERT exists since 3.24].

### Concurrency test (rapid repeated clicks)
```python
async def test_parallel_buys_never_overspend(trade_service, cache):
    cache.update("AAPL", 600.00)
    results = await asyncio.gather(
        *(trade_service.execute("AAPL", 1, "buy") for _ in range(20)), return_exceptions=True
    )
    ok = [r for r in results if not isinstance(r, Exception)]
    assert len(ok) == 16                                  # 16 × 600 = 9,600 ≤ 10,000
    assert all(isinstance(r, DomainError) for r in results if r not in ok)
    assert portfolio_cash() == 400.00                     # exact, to the cent
    assert count_trades() == 16 and count_snapshots_after_start() == 16
```
Build the service with a `RecordingSource` (it never writes the cache [VERIFIED: backend/tests/conftest.py:22-53]) so the price is fixed. For route tests, write prices into `client.app.state.cache` while using `make_app(source_factory=lambda cache: recording_source())`.

### Squarify (pure TS)
```ts
// Source: Bruls, Huizing, van Wijk, "Squarified Treemaps" (2000), the standard algorithm
export interface TreemapInput { key: string; value: number }
export interface Tile { key: string; x: number; y: number; w: number; h: number }
type Cell = { key: string; area: number };

function worst(row: Cell[], side: number): number {
  let sum = 0, max = 0, min = Infinity;
  for (const c of row) { sum += c.area; max = Math.max(max, c.area); min = Math.min(min, c.area); }
  const s2 = sum * sum, side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

export function squarify(items: readonly TreemapInput[], width: number, height: number): Tile[] {
  const cells = items.filter((i) => Number.isFinite(i.value) && i.value > 0).sort((a, b) => b.value - a.value);
  const total = cells.reduce((s, c) => s + c.value, 0);
  if (!(total > 0) || !(width > 0) || !(height > 0)) return [];
  const scale = (width * height) / total;
  const queue: Cell[] = cells.map((c) => ({ key: c.key, area: c.value * scale }));
  const out: Tile[] = [];
  let x = 0, y = 0, w = width, h = height;
  let row: Cell[] = [];
  const layout = () => {
    const sum = row.reduce((s, c) => s + c.area, 0);
    if (w >= h) {                         // column on the left, spanning height h
      const cw = sum / h; let cy = y;
      for (const c of row) { const ch = c.area / cw; out.push({ key: c.key, x, y: cy, w: cw, h: ch }); cy += ch; }
      x += cw; w = Math.max(0, w - cw);
    } else {                              // row on top, spanning width w
      const rh = sum / w; let cx = x;
      for (const c of row) { const cw = c.area / rh; out.push({ key: c.key, x: cx, y, w: cw, h: rh }); cx += cw; }
      y += rh; h = Math.max(0, h - rh);
    }
    row = [];
  };
  for (let i = 0; i < queue.length; ) {
    const side = Math.min(w, h);
    const next = [...row, queue[i]];
    if (row.length === 0 || worst(next, side) <= worst(row, side)) { row = next; i++; }
    else layout();
  }
  if (row.length) layout();
  return out;
}
```
Unit tests: the tile count equals the count of positive values; the sum of tile areas ≈ `width*height` (within 1e-6); every tile lies within bounds; the input order of equal weights doesn't change the area per key; empty, zero and NaN inputs give `[]`; one item fills the whole rect.

### Snapshot series (pure TS)
```ts
export function toSnapshotSeries(snaps: readonly Snapshot[]): { time: UTCTimestamp; value: number }[] {
  const out: { time: UTCTimestamp; value: number }[] = [];
  for (const s of snaps) {
    const t = Math.floor(Date.parse(s.recorded_at) / 1000);
    if (!Number.isFinite(t) || !Number.isFinite(s.total_value)) continue;
    const last = out[out.length - 1];
    if (last && t < last.time) continue;                       // out of order: drop
    if (last && t === last.time) { last.value = s.total_value; continue; }  // same second: keep last
    out.push({ time: t as UTCTimestamp, value: s.total_value });
  }
  return out;
}
```

### Wire types to freeze in `src/api/types.ts`
```ts
export interface Position { ticker: string; quantity: number; avg_cost: number; current_price: number;
  market_value: number; unrealized_pnl: number; unrealized_pnl_percent: number; weight: number }
export interface Portfolio { cash_balance: number; positions_value: number; total_value: number;
  unrealized_pnl: number; positions: Position[] }
export type Side = "buy" | "sell";
export interface Trade { id: string; ticker: string; side: Side; quantity: number; price: number; executed_at: string }
export interface TradeResponse { trade: Trade; portfolio: Portfolio }
export interface Snapshot { total_value: number; recorded_at: string }
export interface SnapshotsResponse { snapshots: Snapshot[] }
export interface TradesResponse { trades: Trade[] }   // GET /api/trades (TRD-10 extra; not in PLAN §8)
```
Keys follow PLAN §8 verbatim. Add a backend exact-key test (`set(body) == {...}`) for each response, as the ROADMAP "Parallel work" note requires.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zustand v4 tolerant of fresh-reference selectors | v5 `useSyncExternalStore`: fresh references loop; use `useShallow` or separate selectors | Zustand 5.0 | Pitfall 8 |
| LWC v4 `chart.addLineSeries()` / `addBaselineSeries()` | LWC v5 `chart.addSeries(BaselineSeries, opts)` | Lightweight Charts 5.0 | Use the v5 form, like `ChartPanel` (`chart.addSeries(AreaSeries, ...)`) |
| Python sqlite3 legacy implicit transactions | `isolation_level=None` + explicit `BEGIN IMMEDIATE` (already in `Database`) | Project decision, Phase 1 | No implicit-transaction surprises |

**Deprecated/outdated:** `.planning/research/ARCHITECTURE.md`'s `app/portfolio/` package and `Commands` class. The real Phase 1 code uses flat services (`WatchlistService`, `TickerTracker`, `SnapshotRecorder`) that share `state_lock`, so follow that.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GET /api/trades` returns `{"trades": [...]}` with the same keys as `trade` in PLAN §8, newest first, limited to 100 | Pattern 5, types | The endpoint is an "extra" outside PLAN §8; E2E (Phase 3) and the panel depend on the shape. Low risk; confirm the limit |
| A2 | Buy and Sell should be disabled while a trade request is in flight | Pattern F2 | Without it, rapid clicks queue N trades. Still correct server-side, but a UX choice |
| A3 | Bottom-row layout: positions table + trade bar and trade history side by side (not tabs), so a new trade is visible "at the top of the trade history panel" | Layout | Grid change; UX-02 is verified in Phase 3 |
| A4 | Server rounds `avg_cost` and `weight` to 4dp on the wire; `avg_cost` is stored at full precision | Pattern 2/3 | PF-01 only fixes `*_percent` to 4dp; a different choice changes displayed values only beyond 2dp |
| A5 | `TradeRequest.side: str` validated in the service (400), not `Literal` (422) | Pattern 5 | PLAN §8 doesn't say whether a bad side is a business or a body error; tests must match the choice |
| A6 | Squarify label threshold and the neutral color `#30363d` for ~0% P&L | Pattern F4 | Visual only |
| A7 | The reset route should require a JSON content type, as a CSRF guard (see Security) | Security | Not in PLAN or requirements; Phase 3 Playwright `request.post('/api/reset')` must then send `data: {}` |

## Open Questions

1. **Trades whose notional rounds to $0.00**
   - What we know: TRD-01 rejects quantities that round to 0 at 4dp. 0.0001 × $10.00 = $0.001 → cost $0.00, so shares move for free (and the reverse on sell).
   - What's unclear: whether to reject them ("Order value must be at least $0.01").
   - Recommendation: reject in the service with a 400. It's one line, keeps "cash moves by exactly the trade cost" meaningful, and is invisible for realistic orders. The planner should confirm, because it goes beyond the requirement text.

2. **Should Phase 2 reset also clear sparklines and chart selection?**
   - What we know: the ROADMAP assigns that to PF-10 (Phase 3). Phase 2's PF-09 refreshes the portfolio and watchlist panels. Ghost tickers vanish anyway because `ingestFrame` replaces the map.
   - Recommendation: stick to the roadmap. Phase 2 refetches portfolio, watchlist, history and trades after reset. Leave sparkline and selection clearing to PF-10.

3. **P&L chart series type**
   - Recommendation: `BaselineSeries` at `STARTING_CASH` (green above, red below), with `pointMarkersVisible` for a single point. Fall back to `AreaSeries` to match the main chart if the UI phase prefers visual consistency.

4. **Buy and Sell button colors**
   - PLAN reserves purple `#753991` for submit buttons. Trading terminals conventionally use green Buy and red Sell.
   - Recommendation: Buy uses the `up` token and Sell the `down` token (the semantic meaning wins), with purple kept for form-submit actions (the watchlist `+`). Settle this in `/gsd-ui-phase 2` (the `workflow.ui_phase: true` config means a UI-SPEC step may run), or the planner should mark it as discretion.

5. **`/api/portfolio/history` growth**
   - About 2,900 rows/day; PLAN says never prune. Return them all for v1. If a long-running demo shows lag, downsample client-side later.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python (backend venv) | Backend services and tests | ✓ | 3.12.15 | — |
| uv | `uv run --directory backend ...` | ✓ | 0.13.0 | — |
| SQLite (linked) | UPSERT, `BEGIN IMMEDIATE`, WAL | ✓ | 3.53.1 | — |
| Node | Frontend build and tests | ✓ | v22.23.4 (`engines` `^22.22.0`) | — |
| npm | `npm --prefix frontend ...` | ✓ | 10.9.9 | — |
| Docker CLI | Container smoke and UAT | ✓ (client) | 29.8.0 | Daemon not probed; UAT can use local uvicorn + `next build` export |
| Baseline suites | Regression gate | ✓ | backend **258 passed**; frontend **117 passed (7 files)**, both run this session | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none (Docker daemon state unknown; not needed for automated verification).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Backend framework | pytest 9.0.2 + pytest-asyncio (`asyncio_mode = "auto"`), FastAPI `TestClient` |
| Backend config | `backend/pyproject.toml` `[tool.pytest.ini_options]` (`testpaths = ["tests"]`) |
| Frontend framework | Vitest ^5.0.5 + Testing Library + jsdom, `FakeEventSource`, ResizeObserver stub |
| Frontend config | `frontend/vitest.config.mts` (`include: ["src/**/*.test.{ts,tsx}"]`), `frontend/vitest.setup.ts` |
| Quick run (backend) | `uv run --directory backend --extra dev pytest -q -x tests/test_trading.py tests/test_money.py` |
| Quick run (frontend) | `npm --prefix frontend test -- src/domain` |
| Full suite | `uv run --directory backend --extra dev pytest -q` · `uv run --directory backend --extra dev ruff check app tests` · `uv run --directory backend --extra dev ruff format --check app tests` · `npm --prefix frontend test` · `npm --prefix frontend run lint` · `npm --prefix frontend run typecheck` · `npm --prefix frontend run build` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRD-01 | normalize ticker; qty finite, > 0, 4dp, rounds-to-0 rejected; no-price message verbatim; NaN/inf rejected | unit | `uv run --directory backend --extra dev pytest -q tests/test_trading.py -k "validation or price"` | ❌ Wave 0 |
| TRD-02 | buy insufficient cash; weighted avg cost; "buy max" succeeds | unit | `... pytest -q tests/test_trading.py -k buy` | ❌ Wave 0 |
| TRD-03 | oversell rejected; within-tolerance clamp; avg unchanged; dust deletes row; sell at a loss | unit | `... pytest -q tests/test_trading.py -k sell` | ❌ Wave 0 |
| TRD-04 | half-up cents; no drift over 100 trades; qty noise rounded | unit | `... pytest -q tests/test_money.py tests/test_trading.py -k round` | ❌ Wave 0 |
| TRD-05 | 20 parallel buys → exact count and exact cash; failed trade leaves no row or snapshot; snapshot written per trade; no deadlock (`wait_for`) | unit/async | `... pytest -q tests/test_trading.py -k "concurrent or atomic or snapshot"` | ❌ Wave 0 |
| TRD-06 | 200 shape (exact keys); 400 envelope; 422 on missing field or wrong type | integration | `... pytest -q tests/test_portfolio_api.py -k trade` | ❌ Wave 0 |
| TRD-07/08/09 | TradeBar posts the body; error inline and cleared on edit; 422 generic; success text from `trade.price`, auto-clears (fake timers); qty cleared, ticker kept | component | `npm --prefix frontend test -- src/components/TradeBar.test.tsx` | ❌ Wave 0 |
| TRD-10 | `GET /api/trades` newest first, keys; panel renders, new trade on top | integration + component | `... pytest -q tests/test_portfolio_api.py -k trades` · `npm --prefix frontend test -- src/components/TradeHistory.test.tsx` | ❌ Wave 0 |
| WL-06 | remove held ticker from watchlist → still tracked; sell unwatched to zero → removed; buy keeps tracked; reset re-syncs | unit/integration | `... pytest -q tests/test_tracker.py tests/test_trading.py tests/test_reset.py -k tracked` | partial (test_tracker.py exists) |
| PF-01 | valuation shape; avg-cost fallback; weight 0-safe; percent 4dp; totals add up | unit + integration | `... pytest -q tests/test_valuation.py tests/test_portfolio_api.py -k portfolio` | ❌ Wave 0 |
| PF-02 | snapshot at startup (exists), loop (exists), after trade, after reset | integration | `... pytest -q tests/test_snapshots.py tests/test_trading.py tests/test_reset.py -k snapshot` | partial |
| PF-03 | history oldest first | integration | `... pytest -q tests/test_portfolio_api.py -k history` | ❌ Wave 0 |
| PF-04/05 | header total, cash, P&L since start update on SSE frame (FakeEventSource) without fetching `/api/portfolio`; `data-sign` | component | `npm --prefix frontend test -- src/components/header.test.tsx src/domain/portfolio.test.ts` | ❌ Wave 0 |
| PF-06 | rows recompute on frame; 2dp percent with no ×100; colors and `data-sign` | component | `npm --prefix frontend test -- src/components/PositionsTable.test.tsx` | ❌ Wave 0 |
| PF-07 | squarify invariants; color clamp ±5%; empty-state text; tiny tile tooltip | unit + component | `npm --prefix frontend test -- src/domain/treemap.test.ts src/components/Heatmap.test.tsx` | ❌ Wave 0 |
| PF-08 | ISO→sec dedupe; single point → `pointMarkersVisible`; 30s refetch (fake timers); refetch after trade | unit + component (LWC mocked like ChartPanel.test) | `npm --prefix frontend test -- src/domain/pnl.test.ts src/components/PnlChart.test.tsx` | ❌ Wave 0 |
| PF-09 | reset txn restores cash, watchlist and order, clears 4 tables, one fresh snapshot, takes the lock; button calls `window.confirm` and refetches | integration + component | `... pytest -q tests/test_reset.py` · `npm --prefix frontend test -- src/components/header.test.tsx -t reset` | ❌ Wave 0 |
| MD-08 | row and tile click selects; unwatched held selection survives `setEntries`; falls back when the position is gone | unit + component | `npm --prefix frontend test -- src/domain/market.test.ts src/components/PositionsTable.test.tsx` | partial (market.test.ts exists) |

Manual-only: visual density and colors of the heatmap and P&L chart, plus a real-browser rapid-click check against a running container. Run these in `/gsd-verify-work` UAT.

### Sampling Rate
- **Per task commit:** the quick command for the touched area (backend file or frontend file filter).
- **Per wave merge:** the full backend pytest + ruff, and the full frontend test + lint + typecheck.
- **Phase gate:** the full suite, including `npm --prefix frontend run build` (catches browser-API-at-render mistakes in the static export), green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `backend/tests/test_money.py`, `test_valuation.py`, `test_trading.py`, `test_portfolio_api.py`, `test_reset.py`
- [ ] Shared fixture in `backend/tests/conftest.py`: a `services` or `trade_env` fixture (db + `PriceCache` + `RecordingSource` + `TickerTracker` + shared `asyncio.Lock` + `TradeService`), plus a helper to seed prices
- [ ] `frontend/src/domain/portfolio.test.ts`, `treemap.test.ts`, `pnl.test.ts`
- [ ] `frontend/src/components/TradeBar.test.tsx`, `PositionsTable.test.tsx`, `Heatmap.test.tsx`, `PnlChart.test.tsx`, `TradeHistory.test.tsx`, `header.test.tsx`
- [ ] Update `frontend/src/components/terminal.test.tsx` (URL-routing fetch stub, replace the "coming in Phase 2" assertions, filter fetch counts by URL), as described in Pitfall 9
- [ ] A shared URL-routing `stubFetch` helper in `frontend/src/test/` would save duplication across the new component tests

No framework installs are needed.

## Security Domain

`security_enforcement: true`, ASVS level 1, `security_block_on: high` [VERIFIED: .planning/config.json].

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user, no login by design (PLAN §2); documented as unsupported on public networks |
| V3 Session Management | no | No sessions |
| V4 Access Control | no (single user) | `user_id = 'default'` hardcoded; never take `user_id` from the request |
| V5 Input Validation | **yes** | `normalize_ticker` (regex + ASCII), service checks for finite or positive qty and `side`, Pydantic types for 422, parameterized SQL only |
| V6 Cryptography | no | No secrets in this phase; `uuid4` for ids is not a security token |
| V13 API / web service | yes | JSON content type on state-changing routes (see CSRF row) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via ticker or side | Tampering | `?` placeholders everywhere (the Phase 1 pattern); the ticker is regex-validated before use |
| Non-finite or huge quantity (`NaN`, `Infinity`, `1e400`) | Tampering / DoS of the math | `math.isfinite` + `> 0` after rounding in the service (Pitfall 3, probed) |
| Race to overspend (parallel requests) | Tampering | `state_lock` + `BEGIN IMMEDIATE`; concurrency test |
| Client-supplied price | Tampering | The request has no price field; the fill comes from `PriceCache` under the lock |
| Cross-site request to `POST /api/reset` | Tampering (CSRF) | Probed this session: FastAPI parses a model body only for `application/json`, so a cross-site `text/plain` POST to the **trade** route gets 422 [VERIFIED: TestClient probe, "trade text/plain 422"]. A body-less **reset** route returned 200 to a `text/plain` POST [VERIFIED: probe, "reset text/plain 200"], so any web page the user visits could reset the account. Mitigation: have the reset route reject requests without `Content-Type: application/json` (400 or 415). `apiFetch` always sends that header [VERIFIED: frontend/src/api/client.ts:37-44]. Cross-origin JS can't send it without a CORS preflight, which fails because CORS is off outside dev. The impact is low (fake money), so this is a recommendation (A7). Phase 3's Playwright reset calls must send `data: {}` |
| XSS through ticker or messages | Tampering | React escapes text; no `dangerouslySetInnerHTML`; tickers are regex-constrained |
| Information leak in 500s | Information disclosure | Business errors are 400s with curated text; unexpected exceptions keep FastAPI's generic 500; log with `logger.exception` |

## Sources

### Primary (HIGH confidence)
- Repository code read this session: `backend/app/{main,config,errors,tickers,tracker,snapshots,watchlist}.py`, `backend/app/db/{__init__.py,schema.sql,seed.py}`, `backend/app/api/{__init__,watchlist,system}.py`, `backend/app/market/cache.py`, `backend/app/market/simulator.py` (add/remove), `backend/app/market/massive_client.py` (remove), `backend/tests/{conftest,test_tracker,test_snapshots}.py`, `frontend/src/{components/Terminal,Header,ChartPanel,Watchlist}.tsx`, `frontend/src/store/{prices,watchlist}.ts`, `frontend/src/api/{client,types,ticker}.ts`, `frontend/src/domain/{market,chart}.ts`, `frontend/src/app/globals.css`, `frontend/vitest.setup.ts`, `frontend/vitest.config.mts`, `frontend/package.json`, `backend/pyproject.toml`
- Runtime probes in the backend venv: float vs `Decimal` rounding; FastAPI 0.162.0 / Pydantic 2.12.5 acceptance of NaN, Infinity, `"10"`, `true` and `1e400`; content-type handling for model and body-less POST routes; SQLite 3.53.1
- `node_modules/lightweight-charts/dist/typings.d.ts` (5.2.1): `BaselineSeries`, `baseValue`, `pointMarkersVisible`; `lightweight-charts.development.mjs:12641`: the ascending-time assertion
- `node_modules/zustand` 5.0.16: `useShallow` export
- Suite baselines run this session: backend 258 passed; frontend 117 passed
- Planning docs: `planning/PLAN.md` §6–§8, §10; `.planning/REQUIREMENTS.md`; `.planning/ROADMAP.md`; `.planning/STATE.md`; Phase 1 `01-CONTEXT.md`, `01-04-SUMMARY.md`, `01-07-SUMMARY.md`, `01-VERIFICATION.md`, `01-UAT.md`, `01-REVIEW-DISPOSITION.md`; `.planning/research/{FEATURES,PITFALLS,ARCHITECTURE}.md` (G-03, G-06..G-10, G-12, G-16)

### Secondary (MEDIUM confidence)
- [Zustand: migrating to v5](https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5) — selectors returning new references can loop; use `useShallow`
- [Zustand v5.0.0 release notes](https://github.com/pmndrs/zustand/releases/tag/v5.0.0) and the [useShallow reference](https://zustand.docs.pmnd.rs/reference/hooks/use-shallow)

### Tertiary (LOW confidence)
- None relied on. The squarified algorithm (Bruls, Huizing & van Wijk, 2000) is cited from well-established literature; the code above is the standard formulation and gets its own invariant tests.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. No new packages; all versions were read from installed manifests or the runtime.
- Architecture: HIGH. Derived from the actual Phase 1 seams (lock, transaction, reconcile, stores) read this session.
- Pitfalls: HIGH for the deadlock, rounding, NaN, CSRF, selection-override and test-stub items (each verified in code or by a probe); MEDIUM for UI choices (A2, A3, A6).

**Research date:** 2026-10-27
**Valid until:** 2026-11-26 (stable stack, pinned versions)
