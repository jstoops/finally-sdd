# Requirements Archive: v1 MVP

**Archived:** 2026-10-30
**Status:** SHIPPED

For current requirements, see `.planning/REQUIREMENTS.md`.

---

# Requirements: FinAlly — AI Trading Workstation

**Defined:** 2026-10-26
**Core Value:** A user can open one URL, watch prices stream live, and trade a simulated portfolio, either manually or by asking the AI copilot, with every number (cash, positions, P&L) staying correct and updating in real time.

`planning/PLAN.md` remains the detailed contract for API shapes, schema and status codes. These requirements add the decisions made during initialization: the research gap resolutions (`G-xx`, see `.planning/research/FEATURES.md`) and four extras beyond PLAN.md (marked *extra*).

The market data subsystem (`backend/app/market/`: simulator, Massive poller, `PriceCache` with open price and history, SSE stream, history endpoint) is already built and validated. It's listed in PROJECT.md and isn't repeated here.

## v1 Requirements

### Platform & Startup

- [x] **OPS-01**: On startup, the FastAPI `lifespan` hook creates the schema and seed, starts the market source with watchlist ∪ held positions, records an initial snapshot, and starts the 30s snapshot task, all before any request is accepted
- [x] **OPS-02**: The SQLite database at `DB_PATH` (default `<repo>/db/finally.db`) is created from `schema.sql` (`CREATE TABLE IF NOT EXISTS`) and seeded with `INSERT OR IGNORE` (default user with $10,000 cash, 10-ticker watchlist), using stdlib `sqlite3`; restarting never duplicates or overwrites data
- [x] **OPS-03**: In local dev the backend loads `../.env` with `python-dotenv`; variables already set in the environment take precedence; API key values are never logged
- [x] **OPS-04**: `GET /api/health` returns `200 {"status": "ok"}`
- [x] **OPS-05**: FastAPI serves the Next.js static export at `/`; every unknown `/api/*` path returns a JSON `404`, never `index.html` (G-18)

### Packaging & Ops

- [x] **OPS-06**: A multi-stage Dockerfile (Node 22 slim → Python 3.12 slim + uv) builds the frontend export, installs backend dependencies from the lockfile, sets `DB_PATH=/app/db/finally.db`, and runs a single uvicorn worker on port 8000
- [x] **OPS-07**: `docker-compose.yml` maps port `8000:8000`, uses `env_file: .env`, mounts the named volume `finally-data` at `/app/db`, and defines a healthcheck on `/api/health`; data survives `docker compose down` / `up`
- [x] **OPS-08**: User can start and stop the app with idempotent scripts for macOS/Linux (`start_mac.sh`, `stop_mac.sh`) and Windows (`start_windows.ps1`, `stop_windows.ps1`) that wrap `docker compose`, build when `--build` is passed or the image is missing, print the URL, and never delete the volume

### Trading

- [x] **TRD-01**: A single trade service, used by both the manual trade route and the AI executor, normalizes the ticker (trim, uppercase, `^[A-Z][A-Z0-9.]{0,9}$`), requires quantity > 0 rounded to 4dp (a quantity that rounds to 0 is rejected), and fills at the cached price, rejecting with "No price available for {ticker}. Add it to your watchlist first." when none is cached
- [x] **TRD-02**: A buy is rejected when `quantity × price` exceeds cash; otherwise avg cost becomes `(old_qty × old_avg + qty × price) / (old_qty + qty)`
- [x] **TRD-03**: A sell is rejected when quantity exceeds the held quantity by more than `1e-6`; within tolerance the sold quantity is clamped to the held quantity; avg cost is unchanged; a remainder below `1e-6` deletes the position row (G-10)
- [x] **TRD-04**: Trade cost and the resulting cash balance are rounded to cents at write time, so cash never shows float noise (G-07)
- [x] **TRD-05**: Each trade updates cash, position and trade log in one `BEGIN IMMEDIATE` transaction, serialized by an in-process lock shared with reset, followed by a portfolio snapshot (G-08)
- [x] **TRD-06**: `POST /api/portfolio/trade` returns `200` with the trade and the updated portfolio (PLAN §8), or `400 {"error": ...}` for business-rule failures and `422` for malformed bodies
- [x] **TRD-07**: User can enter a ticker and quantity (fractional allowed) in the trade bar and click Buy or Sell; the order fills instantly with no confirmation dialog
- [x] **TRD-08**: User sees `400` errors inline beside the trade bar (and a generic message for `422`); the error clears on the next edit
- [x] **TRD-09**: After a successful manual trade, user sees a brief auto-clearing "Bought 10 AAPL @ $190.52" message using the returned fill price; the quantity field is cleared and the ticker field is kept (G-09)
- [x] **TRD-10** *(extra)*: User can see their trade history in an activity panel, newest first, fed by `GET /api/trades` (ticker, side, quantity, price, executed_at); it refreshes after manual trades, chat actions and reset

