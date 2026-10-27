# Architecture Research

**Domain:** Single-container AI trading workstation (FastAPI + SSE + SQLite backend, Next.js static export frontend, LLM copilot with auto-executed structured actions)
**Researched:** 2026-10-23
**Confidence:** HIGH for backend integration (derived from the existing `backend/app/market/` code and PLAN.md); MEDIUM for frontend and tooling specifics (official docs and package source, cross-checked; the research seam rates web-fetched sources LOW by default, so those claims are marked where they matter)

This document answers: how do the remaining PLAN.md components attach to the existing market subsystem, what talks to what, how data moves, and in what order to build it.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────── Browser (Next.js static export) ────────────────────────────────┐
│                                                                                                   │
│  ┌──────────────┐   ┌───────────────────────────── Zustand stores ──────────────────────────────┐ │
│  │ PriceStream  │──>│ priceStore: ticks, sparklines, connection status                         │ │
│  │ (EventSource)│   │ portfolioStore: cash, positions, watchlist, snapshots                    │ │
│  └──────────────┘   │ chatStore: messages, pending       uiStore: selectedTicker              │ │
│  ┌──────────────┐   └───────────────┬───────────────────────────────────────────────────────────┘ │
│  │ api client   │──(REST results)──>│   selectors: livePortfolio = f(positions, cash, prices)    │
│  └──────────────┘                   v                                                             │
│  Header │ Watchlist+Sparklines │ PriceChart (LWC) │ Heatmap │ PnlChart (LWC) │ Positions │ Trade │ Chat │
└───────────────────────────────┬─────────────────────────────────────────┬───────────────────────┘
                                │ GET /api/stream/prices (SSE)            │ /api/* JSON
┌───────────────────────────────┴──── FastAPI (one process, one worker) ──┴───────────────────────┐
│  HTTP layer (router factories, no module state)                                                  │
│   stream_router (EXISTS) │ portfolio_router │ watchlist_router │ chat_router │ system_router      │
│   error envelope: DomainError -> {"error": ...}        StaticFiles("/" , html=True)  (mounted last)│
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Command layer (async; owns the mutation lock; the ONLY caller of source.add/remove_ticker)      │
│   Commands.trade / add_watch / remove_watch / reset      TickerTracker.reconcile()               │
│   ChatService (LLM call outside lock, action execution inside it)    SnapshotTask (30 s loop)    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Domain + persistence (sync, run via asyncio.to_thread)                                          │
│   rules.py (pure)  valuation.py (pure)  notes.py (pure)  │  repos: portfolio, watchlist, chat    │
│   db: connect() per unit of work, BEGIN IMMEDIATE txns, schema.sql + seed                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  Market subsystem (EXISTS, unchanged): MarketDataSource ──writes──> PriceCache <──reads── all    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  SQLite file at DB_PATH (/app/db/finally.db in volume finally-data)    LLM: LiteLLM -> OpenRouter│
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward: HTTP → commands → domain/repos → db, and everything may *read* `PriceCache`. Only market sources write to `PriceCache`. Only the command layer mutates the source's ticker set.

### Component Responsibilities

| Component | Owns | Implementation |
|-----------|------|----------------|
| `Settings` (`app/config.py`) | All env-derived config: `db_path`, `static_dir`, `llm_mock`, `openrouter_api_key`, optional dev CORS origin | Frozen dataclass built by `Settings.from_env()`; loads `../.env` with `python-dotenv` (`override=False`) first. Tests construct it directly. |
| `create_app(settings)` (`app/main.py`) | Building every dependency (unstarted), mounting routers, mounting static files, defining `lifespan` | App factory; `app = create_app()` at module bottom for `uvicorn app.main:app` |
| `lifespan` | Ordered startup and shutdown | init schema+seed → read tracked set → `source.start()` → initial snapshot → start snapshot task; shutdown reverses |
| `Database` (`app/db/`) | Schema, seed, connections, transactions | stdlib `sqlite3`, connection per unit of work, WAL, `busy_timeout`, explicit `BEGIN IMMEDIATE` |
| Domain rules (`app/portfolio/rules.py`) | Ticker normalization+regex, quantity rounding, buy/sell math, dust | Pure functions raising `TradeRejected(message)` |
| Valuation (`app/portfolio/valuation.py`) | Portfolio math: market value, P&L, P&L %, weight, total; avg-cost fallback | Pure function taking a `price_of(ticker) -> float | None` callable |
| Repositories | SQL for positions/cash/trades/snapshots, watchlist, chat messages | Plain functions taking a `sqlite3.Connection` |
| `Commands` (`app/commands.py`) | Every state mutation: trade, watchlist add/remove, reset; serialization; post-mutation tracker sync and snapshot | Async class holding an `asyncio.Lock`, `Database`, `PriceCache`, `MarketDataSource`, `TickerTracker` |
| `TickerTracker` | Invariant: source tickers == watchlist ∪ positions | `reconcile()` diffs the DB set against `source.get_tickers()` and awaits `add_ticker`/`remove_ticker` |
| `SnapshotTask` | 30 s portfolio snapshots | `asyncio.Task` built in lifespan; record = read cash+positions, value via `valuation`, insert |
| `ChatService` (`app/chat/`) | Chat pipeline: store user msg → context → LLM → execute actions via `Commands` → failure notes → store reply | Async; `LLMClient` protocol with `LiteLLMClient` and `MockLLMClient` chosen by `Settings.llm_mock` |
| Routers (`app/api/`) | HTTP shape only: parse, call command/service, serialize | `create_portfolio_router(...)`, `create_watchlist_router(...)`, `create_chat_router(...)`, `create_system_router(...)` |
| Error envelope (`app/api/errors.py`) | Map `DomainError` subclasses to `{"error": msg}` with 400/404/502/503 | `app.add_exception_handler` |
| `stream_router` (EXISTS) | `GET /api/stream/prices`, `GET /api/prices/{ticker}/history` | `create_stream_router(price_cache)`; mount as is |
| Static frontend | Serving `index.html`, `_next/*`, `404.html` | `StaticFiles(directory=static_dir, html=True)` mounted at `/` after all routers, only if `index.html` exists |
| Frontend `PriceStream` | One `EventSource`, connection state machine, frame dedupe | Module in `src/stream/`, started once from the root client component |
| Frontend stores | Client state; derived live valuation | Zustand 5 stores with selectors |
| Chart components | Lightweight Charts lifecycle | `useEffect`-created chart; `setData` on load, `update` on new ticks |

---

## Recommended Project Structure

### Backend (`backend/app/`)

```
backend/app/
├── __init__.py
├── main.py                 # create_app(settings) + lifespan + `app = create_app()`
├── config.py               # Settings.from_env(); dotenv loading; DB_PATH/STATIC_DIR defaults
├── errors.py               # DomainError, TradeRejected(400), NotFound(404), LLMUnavailable(503), LLMFailed(502)
├── commands.py             # Commands (mutation lock) + TickerTracker
├── market/                 # EXISTS: unchanged
├── db/
│   ├── __init__.py         # Database: connect(), transaction(), init() (schema + seed)
│   ├── schema.sql          # six tables, CREATE TABLE IF NOT EXISTS, UNIQUE(user_id, ticker)
│   └── seed.py             # DEFAULT_USER_ID, DEFAULT_CASH, DEFAULT_WATCHLIST; INSERT OR IGNORE
├── portfolio/
│   ├── rules.py            # normalize_ticker, validate_quantity, apply_buy, apply_sell (pure)
│   ├── valuation.py        # value_portfolio(cash, positions, price_of) (pure)
│   ├── repo.py             # cash, positions, trades, snapshots SQL
│   └── snapshots.py        # record_snapshot(), run_snapshot_loop()
├── watchlist/
│   └── repo.py             # list/add/remove SQL, default restore for reset
├── chat/
│   ├── schema.py           # Pydantic: LLMReply, TradeAction, WatchlistAction; ActionResult shapes
│   ├── llm.py              # LLMClient protocol, LiteLLMClient (cerebras skill), MockLLMClient, create_llm_client()
│   ├── prompt.py           # SYSTEM_PROMPT, build_context(), build_messages()
│   ├── notes.py            # failure-note templates (pure)
│   ├── repo.py             # chat_messages SQL
│   └── service.py          # ChatService.handle(message)
└── api/
    ├── errors.py           # exception handlers -> {"error": ...}; /api/{path} JSON 404 catch-all
    ├── models.py           # Pydantic request/response models mirroring PLAN §8
    ├── portfolio.py        # create_portfolio_router(commands, db, cache): portfolio, trade, history, reset
    ├── watchlist.py        # create_watchlist_router(commands, db, cache)
    ├── chat.py             # create_chat_router(chat_service, db)
    └── system.py           # create_system_router(): /api/health
backend/tests/
├── market/                 # EXISTS
├── conftest.py             # add: settings(tmp_path), app/client fixtures with LLM_MOCK and a fake source
├── portfolio/              # rules, valuation, repo, snapshots
├── watchlist/
├── chat/                   # parsing, mock rules, executor partial failure, notes
├── test_commands.py        # tracker invariants, concurrency, reset
└── api/                    # status codes and shapes per PLAN §8
```

### Frontend (`frontend/`)

```
frontend/
├── next.config.ts          # output: 'export', images.unoptimized: true; no rewrites
├── src/
│   ├── app/
│   │   ├── layout.tsx      # html/body, dark theme, fonts
│   │   ├── page.tsx        # 'use client' <Workstation/>: starts stream, initial fetches
│   │   └── globals.css     # Tailwind v4 @theme tokens (#0d1117, #ecad0a, #209dd7, #753991), flash classes
│   ├── api/                # NOT `lib/` (see gitignore pitfall below)
│   │   ├── client.ts       # apiFetch(): same-origin by default, NEXT_PUBLIC_API_BASE override; throws ApiError(status, error)
│   │   ├── endpoints.ts    # getPortfolio, postTrade, getWatchlist, addTicker, removeTicker, postChat, ...
│   │   └── types.ts        # TS types transcribed from PLAN §6/§8 (the contract)
│   ├── stream/
│   │   └── priceStream.ts  # connectPriceStream({onFrame, onStatus}, makeEventSource = (u) => new EventSource(u))
│   ├── store/
│   │   ├── prices.ts       # ticks, lastTs per ticker, sparkline buffers, connection status
│   │   ├── portfolio.ts    # server snapshot of cash/positions, watchlist, snapshots; refresh actions
│   │   ├── chat.ts         # messages, pending flag
│   │   └── ui.ts           # selectedTicker
│   ├── domain/             # pure, unit-tested
│   │   ├── livePortfolio.ts# positions + cash + prices -> rows, totals, weights
│   │   ├── treemap.ts      # squarified layout
│   │   ├── time.ts         # isoToUtcSeconds, dedupeBySecond
│   │   └── format.ts
│   ├── components/
│   │   ├── header/         # Header, ConnectionDot, ResetButton
│   │   ├── watchlist/      # WatchlistPanel, WatchlistRow (flash), Sparkline (SVG polyline), AddTicker
│   │   ├── charts/         # useLightweightChart, PriceChart, PnlChart
│   │   ├── portfolio/      # Heatmap, PositionsTable
│   │   ├── trade/          # TradeBar
│   │   └── chat/           # ChatPanel, ChatMessage, ActionList
│   └── test/               # FakeEventSource, fixtures matching api/types.ts
└── vitest.config.ts        # jsdom; React Testing Library
```

### Repository root additions

```
Dockerfile                  # node:20-slim (or 22) build -> python:3.12-slim + uv; COPY out -> /app/static
docker-compose.yml          # build, 8000:8000, env_file .env, volume finally-data:/app/db
.env.example
.dockerignore               # node_modules, .next, out, .venv, db/*.db, test/
db/.gitkeep
scripts/start_mac.sh stop_mac.sh start_windows.ps1 stop_windows.ps1
test/
├── docker-compose.test.yml # app (LLM_MOCK=true, no volume) + playwright (mcr.microsoft.com/playwright:v<ver>-noble)
├── package.json            # @playwright/test pinned to the image version
├── playwright.config.ts    # baseURL from env (http://app:8000)
└── e2e/*.spec.ts           # each test: request.post('/api/reset') in beforeEach
```

### Structure Rationale

- **Command layer separate from routers:** manual trades and LLM trades must share one code path (PLAN §7 "shared by manual trades and LLM trades"). If the trade logic lives in a route handler, the chat executor either calls HTTP internally or duplicates it. `Commands` is the one place that does validate → transact → reconcile tickers → snapshot.
- **Pure `rules.py` / `valuation.py`:** they hold the money math that PLAN §12 asks to test heavily (avg cost, dust, insufficient cash, fallback price). Pure functions test without a DB or event loop.
- **Repos take a connection:** a command opens one transaction and calls several repo functions inside it (cash, position, trade log), which is how PLAN §7's "one SQLite transaction" requirement is met.
- **`src/api/` instead of `src/lib/`:** the root `.gitignore` is the stock Python template and contains `lib/`. Verified with `git check-ignore`: `frontend/src/lib/api.ts` is ignored. Either name the folder something else or fix `.gitignore` in the first phase (both is safest).
- **`domain/` on the frontend:** live valuation and treemap layout are the riskiest frontend logic and are pure; they get unit tests that do not render React.

---

## Architectural Patterns

### Pattern 1: Construct in `create_app`, start in `lifespan`

**What:** The established router-factory pattern (`create_stream_router(price_cache)`) needs dependencies when routers are built, but PLAN §3 says all initialization happens in `lifespan`. Resolve this by building cheap, inert objects in `create_app()` (`PriceCache`, the unstarted source from `create_market_data_source`, `Database(path)`, `LLMClient`, `Commands`, `ChatService`), wiring routers with them, and doing all *work* in `lifespan` (schema, seed, `source.start`, snapshot, background task). Nothing is module-level except the final `app = create_app()`.
**When to use:** The app entry point. Tests call `create_app(Settings(db_path=tmp_path / "t.db", llm_mock=True, ...))` and enter `TestClient(app)` as a context manager so the lifespan runs.
**Trade-offs:** `create_market_data_source` reads env at construction, so `Settings.from_env()` (which loads `.env`) must run before it. Inject a fake source in tests via an optional `source` parameter on `create_app`.

```python
def create_app(settings: Settings | None = None, *, source: MarketDataSource | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    cache = PriceCache()
    source = source or create_market_data_source(cache)
    db = Database(settings.db_path)
    tracker = TickerTracker(db, source)
    commands = Commands(db, cache, tracker)
    chat = ChatService(db, cache, commands, create_llm_client(settings))

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await asyncio.to_thread(db.init)                        # schema.sql + INSERT OR IGNORE seed
        await source.start(await asyncio.to_thread(db.tracked_tickers))  # watchlist ∪ positions
        await commands.record_snapshot()                         # initial snapshot
        snap_task = asyncio.create_task(run_snapshot_loop(commands, 30.0), name="snapshot-loop")
        try:
            yield
        finally:
            snap_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await snap_task
            await source.stop()

    app = FastAPI(lifespan=lifespan)
    install_error_handlers(app)
    app.include_router(create_stream_router(cache))
    app.include_router(create_portfolio_router(commands, db, cache))
    app.include_router(create_watchlist_router(commands, db, cache))
    app.include_router(create_chat_router(chat, db))
    app.include_router(create_system_router())
    mount_static(app, settings.static_dir)                       # LAST; skipped if no index.html
    return app

app = create_app()
```

Note: `app = create_app()` at import means importing `app.main` in tests builds a real app from env. Keep tests importing `create_app` and building their own.

### Pattern 2: Async command layer with one mutation lock; sync DB work off the loop

**What:** Every mutation goes through `Commands`, which holds an `asyncio.Lock`. Inside the lock: run the DB transaction in a worker thread (`asyncio.to_thread`), then reconcile tracked tickers **on the event loop**, then record a snapshot.
**When to use:** Trade, watchlist add/remove, reset, and each action the chat executor runs.
**Why the loop matters:** `SimulatorDataSource.add_ticker` mutates `GBMSimulator` state, which the simulator loop also mutates on the event loop. It is not thread-safe. Calling it from a sync (`def`) route, which FastAPI runs in a threadpool, would race the simulator step. So routes that mutate are `async def`, and source calls are awaited on the loop.
**Why a lock:** single-user does not mean single-request. A manual trade and an LLM trade can overlap, and two quick clicks can overlap. The lock makes "check cash → write → reconcile → snapshot" atomic for the app. SQLite `BEGIN IMMEDIATE` adds DB-level safety.
**Trade-offs:** Serializes mutations (each takes milliseconds; irrelevant at this scale). The LLM call must **not** run under the lock.

```python
class Commands:
    def __init__(self, db, cache, tracker):
        self._db, self._cache, self._tracker = db, cache, tracker
        self._lock = asyncio.Lock()

    async def trade(self, ticker: str, quantity: float, side: str) -> TradeResult:
        async with self._lock:
            result = await asyncio.to_thread(self._trade_tx, ticker, quantity, side)  # validate + 1 txn
            await self._tracker.reconcile()          # sell-to-zero drops an unwatched ticker
            await self._record_snapshot_locked()
            return result

    def _trade_tx(self, ticker, quantity, side) -> TradeResult:
        symbol = rules.normalize_ticker(ticker)      # TradeRejected on bad regex
        qty = rules.validate_quantity(quantity)      # > 0, round(4)
        price = self._cache.get_price(symbol)
        if price is None:
            raise TradeRejected(f"No price available for {symbol}. Add it to your watchlist first.")
        with self._db.transaction() as conn:         # BEGIN IMMEDIATE ... COMMIT/ROLLBACK
            ...  # read cash + position, apply rules.apply_buy/apply_sell, write position (or delete dust), insert trade
```

### Pattern 3: Reconcile tracked tickers instead of per-case rules

**What:** PLAN §6 lists four rules (watch add, watch remove only if unheld, sell-to-zero drop if unwatched, startup union). Implement them as one idempotent function: desired = watchlist ∪ positions from the DB; current = `source.get_tickers()`; add the difference, remove the excess.
**When to use:** After every committed mutation, and for reset (which becomes "restore DB, then reconcile").
**Trade-offs:** Two tiny queries per mutation. In exchange, the CONCERNS.md item "remove-only-if-unheld has no enforcing caller" is enforced structurally, and reset needs no special casing. Removal clears the ticker's session open price and history in the cache, so only remove what is truly no longer desired.

```python
class TickerTracker:
    async def reconcile(self) -> None:
        desired = set(await asyncio.to_thread(self._db.tracked_tickers))
        current = set(self._source.get_tickers())
        for t in sorted(desired - current):
            await self._source.add_ticker(t)         # simulator prices immediately
        for t in sorted(current - desired):
            await self._source.remove_ticker(t)      # also clears cache entry, open price, history
```

### Pattern 4: Connection per unit of work, explicit transactions

**What:** `Database.connect()` opens a new `sqlite3.Connection` (`autocommit=True` on 3.12, `row_factory = sqlite3.Row`, `PRAGMA foreign_keys`, `busy_timeout=5000`; WAL set once in `init()`), used for one operation in one thread, then closed. `Database.transaction()` issues `BEGIN IMMEDIATE`, yields the connection, and commits or rolls back.
**When to use:** All DB access.
**Why:** `sqlite3` connections default to `check_same_thread=True`; sharing one across threadpool workers raises `ProgrammingError`, and sharing with `check_same_thread=False` needs manual write serialization (Python docs). Opening a SQLite connection is cheap. `BEGIN IMMEDIATE` takes the write lock up front, so the snapshot loop and a trade cannot interleave into a busy error mid-transaction.
**Confidence:** MEDIUM (Python 3.12 `sqlite3` docs; `autocommit` attribute is new in 3.12, and the Docker image pins 3.12).

### Pattern 5: LLM client behind a protocol; mock and real share the pipeline

**What:** `LLMClient.complete(messages) -> LLMReply`. `MockLLMClient` implements PLAN §9's rules table. `LiteLLMClient` follows the project's `cerebras-inference` skill (`completion(model="openrouter/openai/gpt-oss-120b", response_format=LLMReply, reasoning_effort="low", extra_body={"provider": {"order": ["cerebras"]}})`, then `LLMReply.model_validate_json`). Because `completion` is blocking, call it via `asyncio.to_thread`. Import `litellm` lazily inside `LiteLLMClient` so mock-mode tests and startup skip the heavy import.
**Pipeline:** `ChatService.handle()`: store user message → build context (cash, positions with P&L, watchlist with live prices, total) → last 20 messages → LLM (no lock held) → `executor`: watchlist changes first, then trades, each via `Commands` inside its own `try`, collecting `ActionResult(status, error, price)` → append `notes.py` failure lines → store assistant message with `actions` JSON (null if no actions requested) → return it.
**Error mapping:** no key and not mock → `LLMUnavailable` → 503, checked *before* storing the user message (nothing was attempted, so nothing is persisted; PLAN only requires storing the user message on 502). LLM exception or `ValidationError` → `LLMFailed` → 502, user message already stored.
**Schema note:** keep `trades` and `watchlist_changes` as **required arrays (possibly empty)** in the model sent as `response_format`. Strict structured-output modes generally require every property to be listed as required. The parser can still default missing fields when validating.

### Pattern 6: Frontend — one stream, external stores, selector-scoped rendering

**What:** One `EventSource`, created in an effect in the root client component, feeds `priceStore`. Components subscribe with narrow selectors (`usePrices(s => s.ticks[ticker])`), so a 500 ms frame re-renders only rows whose tick changed. Live portfolio values are a pure function of `portfolioStore` (server positions and cash) and `priceStore` (ticks).
**When to use:** All live UI.
**Why Zustand (5.x):** it is built on `useSyncExternalStore`, needs no provider, supports selectors, and stores are callable outside React (the stream module and reset action write to them directly). React Context would re-render the whole tree on every frame.
**Frame ingestion rules (important):**
- Each SSE frame carries **all** tickers, including unchanged ones (in Massive mode most ticks repeat). Keep `lastTs[ticker]` and only treat a ticker as "new tick" when `timestamp > lastTs`. Only new ticks flash, append to sparklines, and feed the main chart.
- A frame that omits a ticker means it was removed from tracking. Drop it from `ticks`.
- Bound sparkline buffers (for example, the last 300 points) so a long-running tab does not grow without limit.

```ts
// store/prices.ts (shape)
ingestFrame(frame: Record<string, PriceTick>) {
  set((s) => {
    const ticks: Record<string, PriceTick> = {};
    const lastTs = { ...s.lastTs }; const spark = { ...s.spark };
    for (const [t, tick] of Object.entries(frame)) {
      ticks[t] = tick;
      if (tick.timestamp > (lastTs[t] ?? 0)) {
        lastTs[t] = tick.timestamp;
        spark[t] = [...(spark[t] ?? []), tick.price].slice(-SPARK_MAX);
      }
    }
    return { ticks, lastTs, spark };
  });
}
```

**Connection status:** `onopen` → `connected`; `onerror` with `readyState === CONNECTING` → `reconnecting` (the browser retries after the server's `retry: 1000`); `readyState === CLOSED` → `disconnected`, then schedule a manual reconnect with backoff, because the browser does not retry once closed.

### Pattern 7: Lightweight Charts lifecycle

**What:** `useLightweightChart(containerRef, options)` creates the chart in `useEffect` (never during render; static export prerenders client components at build time and `window` is absent), adds a series with the v5 API `chart.addSeries(LineSeries, {...})` (not v4's `addLineSeries`), resizes with `autoSize: true` or a `ResizeObserver`, and calls `chart.remove()` on unmount.
**PriceChart:** on ticker change → `GET /api/prices/{ticker}/history` → `series.setData(points.map(p => ({ time: p.timestamp as UTCTimestamp, value: p.price })))`, remember `lastTime`; subscribe to `priceStore` for that ticker and call `series.update()` only when `timestamp > lastTime` (an older time throws; a fetch/SSE race can produce one). Fractional Unix seconds are accepted: v5.2.1 stores numeric times as-is (verified in package source), and its typings show `(Date.now() / 1000) as UTCTimestamp`. Set `timeScale: { timeVisible: true, secondsVisible: true }`.
**PnlChart:** snapshots have ISO-8601 second-precision timestamps. A trade snapshot and a periodic snapshot, or three LLM trades in one response, can share the same second. `setData` rejects duplicate or unordered times, so convert to seconds and collapse equal seconds keeping the last value (`domain/time.ts`).

---

## Data Flow

### Flow 1: Price tick → client-side live valuation (no polling)

```
SimulatorDataSource (500 ms) ──update()──> PriceCache.version++
                                              │
stream_router._generate_events (per client, 0.5 s check) ── data: {all tickers}
                                              │  SSE
PriceStream.onmessage ──> priceStore.ingestFrame ──(dedupe by ts)──> ticks / spark / lastTs
                                              │
selectors:  WatchlistRow(ticker)  → price, flash dir, Chg% = (price-open)/open
            Header                 → livePortfolio(positions, cash, ticks).total
            PositionsTable/Heatmap → livePortfolio(...).rows (current price, P&L, P&L %, weight)
            PriceChart(selected)   → series.update(new tick)
```

The server-side `valuation.py` and client-side `livePortfolio.ts` implement the same formula (including the avg-cost fallback when no price is known). Keep them line-for-line comparable, and give them parallel unit tests.

### Flow 2: Manual trade

```
TradeBar submit ─POST /api/portfolio/trade {ticker, quantity, side}─> portfolio_router (async)
   └─> Commands.trade  [lock]
         ├─ to_thread: rules.normalize/validate → cache.get_price → BEGIN IMMEDIATE
         │             cash/position/trade rows → COMMIT          (TradeRejected → 400 {"error"})
         ├─ loop: TickerTracker.reconcile()     (sell-to-zero of unwatched → source.remove_ticker)
         └─ snapshot insert
   <── 200 {trade, portfolio}   (portfolio valued from PriceCache, same shape as GET /api/portfolio)
TradeBar: portfolioStore.setPortfolio(resp.portfolio); append snapshot? → re-fetch /api/portfolio/history
          (or leave the P&L chart until the next action; PLAN only mandates history re-fetch after chat)
400 → inline error under TradeBar
```

### Flow 3: Chat with auto-executed actions

```
ChatPanel send ─> chatStore.pending=true ─POST /api/chat {message}─> chat_router
  ChatService.handle
    1 to_thread: insert user message
    2 build context (DB + PriceCache), last 20 messages
    3 LLMClient.complete (to_thread; NO lock)          ── fail/unparseable → 502, user msg kept
    4 for change in watchlist_changes: Commands.add_watch / remove_watch   (each try/except → ActionResult)
      for trade in trades:            Commands.trade                      (each try/except → ActionResult)
    5 message += notes.failure_lines(results)          ("⚠️ Couldn't buy 50 TSLA: ...")
    6 to_thread: insert assistant message with actions JSON (null when nothing requested)
  <── 200 stored assistant message
ChatPanel: render message + ActionList (failed = distinct style)
if actions != null: re-fetch /api/portfolio, /api/watchlist, /api/portfolio/history
```

### Flow 4: Watchlist add/remove

```
add:    POST /api/watchlist {ticker} → Commands.add_watch [lock] → validate → INSERT OR IGNORE
        → 201 new | 200 existing → reconcile → source.add_ticker (simulator prices now; Massive: next poll)
remove: DELETE /api/watchlist/{ticker} → Commands.remove_watch [lock] → DELETE (0 rows → 404)
        → reconcile (held ticker stays tracked) → 204
Frontend: update portfolioStore.watchlist from the response; the next SSE frame adds/removes the ticker
```

### Flow 5: Reset

```
ResetButton → window.confirm → POST /api/reset → Commands.reset [lock]
   one txn: cash=10000; DELETE positions, trades, snapshots, chat_messages; DELETE watchlist; seed default watchlist
   reconcile (drops non-default tickers; default tickers keep their session open and history)
   snapshot
Frontend: clear chatStore + spark buffers (and lastTs) → re-fetch portfolio, watchlist, history
```

### Flow 6: Startup (lifespan, before the first request)

```
Settings.from_env (dotenv) → create_app builds inert deps → uvicorn starts lifespan:
  db.init (schema.sql, PRAGMA WAL, INSERT OR IGNORE seed)
  → source.start(watchlist ∪ positions)    (simulator seeds cache immediately; Massive does a first poll)
  → initial snapshot (prices present; avg-cost fallback otherwise)
  → snapshot loop task (30 s)
  → accept requests
```

### State Ownership Summary

| State | Owner | Lifetime | Readers |
|---|---|---|---|
| Latest prices, open price, 5-min history | `PriceCache` (written only by the source) | process | SSE, history, valuation, trades, chat context |
| Tracked ticker set | Source, kept equal to DB watchlist ∪ positions by `TickerTracker` | process | cache, SSE |
| Cash, positions, trades, snapshots, watchlist, chat | SQLite | volume | services via repos |
| Live prices, sparklines, connection status | `priceStore` | page | UI |
| Server portfolio snapshot (positions, cash), watchlist, snapshots | `portfolioStore` | page, refreshed on events | UI + `livePortfolio` selector |
| Derived live P&L, weights, total | Computed (`domain/livePortfolio.ts`) | per render | Header, table, heatmap |

---

## Build Order (dependency-driven)

```
                ┌──────────────────────────────────────────────┐
                │ P1 Backend foundation / app shell            │
                │ config, db schema+seed, create_app+lifespan, │
                │ stream router mounted, health, error envelope│
                │ static mount, .gitignore fix                 │
                └───────┬───────────────────────────┬──────────┘
                        │                           │ (SSE + history are live after P1)
          ┌─────────────▼─────────────┐   ┌─────────▼──────────────────────────┐
          │ P2 Portfolio & watchlist  │   │ P4 Frontend shell + live market UI │
          │ rules, valuation, repos,  │   │ Next export, Tailwind theme, api   │
          │ Commands+lock, tracker,   │   │ types, stores, PriceStream, header │
          │ snapshot task, routes,    │   │ status, watchlist+flash+sparklines,│
          │ reset                     │   │ PriceChart                          │
          └─────────────┬─────────────┘   └─────────┬──────────────────────────┘
          ┌─────────────▼─────────────┐   ┌─────────▼──────────────────────────┐
          │ P3 AI chat                │   │ P5 Frontend portfolio, trade, chat │
          │ LLM client (mock+real),   │──>│ positions, heatmap, PnL chart,     │
          │ prompt, executor, notes,  │   │ trade bar, chat panel, reset flow  │
          │ chat routes               │   │ (needs P2 routes; chat needs P3)   │
          └─────────────┬─────────────┘   └─────────┬──────────────────────────┘
                        └──────────────┬────────────┘
                       ┌───────────────▼────────────────────────────┐
                       │ P6 Packaging + E2E                          │
                       │ Dockerfile, compose, scripts, .env.example, │
                       │ test/docker-compose.test.yml, Playwright    │
                       └─────────────────────────────────────────────┘
```

| Phase | Depends on | Can run in parallel with | Why this position |
|---|---|---|---|
| P1 Backend foundation | existing market subsystem | nothing (it's the root) | Gives a runnable server with real SSE and history. Every other phase needs the app factory, DB and error envelope. Small. |
| P2 Portfolio & watchlist | P1 | P4 | Holds the core value (correct numbers). Defines `Commands`, which P3 reuses. |
| P3 AI chat | P2 (`Commands`, valuation for context) | P4, start of P5 | The executor is a thin loop over `Commands`; building it before P2 would mean rewriting it. |
| P4 Frontend shell + market UI | P1 only (SSE and history exist) | P2, P3 | The market endpoints already exist, so the riskiest frontend parts (stream state, flash, sparklines, LWC) can be built against the real backend right away. |
| P5 Frontend portfolio/trade/chat | P2 routes (P3 for chat) | late P3 | Can start against fixtures typed from PLAN §8 (`src/test/fixtures.ts`, or MSW 2.12+/3.x `http`/`sse` handlers) and switch to the live API when P2/P3 land. |
| P6 Packaging + E2E | P1–P5 | — | E2E covers cross-stack scenarios, so it comes last. Do a smoke Docker build earlier (end of P4) to catch static-export serving problems while they are cheap. |

**Parallel lanes for worktree execution:** Lane A (backend) P1 → P2 → P3. Lane B (frontend) waits on P1, then P4 → P5. The contract both lanes code against is PLAN §6/§8. Freeze it as `backend/app/api/models.py` (Pydantic response models) and `frontend/src/api/types.ts` early in P2/P4. Add a backend API test per endpoint that asserts the exact keys, so drift shows up as a test failure, not an integration surprise.

**Frontend-against-backend dev setup (decide in P1/P4):** PLAN's production setup is same-origin with no CORS. For `next dev` (port 3000) against uvicorn (port 8000), Next.js `rewrites` are not an option: rewrites are unsupported with `output: 'export'` and error under `next dev` in that mode (Next.js docs), and there is a report of the rewrite proxy buffering `text/event-stream`. Recommended: `apiFetch`/`PriceStream` prefix URLs with `process.env.NEXT_PUBLIC_API_BASE ?? ''`, and the backend adds `CORSMiddleware` **only** when an opt-in env var (for example `DEV_CORS_ORIGIN=http://localhost:3000`) is set. It is never set in Docker, so production stays CORS-free. Alternative with zero backend change: `next build` and let local FastAPI serve `frontend/out` (`STATIC_DIR` default resolves there in local dev). Slower loop, but it is exactly the production path.

---

## Scaling Considerations

This is a single-user local app. Scale is not a design driver; correctness under concurrency within one user is.

| Scale | Architecture adjustments |
|-------|--------------------------|
| 1 user, 1–3 tabs (target) | As designed. One uvicorn worker (the `PriceCache` and source are process-local; more workers means divergent prices). Each SSE client runs its own 0.5 s loop serializing ~10–20 tickers: negligible. |
| Many tabs / demo projector | SSE per-client loops scale linearly; still fine into the hundreds. If needed, compute the JSON frame once per version change and fan out. |
| Multi-user (future, out of scope) | `user_id` columns already exist. The mutation lock becomes per-user, tracked set = union across users, and auth arrives. `PriceCache` is already shared by design. |

### What breaks first

1. **LLM latency and failures:** 1–3 s typical, unbounded on provider trouble. Set a request timeout on the LiteLLM call (for example 30 s) so a hung provider becomes a 502, not a hung spinner.
2. **Graceful shutdown with open SSE streams:** uvicorn waits for in-flight responses on shutdown, and `docker compose down` can stall until the container is killed. Run uvicorn with `--timeout-graceful-shutdown 5` (or similar). Confidence MEDIUM; verify during P6.

---

## Anti-Patterns

### Anti-Pattern 1: Trade logic in the route handler

**What people do:** Put validation, SQL and ticker sync in `POST /api/portfolio/trade`, then have the chat executor call it over HTTP or copy it.
**Why it's wrong:** Two code paths for money math drift. PLAN §7 requires identical rules for manual and LLM trades.
**Do this instead:** Routes and `ChatService` both call `Commands.trade()`.

### Anti-Pattern 2: Calling `source.add_ticker`/`remove_ticker` from a threadpool

**What people do:** Write mutating routes as plain `def` (so FastAPI runs them in a thread) and call source methods via `asyncio.run`/`run_coroutine_threadsafe`, or make `Commands` fully synchronous.
**Why it's wrong:** `GBMSimulator` state is mutated by the simulator loop on the event loop; mutating it from another thread races. The source methods are `async` for a reason.
**Do this instead:** Async routes, DB work in `asyncio.to_thread`, source calls awaited on the loop (Pattern 2).

### Anti-Pattern 3: Holding the mutation lock during the LLM call

**What people do:** Wrap all of `ChatService.handle` in the lock "for safety".
**Why it's wrong:** Manual trades and watchlist edits freeze for the whole LLM round trip, and a hung provider blocks all mutations.
**Do this instead:** Lock only per action in the executor (each `Commands` call takes the lock itself).

### Anti-Pattern 4: One shared `sqlite3` connection

**What people do:** Open one connection at startup and store it on `app.state`.
**Why it's wrong:** The default `check_same_thread=True` raises `ProgrammingError` from threadpool workers; with `False` you own write serialization.
**Do this instead:** Connection per unit of work, `BEGIN IMMEDIATE` for writes (Pattern 4).

### Anti-Pattern 5: Per-case ticker-tracking rules scattered across handlers

**What people do:** Sprinkle `if not held: remove_ticker` in watchlist delete, `if qty == 0 and not watched: remove_ticker` in sell, and something else in reset.
**Why it's wrong:** Each copy is a chance to break valuation (removing a held ticker drops its price and history). CONCERNS.md already flags the missing enforcing caller.
**Do this instead:** One `TickerTracker.reconcile()` after every mutation (Pattern 3).

### Anti-Pattern 6: Appending every SSE frame to sparklines and charts

**What people do:** For each frame, push every ticker's price into its sparkline and call `series.update`.
**Why it's wrong:** Frames include unchanged tickers. In Massive mode the sparkline fills with flat duplicates and the flash fires on non-changes. `series.update` with an older time throws.
**Do this instead:** Dedupe by per-ticker timestamp before any side effect (Pattern 6).

### Anti-Pattern 7: Polling `/api/portfolio` or a second stream for live values

**What people do:** `setInterval(fetchPortfolio, 1000)` to keep the header total moving.
**Why it's wrong:** PLAN §10 forbids it. It doubles load and lags SSE.
**Do this instead:** Derive from `portfolioStore` + `priceStore` client-side. Re-fetch only after trades, chat actions and reset.

### Anti-Pattern 8: Browser APIs or chart creation during render

**What people do:** Create `EventSource` or `createChart` at module scope or in a component body.
**Why it's wrong:** Static export prerenders client components at build; `window`/`EventSource` don't exist there, so the build fails or a second instance leaks on re-render (and React Strict Mode double-invokes effects in dev).
**Do this instead:** Create in `useEffect` with cleanup (`es.close()`, `chart.remove()`).

### Anti-Pattern 9: Mounting static files before API routers

**What people do:** `app.mount("/", StaticFiles(...))` early in `create_app`.
**Why it's wrong:** Starlette matches in registration order; a root mount swallows `/api/*`. Also, unknown `/api/foo` paths fall through to `404.html` (HTML) if no API catch-all exists.
**Do this instead:** Include all routers, add a `/api/{path:path}` JSON 404 catch-all, mount static last and only when `index.html` exists (so backend-only dev and tests work without a frontend build).

### Anti-Pattern 10: Frontend `lib/` directory under the current `.gitignore`

**What people do:** Use the conventional `src/lib/` for API helpers.
**Why it's wrong:** The root `.gitignore` contains `lib/` (Python template). Files there silently never get committed; worktree-based parallel execution would then lose them between agents. The same `.gitignore` does **not** ignore `node_modules/`, `.next/`, `out/`, `db/finally.db` (contrary to STRUCTURE.md's note), or `test-results/`/`playwright-report/`.
**Do this instead:** Fix `.gitignore` in P1 (scope `lib/` to `/backend/lib/` or remove it; add `node_modules/`, `.next/`, `frontend/out/`, `db/*.db*`, `test-results/`, `playwright-report/`) and avoid the `lib` folder name anyway.

---

## Integration Points

### External Services

| Service | Integration pattern | Notes |
|---------|---------------------|-------|
| OpenRouter → Cerebras (`openrouter/openai/gpt-oss-120b`) | `LiteLLMClient` per `.claude/skills/cerebras/SKILL.md`; `response_format=<Pydantic model>`, `reasoning_effort="low"`, `extra_body={"provider": {"order": ["cerebras"]}}`; via `asyncio.to_thread` | Missing key + not mock → 503 at request time (app still starts). Validate with `model_validate_json`; failure → 502. Add `litellm` and `pydantic` (pydantic already arrives with FastAPI) plus `python-dotenv`. |
| Massive (Polygon) REST | Existing `MassiveDataSource` | New tickers have no price until next poll, so LLM "add X then buy X" fails in Massive mode by design (PLAN §6). The failure note covers it. |
| Browser `EventSource` | Same-origin `/api/stream/prices` | `retry: 1000` and keep-alive already sent by the server. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Routers ↔ `Commands`/`ChatService` | Direct async calls | Routers never touch SQL or the source. |
| `Commands` ↔ DB | `asyncio.to_thread` + repo functions inside `Database.transaction()` | One transaction per command (PLAN §7). |
| `Commands` ↔ market source | `TickerTracker.reconcile()` awaited on the loop | Sole caller of `add_ticker`/`remove_ticker`. |
| Anything ↔ `PriceCache` | Read-only (`get_price`, `get`, `get_all`) | Only sources write. Trades price from the cache (one price path for SSE and execution). |
| `ChatService` ↔ `Commands` | Per-action calls, each in its own try | Failures become `ActionResult(status="failed", error=str(exc))`. |
| SnapshotTask ↔ DB/cache | Reads cash+positions, values via `valuation`, inserts | Uses `Commands.record_snapshot()` so the formula is shared with `GET /api/portfolio`. |
| Backend ↔ Frontend | REST JSON (ISO timestamps) + SSE (Unix float seconds) | Contract = PLAN §6/§8, mirrored in `api/models.py` and `src/api/types.ts`. |
| Frontend stream ↔ stores | `PriceStream` calls `priceStore.getState().ingestFrame` | `makeEventSource` injectable so unit tests use a `FakeEventSource` (jsdom has no `EventSource`). |
| E2E ↔ app | Playwright container → `http://app:8000` on the compose network | `python:3.12-slim` lacks `curl`; write the healthcheck with `python -c "import urllib.request; ..."` against `/api/health`, and `depends_on: condition: service_healthy`. Pin the Playwright image tag to the `@playwright/test` version (currently 1.64.1). No DB volume in the test compose, so every run starts clean. |

### Docker layout (P6)

- Stage 1 `node:20-slim` per PLAN (Next 16.4 requires Node ≥ 20.9; Node 20 reached end of life in April 2026, so prefer `node:22-slim` and note the deviation): `npm ci && npm run build` → `frontend/out`.
- Stage 2 `python:3.12-slim`: copy `uv` from `ghcr.io/astral-sh/uv`, `WORKDIR /app`, copy `pyproject.toml` + `uv.lock` first and `uv sync --frozen --no-install-project` for layer caching, then copy `app/`, then `COPY --from=frontend /frontend/out /app/static`. `ENV DB_PATH=/app/db/finally.db STATIC_DIR=/app/static`. CMD `uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-graceful-shutdown 5`.
- Dev extras (`pytest`, `ruff`, ...) live under `[project.optional-dependencies] dev`, so a plain `uv sync --frozen` already excludes them.

---

## Sources

- Local codebase (HIGH, direct inspection): `backend/app/market/{__init__,interface,cache,factory,stream,simulator,massive_client}.py`, `backend/CLAUDE.md`, `backend/pyproject.toml`, `.gitignore` (checked with `git check-ignore`), `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/PROJECT.md`, `planning/PLAN.md`, `.claude/skills/cerebras/SKILL.md`
- Next.js static exports guide (official, updated 2026-08-09): https://nextjs.org/docs/app/guides/static-exports (unsupported features incl. rewrites; errors under `next dev`; browser APIs in effects)
- Lightweight Charts v4→v5 migration: https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5 ; `lightweight-charts@5.2.1` package `dist/typings.d.ts` (UTCTimestamp) and `dist/lightweight-charts.development.mjs` (`convertTime` stores numeric time as-is), inspected directly
- Python 3.12 `sqlite3` docs: https://docs.python.org/3.12/library/sqlite3.html (`autocommit`, `check_same_thread`, context manager semantics)
- Starlette/FastAPI `StaticFiles` reference: https://fastapi.tiangolo.com/reference/staticfiles/ (`html=True`, `404.html` fallback)
- MSW SSE support: https://mswjs.io/docs/sse/ , https://mswjs.io/blog/server-sent-events-are-here
- Next.js rewrite proxy and SSE buffering report (single report, LOW): https://cubic.dev/pr/lfnovo/open-notebook/pull/770 ; CVE-2026-29057 (rewrites request smuggling, fixed in 15.5.13 / 16.1.7): https://api.osv.dev/v1/vulns/CVE-2026-29057
- Package versions checked via `npm view` / PyPI JSON on 2026-10-23: next 16.4.3 (engines node >= 20.9.0), react 19.3.1, lightweight-charts 5.2.1, zustand 5.0.16, tailwindcss 4.3.3, @playwright/test 1.64.1, vitest 5.0.5, msw 3.0.3, @testing-library/react 16.3.3, fastapi 0.162.0, litellm 1.106.2, python-dotenv 1.2.4

---
*Architecture research for: FinAlly AI trading workstation (brownfield: market subsystem complete)*
*Researched: 2026-10-23*