### Watchlist & Tracked Tickers

- [x] **WL-01**: On first launch the watchlist contains AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX
- [x] **WL-02**: `GET /api/watchlist` returns tickers in `added_at` order with `price` and `open_price` (`null` until the first price arrives)
- [x] **WL-03**: User can add a ticker from the watchlist panel; `POST /api/watchlist` returns `201` for a new ticker, `200` with the existing entry for a duplicate, and `400` for a malformed ticker
- [x] **WL-04**: User can remove a ticker from the watchlist panel; `DELETE /api/watchlist/{ticker}` returns `204`, or `404` when the ticker isn't on the watchlist
- [x] **WL-05**: The watchlist is capped at 50 tickers; adding beyond the cap returns `400` with a clear message, for both manual and AI adds (G-13)
- [x] **WL-06**: One tracked-ticker service keeps the priced set equal to watchlist ∪ held positions: watchlist add starts pricing; removing a held ticker from the watchlist keeps it priced; selling an unwatched ticker to zero stops pricing it; reset re-syncs to the default watchlist

### Market Data UI

- [x] **MD-01**: The frontend opens exactly one `EventSource` to `/api/stream/prices` and keeps one prices map for every streamed ticker, shared by all panels; the watchlist renders from `/api/watchlist`, while positions, heatmap and header read held-but-unwatched tickers from the same map (G-23)
- [x] **MD-02**: User sees each watchlist row's ticker, current price, and **Chg %** since session open (`(price - open_price) / open_price × 100`, computed client-side); unpriced tickers show `—`
- [x] **MD-03**: A watchlist price flashes green on an uptick or red on a downtick, fading over ~500ms, only when that ticker's price changed; consecutive ticks re-trigger the flash
- [x] **MD-04**: The header connection dot is green while the stream is open, yellow while reconnecting, and red when closed; after a permanent close the client recreates the `EventSource` with capped backoff (1s → 2s → 5s) and turns green once it reopens (G-01)
- [x] **MD-05**: User sees a sparkline (inline SVG polyline, no library) beside each watchlist ticker, accumulated from SSE since page load, capped to a fixed recent window, and cleared on reset (G-02)
- [x] **MD-06**: User sees a main price chart (Lightweight Charts) for the selected ticker, seeded from `GET /api/prices/{ticker}/history` and extended with SSE points; out-of-order points are dropped and the time axis shows local `HH:MM:SS` (G-04)
- [x] **MD-07**: User can click a watchlist row to chart it; on load the first watchlist ticker is selected; removing the selected ticker selects the first remaining one (or an empty state); reset selects the first default ticker (G-05)
- [x] **MD-08** *(extra)*: User can click a positions-table row or a heatmap tile to chart that ticker

### Portfolio

- [x] **PF-01**: `GET /api/portfolio` returns cash, positions value, total value, unrealized P&L and per-position quantity, avg cost, current price, market value, P&L, P&L % and weight (PLAN §8); current price falls back to avg cost when uncached; weight is 0-safe with no positions; every `*_percent` field is in percent units, rounded to 4dp (G-12)
- [x] **PF-02**: Portfolio snapshots are recorded at startup, every 30 seconds, after each trade and after a reset, valuing held tickers at cached prices (avg-cost fallback)
- [x] **PF-03**: `GET /api/portfolio/history` returns snapshots oldest first
- [x] **PF-04**: User sees the portfolio total value and cash balance in the header, updating live from SSE prices × positions computed client-side, with no polling of `/api/portfolio`
- [x] **PF-05** *(extra)*: User sees "P&L since start" (`total_value − 10,000`) in the header, colored green/red and updating live
- [x] **PF-06**: User sees a positions table (ticker, quantity, avg cost, current price, unrealized P&L, P&L %) that recomputes live from SSE, colors P&L green/red, and displays percents with 2dp without re-multiplying by 100
- [x] **PF-07**: User sees a portfolio heatmap (in-house squarified treemap, positioned divs) with tiles sized by live weight and colored by P&L % on a diverging green/red scale clamped at ±5%; tiny tiles hide their label behind a tooltip; with no positions it shows "No positions — buy something or ask FinAlly" (G-06)
- [x] **PF-08**: User sees a P&L line chart (Lightweight Charts) of total value over time from `/api/portfolio/history`; it renders a single point gracefully and refetches every 30 seconds as well as after trades, chat actions and reset (G-03)
- [x] **PF-09**: User can reset the account from the header after a `window.confirm`; `POST /api/reset` returns `{"status": "ok"}` after one transaction restores $10,000 cash and the default watchlist and deletes positions, trades, snapshots and chat messages, then re-syncs tracked tickers and records a fresh snapshot; reset shares the trade lock (G-16)
- [x] **PF-10**: After a reset the frontend re-fetches everything and clears the chat panel, sparklines and chart selection; the Reset button is disabled while a chat request is in flight (G-16)

### AI Chat

- [x] **AI-01**: `POST /api/chat` calls `openrouter/openai/gpt-oss-120b` via LiteLLM → OpenRouter with Cerebras as the provider (per the `cerebras-inference` skill), requesting structured output `{message, trades?, watchlist_changes?}`, and returns the stored assistant message (PLAN §8)
- [x] **AI-02**: Each prompt contains the FinAlly system prompt, a portfolio context (cash, positions with P&L, watchlist with live prices and Chg %, total value) built from the same service as `GET /api/portfolio`, and the last 20 messages
- [x] **AI-03**: The system prompt instructs the model to analyze concentration and P&L, suggest trades with reasoning, execute when asked, manage the watchlist, be concise, convert dollar amounts to share quantities (4dp) using the price in context, use the exact held quantity for "sell all", and reply in plain text without markdown tables (G-17)
- [x] **AI-04**: The response envelope is validated strictly (`message` required); each trade and watchlist item is validated individually, so a malformed item is recorded as `failed` without failing the response; unparseable output or an LLM call failure returns `502 {"error": ...}` with the user message still stored (G-11)
- [x] **AI-05**: Actions auto-execute without confirmation: watchlist changes first, then trades, each independently and in order, through the same trade and watchlist services as the REST routes; each outcome (`executed` with price for trades, or `failed` with `error`) is stored in `actions`; `actions` is `null` when nothing was requested
- [x] **AI-06**: An AI add of an already-watched ticker is `executed`; an AI remove of an unwatched ticker is `failed` with "{TICKER} is not on your watchlist" (G-20)
- [x] **AI-07**: At most 10 trades and 10 watchlist changes run per reply; extra actions are recorded as `failed` with "too many actions" (G-21)
- [x] **AI-08**: For each failed action the backend appends a templated ⚠️ note to the message (e.g. "⚠️ Couldn't buy 50 TSLA: insufficient cash (need $12,450.00, have $8,095.00)."); no second LLM call; the stored content includes the notes
- [x] **AI-09**: Without `OPENROUTER_API_KEY` (and `LLM_MOCK` not `true`) the app still starts and `POST /api/chat` returns `503` with the PLAN §5 message, storing nothing; an empty/whitespace message or one over 2,000 characters returns `400` (G-15)
- [x] **AI-10**: With `LLM_MOCK=true`, deterministic mock responses (buy / sell / add X / remove X / greeting, first rule wins) match case-insensitively on word boundaries, uppercase the captured ticker, and flow through the same execution, failure-note and storage path (G-14)
- [x] **AI-11**: `GET /api/chat/history` returns the last 50 messages oldest first, and the chat panel loads it on page load, rendering stored actions exactly as live ones
- [x] **AI-12**: User can type in a collapsible chat panel, send with Enter, and see a loading indicator; sending is disabled while a request is in flight; the view auto-scrolls to the newest message; text renders with preserved whitespace
- [x] **AI-13**: User sees each executed action as an inline confirmation chip (side, quantity, ticker, fill price) and each failed action as a visibly distinct chip with its error
- [x] **AI-14**: User sees `502`/`503`/`400` chat errors as a distinct system bubble in the chat panel
- [x] **AI-15**: After a chat reply with non-null `actions`, the frontend re-fetches `/api/portfolio`, `/api/watchlist` and `/api/portfolio/history`, so the heatmap, positions, cash and watchlist reflect the AI's actions within about a second
- [x] **AI-16** *(extra)*: An empty chat panel shows clickable prompt chips (e.g. "Analyze my portfolio", "Buy 5 NVDA") that send that message

### Visual Design

- [x] **UX-01**: The UI uses a Tailwind custom dark theme (backgrounds `#0d1117` / `#1a1a2e`, muted gray borders, no pure black, accent yellow `#ecad0a`, blue `#209dd7`, purple `#753991` submit buttons) with tabular numerals so ticking digits don't jitter
- [x] **UX-02**: The layout is a dense, desktop-first terminal grid showing header, watchlist, main chart, heatmap, P&L chart, positions, trade bar and chat panel at once on a wide screen, and stays usable on a tablet

### Testing

- [x] **TST-01**: Backend pytest covers the trade service (avg cost, P&L, oversell, insufficient cash, selling at a loss, dust removal, no cached price, rounding), tracked tickers (unwatching a held ticker keeps it priced, selling an unwatched ticker to zero drops it), LLM parsing (valid schemas, malformed output, per-item failures, failure notes, caps, mock triggers), API status codes and response shapes, and reset
- [x] **TST-02**: Frontend unit tests (with a mocked `EventSource` and fake timers) cover component rendering, the price flash trigger, connection status transitions, watchlist add/remove, portfolio calculations, and chat rendering including failed actions and the loading state
- [x] **TST-03**: Playwright E2E runs from `test/docker-compose.test.yml` (app + Playwright containers) with `LLM_MOCK=true`, resets before each test, and covers all seven PLAN §12 scenarios using relational assertions (cash decreased, tile color matches displayed P&L sign) rather than exact prices (G-19)
- [x] **TST-04**: UI elements that tests read expose stable `data-testid` hooks, and P&L-bearing elements expose their sign as a `data-*` attribute (G-19)

## v2 Requirements

Deferred. Tracked, but not in the current roadmap.

### Trading

- **ORD-01**: User can place limit and stop orders that fill when the price crosses
- **ORD-02**: User can set price alerts that notify when a ticker crosses a level

### Platform

- **MULT-01**: Multiple users with authentication, using the existing `user_id` columns
- **DEPL-01**: Cloud deployment of the container (Terraform for AWS App Runner in `deploy/`)

### UX

- **KEY-01**: Keyboard shortcuts (`/` focuses chat, `B`/`S` focus the trade bar)

### Testing

- **SIM-01**: Seeded, deterministic simulator mode for E2E, if relational assertions prove flaky

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Order book, partial fills, fees, slippage | Market orders with instant fill keep the portfolio math simple (PLAN §3) |
| Trade confirmation dialogs (manual or AI) | Kills the fluid agentic demo; PLAN §2/§9 say no confirmation. Deterministic trade rules + visible per-action results instead |
| Candlestick/OHLC charts, timeframes, indicators | 500ms ticks over a 5-minute buffer make candles synthetic and indicators meaningless |
| Charting libraries other than Lightweight Charts | PLAN §10 forbids them; sparklines are inline SVG and the heatmap is in-house |
| Token-streaming chat | Structured output must be complete before it can be parsed and executed; Cerebras is fast enough |
| Multi-step tool-calling loop / second LLM call for failures | Doubles latency and cost, nondeterministic, harder to mock; templated notes instead |
| Short selling, margin, leverage, options, crypto, FX | Breaks the long-only cash/quantity checks and the P&L model |
| Realized P&L, tax lots, FIFO/LIFO | Not in the API contract; avg cost defines a single basis, realized gains show in cash |
| News, fundamentals, earnings, screeners | Needs external data sources; simulated tickers have no news |
| Draggable/resizable panels, saved layouts, multiple watchlists | Large layout-state complexity for little demo value; collapsible chat only |
| WebSockets, a second SSE stream, polling `/api/portfolio` | One stream plus client-side math (PLAN §10) |
| Light theme, mobile-first layout | Dark, desktop-first terminal is the spec |
| Persisting sparklines or chart data to the DB | Sparklines are "since page load"; the 5-minute history endpoint covers the main chart |
| Ticker existence validation against a symbol master | The simulator prices anything; Massive lookups would burn the free-tier quota |
| Undo or edit trades | Trades are an append-only log; place an opposite trade or reset |
| Pruning snapshots or trades | Volume is trivial for SQLite (PLAN §7) |
| ORM or Postgres | Six small tables; stdlib `sqlite3` |
| Rewriting the market data subsystem | Complete and tested; change it only where integration requires |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OPS-01 | Phase 1 | Complete |
| OPS-02 | Phase 1 | Complete |
| OPS-03 | Phase 1 | Complete |
| OPS-04 | Phase 1 | Complete |
| OPS-05 | Phase 1 | Complete |
| OPS-06 | Phase 1 | Complete |
| OPS-07 | Phase 1 | Complete |
| OPS-08 | Phase 1 | Complete |
| TRD-01 | Phase 2 | Complete |
| TRD-02 | Phase 2 | Complete |
| TRD-03 | Phase 2 | Complete |
| TRD-04 | Phase 2 | Complete |
| TRD-05 | Phase 2 | Complete |
| TRD-06 | Phase 2 | Complete |
| TRD-07 | Phase 2 | Complete |
| TRD-08 | Phase 2 | Complete |
| TRD-09 | Phase 2 | Complete |
| TRD-10 | Phase 2 | Complete |
| WL-01 | Phase 1 | Complete |
| WL-02 | Phase 1 | Complete |
| WL-03 | Phase 1 | Complete |
| WL-04 | Phase 1 | Complete |
| WL-05 | Phase 1 | Complete |
| WL-06 | Phase 2 | Complete |
| MD-01 | Phase 1 | Complete |
| MD-02 | Phase 1 | Complete |
| MD-03 | Phase 1 | Complete |
| MD-04 | Phase 1 | Complete |
| MD-05 | Phase 1 | Complete |
| MD-06 | Phase 1 | Complete |
| MD-07 | Phase 1 | Complete |
| MD-08 | Phase 2 | Complete |
| PF-01 | Phase 2 | Complete |
| PF-02 | Phase 2 | Complete |
| PF-03 | Phase 2 | Complete |
| PF-04 | Phase 2 | Complete |
| PF-05 | Phase 2 | Complete |
| PF-06 | Phase 2 | Complete |
| PF-07 | Phase 2 | Complete |
| PF-08 | Phase 2 | Complete |
| PF-09 | Phase 2 | Complete |
| PF-10 | Phase 3 | Complete |
| AI-01 | Phase 3 | Complete |
| AI-02 | Phase 3 | Complete |
| AI-03 | Phase 3 | Complete |
| AI-04 | Phase 3 | Complete |
| AI-05 | Phase 3 | Complete |
| AI-06 | Phase 3 | Complete |
| AI-07 | Phase 3 | Complete |
| AI-08 | Phase 3 | Complete |
| AI-09 | Phase 3 | Complete |
| AI-10 | Phase 3 | Complete |
| AI-11 | Phase 3 | Complete |
| AI-12 | Phase 3 | Complete |
| AI-13 | Phase 3 | Complete |
| AI-14 | Phase 3 | Complete |
| AI-15 | Phase 3 | Complete |
| AI-16 | Phase 3 | Complete |
| UX-01 | Phase 1 | Complete |
| UX-02 | Phase 3 | Complete |
| TST-01 | Phase 3 | Complete |
| TST-02 | Phase 3 | Complete |
| TST-03 | Phase 3 | Complete |
| TST-04 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 64 total
- Mapped to phases: 64
- Unmapped: 0 ✓
- Per phase: Phase 1: 21 · Phase 2: 21 · Phase 3: 22

---
*Requirements defined: 2026-10-26*
*Last updated: 2026-10-26 after roadmap creation (traceability mapped to 3 phases)*
