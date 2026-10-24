# Feature Research

**Domain:** AI-powered simulated trading workstation (paper trading + live price streaming + LLM copilot that executes trades), Bloomberg-terminal aesthetic, single-user course demo
**Researched:** 2026-10-23
**Confidence:** MEDIUM overall. PLAN.md is the fixed contract, so scope is HIGH. Edge-case analysis comes from the PLAN text, the existing `backend/app/market/` code, the WHATWG SSE spec (HIGH), and the Lightweight Charts docs (MEDIUM). Competitor comparisons rely on web search only (LOW to MEDIUM).

> **Scope rule:** Every feature in `planning/PLAN.md` is **in scope for v1**. This file doesn't add scope. It sorts PLAN features into table stakes and differentiators, names tempting features to leave out, and lists the gaps and ambiguities in PLAN.md that requirements must settle (section "PLAN.md Gaps & Ambiguities"). Feature IDs (e.g. `TRD-03`) are suggestions that requirements can reuse.

---

## How Comparable Products Work (context)

- **Paper-trading simulators** (TradingView Paper Trading, IBKR paper accounts, Schwab paperMoney, TC2000, WealthCharts) share a common core. They fill simulated orders against live prices, track positions and P&L in real time, and offer an account reset. Reset semantics vary. TC2000 wipes positions and history, IBKR resets only cash, and TradingView's reset can't be undone. FinAlly's reset is a full wipe: cash, positions, trades, snapshots, chat and watchlist. That's the clearest choice for a demo. *(LOW–MEDIUM, web search)*
- **Trading terminals** (Bloomberg, thinkorswim, TWS) define the look: dense multi-panel layouts, a ticking watchlist with up/down flashes, a main chart, a positions/P&L blotter, and a command/order entry line. Users expect prices to move without a refresh and a visible signal when data is stale or disconnected.
- **AI trading copilots** (Robinhood Cortex, Public Alpha/Agents, Alpaca-based agent demos) mostly **explain and summarize**. Where they can act, they almost always **propose, then require confirmation**, and enforce limits with deterministic guardrails outside the LLM. Public's Agents require explicit sign-off; the Alpaca demos (TradeMind, OFFLeash) gate execution with a human or with rule checks. *(LOW, web search; vendor claims conflict across sources.)*
  - **Implication for FinAlly:** Auto-execution without confirmation is the *differentiator* here, and it's defensible only because the money is fake (PLAN §9). FinAlly still keeps the *deterministic-guardrail* half of the industry pattern: every LLM trade goes through the same Trade Rules as a manual trade (§7), and each action's outcome is reported back. That safety story is worth keeping visible in the UI.

---

## Feature Landscape

Complexity: LOW = a few hours with known patterns; MEDIUM = needs care, state or tests across layers; HIGH = cross-cutting, race-prone or new territory.

### Table Stakes (Users Expect These)

Without these, the app feels broken rather than merely plain.

#### Market Data UI

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| MD-01 | Live SSE price stream consumed via `EventSource` (`/api/stream/prices`) | A trading screen with static prices reads as a mockup | LOW | Backend is **done**. Frontend needs one shared subscription (context/store) feeding every panel. Never open more than one `EventSource`. |
| MD-02 | Watchlist grid: ticker, price, **Chg %** since session open | The first thing any terminal shows | LOW | Compute `(price - open_price) / open_price * 100` client-side. The SSE `change_percent` is tick-to-tick and drives flash direction only (PLAN §6). Show `—` when `price`/`open_price` is `null` (Massive mode). |
| MD-03 | Green/red price flash on change, fading over ~500ms | The defining terminal visual | LOW–MEDIUM | Flash only when *that ticker's* price changed. Each SSE event carries all tickers, so use `direction !== "flat"` or compare with the last rendered price. Restarting a CSS transition needs a class remove/re-add (or a key bump / `animationend`); otherwise back-to-back ticks don't re-flash. Consider `prefers-reduced-motion`. |
| MD-04 | Connection status dot (green/yellow/red) in header | Users must know whether the numbers are live | MEDIUM | See gap G-01. With `EventSource`, red only happens when the connection is **CLOSED**, which the browser never reaches on its own after network errors. |
| MD-05 | Main chart for the selected ticker (Lightweight Charts), seeded from `GET /api/prices/{ticker}/history`, extended by SSE | Clicking a ticker should show its price action right away | MEDIUM | `update()` requires time >= last point (equal time replaces it). Drop SSE points older than the last history point to avoid the fetch/stream race. Numeric times are seconds, and fractional seconds work. The default axis is **UTC**, so add `localization.timeFormatter` / `tickMarkFormatter` for local time (gap G-04). |
| MD-06 | Click a watchlist row to select it in the main chart | The basic terminal interaction | LOW | Needs a default selection on load and a rule for removing the selected ticker (gap G-05). |

#### Trading

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| TRD-01 | Trade bar: ticker + quantity + Buy + Sell, market orders, instant fill | Core of any paper-trading app | LOW | No confirmation dialog (PLAN §2). Uppercase and trim the ticker client-side too. Allow fractional quantities (`step="any"`). |
| TRD-02 | Inline `400` error messages (insufficient cash/shares, bad ticker, no price) | Silent failures in money UIs destroy trust | LOW | Render `{"error": "..."}` beside the bar and clear it on the next edit. A `422` (malformed body) should still show a generic message, not crash. |
| TRD-03 | Shared Trade Rules service (§7): ticker regex, qty > 0 rounded to 4dp, cached-price fill, cash/shares checks with 1e-6 tolerance, weighted avg cost, dust deletion, single transaction + snapshot | Correct portfolio math is the Core Value | MEDIUM | **One function, called by both the manual route and the LLM executor.** This is the most important backend unit. Reject a quantity that rounds to 0. Needs serialization (gap G-08). |
| TRD-04 | Success feedback after a manual trade | Users need to see that the click did something | LOW | PLAN gives none (gap G-09). Minimum: the position appears and cash updates from the returned `portfolio`. Recommended: a brief inline "Bought 10 AAPL @ $190.52" using the returned `trade.price`. |
| TRD-05 | Tracked-ticker rule: watchlist ∪ held positions (§6) | Selling or unwatching must not break valuation | MEDIUM | One service owns `add_ticker`/`remove_ticker` decisions: watchlist remove, sell-to-zero and reset all go through it. CONCERNS.md says nothing enforces this yet. |

#### Portfolio

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| PF-01 | Header: live total value + cash balance | The single most-watched number | LOW | `cash + Σ qty × live price`, computed client-side from positions + SSE (PLAN §10). Don't poll. |
| PF-02 | Positions table: ticker, qty, avg cost, current price, unrealized P&L, P&L % | Standard blotter | LOW | Live-recompute from SSE. **`unrealized_pnl_percent` is already in percent units** (`0.0105` = 0.0105%), the same as `change_percent`, so don't multiply by 100 (gap G-12). Green/red P&L coloring. |
| PF-03 | `GET /api/portfolio` with weight, P&L, `avg_cost` fallback when no cached price | Data source for table, header, heatmap | LOW | `weight = market_value / positions_value`. Guard against division by zero when there are no positions. |
| PF-04 | P&L chart of total value over time (Lightweight Charts) from `/api/portfolio/history` | Users expect to see how they're doing over time | MEDIUM | Convert ISO 8601 to Unix seconds for LWC. After a reset it has **one point**, so render it gracefully. The chart goes stale between trades unless you refetch or append (gap G-03). |
| PF-05 | Portfolio snapshots: at startup, every 30s, after each trade, after reset | Feeds PF-04 | LOW | Background task in `lifespan`. Value held tickers at cached prices, falling back to `avg_cost`. |
| PF-06 | Reset button with `window.confirm` → `POST /api/reset` | Paper-trading apps universally offer reset | MEDIUM | Backend: one transaction, then re-sync tracked tickers, then snapshot. Frontend: refetch everything, clear chat + sparklines + selected-ticker state. Race with an in-flight chat request (gap G-16). |

#### Watchlist

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| WL-01 | Seeded default watchlist of 10 tickers on first launch | Must look alive on first load (PLAN §2) | LOW | `INSERT OR IGNORE` seed. Display order = `added_at`, **not** SSE object key order. |
| WL-02 | Add ticker (UI input) → `POST /api/watchlist` (201 new / 200 idempotent / 400 malformed) | Basic customization | LOW | Simulator prices anything immediately. In Massive mode a new or bogus ticker shows `—` until (or forever, if) a price arrives (gap G-13). |
| WL-03 | Remove ticker (UI ×) → `DELETE` (204 / 404) | Basic customization | LOW | A held ticker stays priced (TRD-05) and stays in the positions table. Re-adding a removed, unheld ticker resets its session `open_price`, because `PriceCache.remove` drops the entry, so Chg % restarts at 0 (minor; document it). |

#### AI Chat

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| AI-01 | Chat panel: input, scrolling history, loading indicator, collapsible | Any chat UI | LOW–MEDIUM | Disable send while a request is in flight (one at a time). Auto-scroll to the newest message. Enter sends. |
| AI-02 | History restored on page load (`GET /api/chat/history`, last 50, oldest first) | A reload must not lose the conversation | LOW | Render the stored `actions` JSON exactly as for live responses. |
| AI-03 | Error states: `503` (not configured) and `502` (LLM failed/unparseable) shown in-panel | Without them the AI looks broken, not unconfigured | LOW | Show the `error` text as a distinct system bubble. After a 502 the user message is stored, so a reload shows it without a reply. That's expected; document it. See gap G-15 for 503. |
| AI-04 | `LLM_MOCK=true` deterministic mock through the same execution path | Needed for E2E/CI and for development without a key | LOW–MEDIUM | Matching rules need word boundaries (gap G-14). |

#### Platform / Ops

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| OPS-01 | One-command start (`docker compose up -d --build`, start/stop scripts for sh + ps1) | The whole "students run one command" promise | MEDIUM | Scripts must be idempotent and must not delete the volume. Windows PowerShell parity is required (the developer is on Windows 11). |
| OPS-02 | `lifespan` startup: schema + seed, market source with watchlist ∪ positions, initial snapshot, 30s snapshot task | No first-request races (PLAN §3) | MEDIUM | Single uvicorn worker. `PriceCache` is process-local. |
| OPS-03 | FastAPI serves the Next.js static export at `/`, with API routes under `/api/*` | One origin, no CORS | MEDIUM | Unknown `/api/*` paths must return a JSON 404, not `index.html` (gap G-18). |
| OPS-04 | `GET /api/health` | Docker/compose healthcheck | LOW | Usable as the compose `healthcheck` and as the E2E readiness wait. |
| OPS-05 | Env handling: `.env` via compose `env_file`, `python-dotenv` for local dev, `.env.example` committed | Run without editing code | LOW | The app starts without `OPENROUTER_API_KEY` (chat returns 503). Never log key values. |
| OPS-06 | SQLite persistence in named volume `finally-data` at `/app/db` | Portfolio survives a restart | LOW | `DB_PATH` env. Local default `<repo>/db/finally.db`. |

#### Testing

| ID | Feature | Why Expected | Complexity | Notes |
|----|---------|--------------|------------|-------|
| TST-01 | Backend pytest: trade rules and edge cases, tracked tickers, LLM parsing / partial failure / mock, API shapes and codes, reset | Core Value is "every number stays correct" | MEDIUM | Inject a fake `PriceCache` with fixed prices for determinism. |
| TST-02 | Frontend unit tests: rendering, flash trigger, connection transitions, watchlist CRUD, portfolio calcs, chat rendering | PLAN §12 | MEDIUM | Mock `EventSource`. Use a fake clock for the flash timing. |
| TST-03 | Playwright E2E via `test/docker-compose.test.yml`, `LLM_MOCK=true`, reset before each test, all seven §12 scenarios | PLAN §12 | HIGH | Simulator prices are random, so never assert exact prices or P&L sign (gap G-19). Handle `window.confirm` with `page.on('dialog')`. |

### Differentiators (Competitive Advantage)

These features make FinAlly worth demoing. All are **in PLAN.md and in scope**. They should get the most polish, because they carry the Core Value and the course's "agentic AI" theme.

| ID | Feature | Value Proposition | Complexity | Notes |
|----|---------|-------------------|------------|-------|
| AI-05 | **Agentic auto-execution**: the LLM's structured output (`message`, `trades`, `watchlist_changes`) runs without confirmation | The headline demo. Most real copilots stop at "propose", and fake money lets FinAlly go further | HIGH | Watchlist changes run first, then trades. Each action is independent and runs in order. Per-action `status`/`error`. Validate *each item* separately so one bad item doesn't 502 the whole response (gap G-11). |
| AI-06 | **Portfolio-aware context** in every prompt (cash, positions with P&L, watchlist with live prices, total value) + last 20 messages | Answers are about *your* portfolio, not generic market talk | MEDIUM | Build the context from the same service that produces `GET /api/portfolio`, so the numbers match the UI. Include `Chg %` computed the same way as the frontend (CONCERNS.md notes a possible divergence). |
| AI-07 | **Inline action confirmations** in chat, with failed actions visibly distinct | Makes the agent's actions visible and trustworthy | MEDIUM | Executed: a ✓ chip with side, qty, ticker, fill price. Failed: a red/amber chip with the error. Covers the "what did the AI just do?" question that real copilots answer with confirmation screens. |
| AI-08 | **Templated failure notes** appended to the message (⚠️ Couldn't buy 50 TSLA: insufficient cash (need $X, have $Y)) | Honest about failures without a second LLM call | LOW | Deterministic template per error type. The stored `content` includes the note, so history reproduces it. |
| AI-09 | **Cerebras-fast responses** (1–3s) via LiteLLM → OpenRouter, `gpt-oss-120b` | Makes non-streaming chat feel instant | LOW (skill exists) | Use the `cerebras-inference` skill. Keep reasoning effort low for latency. |
| AI-10 | **Post-action UI sync**: when `actions` is non-null, refetch portfolio, watchlist and history | The rest of the terminal reacts to what the AI did, which is the "wow" moment | LOW | A trade the AI makes should visibly move the heatmap, positions table and cash within ~1s of the reply. |
| PF-07 | **Portfolio heatmap** (in-house squarified treemap, sized by weight, colored by P&L) | Unusual in paper-trading apps and very "terminal" | MEDIUM–HIGH | Squarified layout (Bruls et al.) is ~80 lines. Color intensity scale, empty state, and labels on tiny tiles are unspecified (gap G-06). |
| MD-07 | **Sparklines** (inline SVG polyline) per watchlist row, accumulated from SSE since page load | Dense, alive, Bloomberg-like | LOW–MEDIUM | Needs a point cap. At 2 points/s per ticker, an open tab grows without limit (gap G-02). |
| UX-01 | **Dark, data-dense terminal aesthetic** (`#0d1117`/`#1a1a2e`, yellow `#ecad0a`, blue `#209dd7`, purple `#753991` submits) | First impression; "looks like Bloomberg with an AI copilot" | MEDIUM | Tailwind custom theme. Tabular/monospace numerals (`font-variant-numeric: tabular-nums`) so ticking digits don't jitter. That's a cheap, high-impact detail. |
| OPS-07 | **Zero-setup run**: no login, simulator by default, mock LLM available | Students see value in under a minute | LOW | Mostly covered by OPS-01..06. |
| MD-08 | **Optional real market data** via Massive when `MASSIVE_API_KEY` is set | Real tickers for those who want them | Done | Already built. The UI must tolerate `null` prices and 15s update cadence. |

### Anti-Features (Commonly Requested, Often Problematic)

Each of these is tempting for a "trading terminal". Leave them out. Each would add scope, break a PLAN contract, or hurt the demo.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Limit/stop orders, order book, partial fills, fees, slippage | "Real" trading feel | Needs an order lifecycle, a matching engine and pending-order state. PLAN §3 deliberately chose market orders only | Market orders, instant fill at cached price |
| Trade confirmation dialog (manual or AI) | Industry norm for real money (Public, TradeMind) | Kills the fluid agentic demo. PLAN §2/§9 say explicitly: no confirmation | Deterministic Trade Rules + visible per-action results (AI-07/08) |
| Candlestick/OHLC charts, timeframes, technical indicators (RSI, MACD, MAs) | Every charting terminal has them | Data is 500ms ticks over a 5-minute buffer. Candles would be synthetic and indicators meaningless. It also tempts the agent to pull in extra chart libraries | Line chart of price over time (LWC line/area series) |
| Additional charting libraries (Recharts, D3, Chart.js, treemap packages) | Faster to build the heatmap and sparklines | PLAN §10 forbids them, and they bloat the static bundle | LWC for 2 charts, SVG polyline sparklines, in-house treemap |
| Token-streaming chat | Feels responsive in ChatGPT | Structured output can't execute until it's complete (PLAN §3). Cerebras is fast enough | Loading indicator; 1–3s response |
| Multi-step LLM tool-calling loop / second LLM call to explain failures | "More agentic" | Doubles latency and cost, makes behavior nondeterministic, and is harder to mock for E2E | One structured-output call + templated failure notes |
| Auth, accounts, multi-user, multiple portfolios | Normal for apps | PLAN: single `"default"` user. The schema keeps `user_id` for the future | Hardcoded user |
| Short selling, margin, leverage, options, crypto, FX | Broader market coverage | Breaks the "cash ≥ cost, qty ≤ held" math and P&L model | Long-only equities |
| Realized P&L / tax lots / cost-basis methods (FIFO, LIFO) | Accurate accounting | Not in the API contract. Avg-cost already defines a single basis | Unrealized P&L only. Realized gains show up in cash/total value |
| News feed, fundamentals, earnings calendars, screeners | Bloomberg has them | Needs external data sources and keys. Simulated tickers have no news | The LLM can discuss holdings qualitatively |
| Price alerts / notifications / LLM "watch and trade later" instructions | Common copilot ask | Needs background rule evaluation and triggers orders without the user present, which is the risky case industry critiques flag | Out of scope. Chat acts only on the current message |
| Draggable/resizable docking panels, saved layouts, multiple watchlists | Pro-terminal feel | Large layout-state complexity for little demo value | Fixed responsive grid; collapsible chat only |
| WebSockets / a second SSE stream / polling `/api/portfolio` | "Real-time portfolio" | PLAN §10: compute live values client-side; one stream only | One `EventSource` + client-side math |
| Light theme toggle, mobile-first layout | Accessibility/breadth | Desktop-first dark terminal is the spec | Dark only; functional on tablet |
| Persisting sparklines/chart history to DB | Charts survive reloads | Contradicts "accumulated since page load". The 5-minute history endpoint covers the main chart | In-memory, capped |
| Ticker existence validation against a symbol master | Prevents bogus tickers | The simulator prices anything (PLAN §7). Massive lookups burn the 5 calls/min free tier | Regex validation only; `—` for unpriced tickers |
| Undo trade / edit trade history | Convenience | Trades are an append-only log (PLAN §7) | Place an opposite trade, or Reset |

---

## PLAN.md Gaps & Ambiguities

These are the places where PLAN.md says nothing, or where real implementations commonly go wrong. Each comes with a recommended resolution. Requirements and discuss-phase should confirm or override these. None of the recommendations widens the public API contract.

| ID | Area | Gap / Ambiguity | Recommended Resolution | Severity |
|----|------|-----------------|------------------------|----------|
| G-01 | Market Data UI | **Connection-status semantics.** Per the WHATWG spec, `EventSource` auto-reconnects (readyState `CONNECTING`) on network errors, but goes **permanently `CLOSED`** on any non-200 response or wrong Content-Type (e.g. a 502 from a proxy, or a 500 during a restart). Keep-alive comments fire no events, so the client can't see them. | green = `OPEN` and a message received recently; yellow = `CONNECTING` (or `onerror` while not closed); red = `CLOSED`. On `CLOSED`, recreate the `EventSource` with backoff (e.g. 1s → 2s → 5s, capped), staying red until it reopens. Optionally go red if `CONNECTING` lasts longer than ~10s. Don't infer staleness from tick gaps: in Massive mode ticks come every 15s. | HIGH |
| G-02 | Market Data UI | **Sparkline growth is unbounded.** "Since page load" at ~2 points/s × N tickers grows forever in a long-lived tab. | Cap at a fixed window (e.g. last 300–600 points ≈ 2.5–5 min) or downsample. Clear on reset. Point count is a frontend constant. | MEDIUM |
| G-03 | Portfolio | **P&L chart goes stale.** It loads from `/api/portfolio/history` and refetches only after trades, chat actions and reset, yet snapshots land every 30s. PLAN forbids polling `/api/portfolio`, but says nothing about `/history`. | Refetch `/api/portfolio/history` every 30s (cheap, matches the snapshot cadence), **or** append the client-computed live total as a moving last point. Recommend the 30s refetch for simplicity. Confirm in discuss-phase. | MEDIUM |
| G-04 | Market Data UI / Portfolio | **Chart time zone and precision.** LWC renders numeric times as **UTC** by default, and its default tick labels can't show sub-second times. History/SSE timestamps are fractional Unix seconds. | Pass fractional seconds as-is (supported). Set `localization.timeFormatter` and `timeScale.tickMarkFormatter` to local `HH:MM:SS`. For the P&L chart, convert ISO → `Date.parse()/1000`. Before every `update()`, drop points with `time <= lastTime` (and older ones) to avoid out-of-order errors. | MEDIUM |
| G-05 | Market Data UI | **Default/removed selection.** No rule for which ticker the main chart shows on load, after the selected ticker is removed, or after reset. | Default to the first watchlist ticker. If the selected ticker is removed, select the first remaining one (or show an empty state if the watchlist is empty). On reset, select the first default ticker. | LOW |
| G-06 | Portfolio | **Heatmap color scale and edge cases.** Color "by P&L" doesn't say whether that means absolute P&L or P&L %, or how intensity is clamped. There's no empty state, and labels on tiny tiles aren't covered. | Color by `unrealized_pnl_percent`, with a diverging green/red scale clamped at ±5% (neutral gray near 0). Empty state: "No positions — buy something or ask FinAlly". Hide labels on tiles below a size threshold (use a `title` tooltip). Recompute weights live from SSE prices. | MEDIUM |
| G-07 | Trading | **Money rounding.** Prices are rounded to 2dp in `PriceCache` (good: the fill equals the displayed price). Quantities are rounded to 4dp, so `qty × price` and cash can accumulate float noise (e.g. `8095.000000001`). PLAN doesn't specify whether cash is rounded. | Round trade cost and resulting cash to 2dp (cents) at write time. Compare `cost <= cash + 1e-9`. Format all money in the UI with 2dp. | MEDIUM |
| G-08 | Trading | **Concurrent trades.** A manual trade and an LLM trade (or two tabs) can interleave a read-check-write on cash/position. | Serialize trade execution: one `asyncio.Lock` (or `threading.Lock`) around the trade service, plus `BEGIN IMMEDIATE` transactions. A single uvicorn worker makes an in-process lock sufficient. | MEDIUM |
| G-09 | Trading | **Manual-trade success feedback** isn't specified (only error display is). | Brief inline success message using `trade.price` from the response, which auto-clears. Keep the ticker field and clear the quantity field. | LOW |
| G-10 | Trading | **Sell tolerance clamp.** "`quantity <= held` with 1e-6 tolerance": selling `held + 5e-7` passes the check, but the stored quantity would go negative. | Clamp the sold quantity to `min(requested, held)` when within tolerance, then apply the dust rule. Also reject a quantity that rounds to `0` at 4dp. | LOW |
| G-11 | AI Chat | **Per-item vs whole-response validation.** If one `trades[]` item is malformed (`side: "short"`, negative or missing quantity), does the whole response 502, or does just that action fail? | Validate the envelope strictly (`message` required, arrays optional), but validate each action item individually and mark invalid ones `failed` with an error. Return 502 only when JSON or `message` can't be parsed. Matches "each action runs independently". | HIGH |
| G-12 | Portfolio | **Percent units.** `unrealized_pnl_percent: 0.0105` in the example is already a percentage (0.20 / 1905 × 100), as is SSE `change_percent`. It's easy to multiply by 100 again or read it as a fraction. | Document it in requirements: every `*_percent` field is percent units, rounded to 4dp server-side. The UI displays it with 2dp and a `%` sign. | MEDIUM |
| G-13 | Watchlist | **Watchlist size cap / bogus tickers.** There's no cap. The LLM can add many tickers, and simulator setup is O(n²) per add (CONCERNS.md). In Massive mode a typo'd ticker never gets a price. | Cap the watchlist at 50 (400 with a clear message, which also applies to LLM adds). Unpriced tickers render `—`, and buying them hits the existing "No price available" rule. | MEDIUM |
| G-14 | AI Chat | **Mock matching is substring-based.** "contains `buy`" matches "buyer", `sell` matches "bestseller", `add <TICKER>` could match "address". Ticker extraction and case aren't defined. | Match case-insensitively with word boundaries: `\bbuy\b`, `\bsell\b`, `\badd\s+([A-Za-z][A-Za-z0-9.]{0,9})\b`, `\bremove\s+(...)`. Uppercase the captured ticker. Keep first-rule-wins order. Mock "sell" with no AAPL held should exercise the failure-note path; that's a good E2E/unit case. | MEDIUM |
| G-15 | AI Chat | **503 path storage.** PLAN says a 502 still stores the user message, but doesn't say whether a 503 (no API key) does. Empty or very long messages aren't covered either. | 503: check configuration **before** storing anything, so nothing is stored. Reject empty/whitespace messages with 400. Cap length (e.g. 2,000 chars → 400). | LOW |
| G-16 | Platform | **Reset vs in-flight chat.** A chat request in flight during a reset can write its assistant message and execute trades into the freshly reset account. | Accept this as a demo limitation, or have reset take the same trade lock (G-08) and have the frontend disable reset while chat is pending. Recommend the frontend disable plus the shared lock. | LOW |
| G-17 | AI Chat | **Dollar-amount and "sell all" intents.** The schema only has `quantity`. Users say "buy $1,000 of NVDA" or "sell all my TSLA". | System prompt instructs: convert dollar amounts using the price in context (fractional shares allowed, 4dp), and use the exact held quantity for "all". No schema change. Also instruct plain text, no markdown tables (rendering markdown would need a library), with `whitespace-pre-wrap` in the UI. | MEDIUM |
| G-18 | Platform | **Static serving vs API 404s.** A catch-all static mount can swallow unknown `/api/*` paths (returning HTML 200) and break PLAN §8's JSON 404 contract. Next.js export routing (`trailingSlash`, `index.html`) needs a decision. | Register all `/api` routers first, add an `/api/{path:path}` JSON 404 fallback, then mount `StaticFiles(directory=static, html=True)` at `/`. Single-page app, so only `/` needs to resolve. | MEDIUM |
| G-19 | Testing | **E2E nondeterminism.** The simulator is random, so "heatmap renders with correct colors" can't assume profit or loss after a buy. Prices change between read and assert. | Assert that tile color *matches the sign of the displayed P&L* (read both from the DOM via `data-*` attributes), not a fixed color. Assert cash decreased, not an exact value. Expose `data-testid` hooks. Optionally support a seeded simulator for tests (not required). | HIGH |
| G-20 | Watchlist / AI Chat | **Idempotent LLM watchlist actions.** What `status` does an LLM "add" of an already-watched ticker get? And a "remove" of an unwatched one? | Add of an existing ticker → `executed` (mirrors the 200 idempotent REST). Remove of a missing ticker → `failed`, "PYPL is not on your watchlist". | LOW |
| G-21 | AI Chat | **Action volume per response.** Nothing limits the LLM to a sane number of actions (e.g. 30 trades). | Cap at ~10 trades + ~10 watchlist changes per response. Extra actions are `failed` ("too many actions"). | LOW |
| G-22 | Portfolio / Trading | **No trade-history UI or endpoint.** `trades` is stored but no `GET` exposes it, and no panel shows it. Most paper-trading apps have an activity list. | **Don't add one in v1** (scope is fixed). Chat action chips + the P&L chart cover the demo. Record it as a v1.x candidate. | INFO |
| G-23 | Market Data UI | **Watchlist vs held-but-unwatched tickers.** SSE includes held tickers not on the watchlist. The watchlist panel must filter by `/api/watchlist`; positions use all SSE tickers. | Frontend keeps one `prices` map for all tickers. The watchlist renders from the watchlist list, and positions/heatmap/header read from the same map. | LOW |

---

## Feature Dependencies

```
Backend foundation
[OPS-02 lifespan + DB schema/seed (OPS-06)]
    ├──requires──> existing PriceCache + MarketDataSource (DONE)
    └──enables──> everything below

[TRD-03 Trade Rules service]
    ├──requires──> DB layer, PriceCache (fill price)
    ├──requires──> [TRD-05 tracked-ticker service] (sell-to-zero drops unwatched ticker)
    └──triggers──> [PF-05 snapshot]

[PF-03 GET /api/portfolio] ──requires──> DB positions + PriceCache (avg_cost fallback)
[PF-04 P&L chart] ──requires──> [PF-05 snapshots] + GET /api/portfolio/history
[PF-07 heatmap] ──requires──> [PF-03 weight] + SSE prices (live recompute)
[PF-06 reset] ──requires──> DB layer + [TRD-05] (re-sync) + [PF-05]

[WL-02/03 watchlist CRUD] ──requires──> [TRD-05 tracked-ticker service]

[AI-05 auto-execution]
    ├──requires──> [TRD-03] (same rules as manual trades)
    ├──requires──> [WL-02/03] service functions (not HTTP routes)
    └──requires──> [AI-06 context] ──requires──> [PF-03] portfolio service
[AI-04 mock] ──enhances──> [AI-05] (same execution path) and enables [TST-03]
[AI-07 inline confirmations] ──requires──> [AI-05] actions shape
[AI-10 post-action refetch] ──requires──> PF/WL frontend stores

Frontend
[MD-01 single EventSource store]
    ├──enables──> MD-02, MD-03, MD-04, MD-07 (watchlist)
    ├──enables──> MD-05 main chart (+ history endpoint, DONE)
    └──enables──> PF-01, PF-02, PF-07 (live client-side valuation)

[OPS-03 static serving] ──requires──> frontend build (Next.js export) + all /api routes registered first
[OPS-01 Docker/scripts] ──requires──> OPS-03 + backend complete
[TST-03 E2E] ──requires──> OPS-01 + AI-04 mock + data-testid hooks in UI

Conflicts
[Polling /api/portfolio] ──conflicts──> [PF-01 client-side live valuation] (PLAN §10)
[Confirmation dialog] ──conflicts──> [AI-05 auto-execution]
[Token streaming] ──conflicts──> [AI-05 structured output parse-then-execute]
```

### Dependency Notes

- **AI-05 requires TRD-03 and the watchlist/tracked-ticker *services*, not their HTTP routes.** The LLM executor must call the same Python functions the routes call. If chat goes through HTTP, or duplicates the rules, manual and AI trades will diverge. So the trade and watchlist services must exist before chat.
- **TRD-05 (tracked tickers) underlies trading, watchlist removal and reset.** Build it once, early, with the PLAN §12 tests ("watchlist removal keeps a held ticker priced; selling to zero drops an unwatched ticker").
- **The frontend's single price store (MD-01) underlies every live panel.** Build it first in the frontend phase, along with the connection-status logic (G-01), before the watchlist, chart, header or positions panels.
- **AI-04 mock enables E2E (TST-03).** E2E must not need an API key. The mock must go through the real executor, or the E2E chat test proves nothing.
- **PF-04 depends on PF-05 snapshots,** which depend on the lifespan task. A fresh DB shows one snapshot, so test the one-point chart.
- **Frontend can be developed against the API contract in parallel with backend phases** once §8 shapes are fixed. Mock fetch responses in unit tests.

---

## MVP Definition

### Launch With (v1) — the full PLAN.md milestone

All of these are required by PLAN.md. Ordered roughly by dependency.

- [ ] OPS-02, OPS-05, OPS-06: lifespan, DB schema/seed, env loading. Everything depends on them.
- [ ] TRD-05: tracked-ticker service. Integrity of valuation.
- [ ] TRD-03, PF-03, PF-05, PF-06: trade rules, portfolio, snapshots, reset. Core Value: correct numbers.
- [ ] WL-01..03: watchlist CRUD with tracked-ticker integration.
- [ ] AI-05, AI-06, AI-08, AI-04, AI-03, AI-02: chat with auto-execution, context, failure notes, mock, errors, history. The differentiator.
- [ ] OPS-03, OPS-04: static serving + health.
- [ ] MD-01..07, PF-01, PF-02, PF-04, PF-07, TRD-01, TRD-02, TRD-04, AI-01, AI-07, AI-10, UX-01: the full frontend.
- [ ] OPS-01: Dockerfile, compose, start/stop scripts (sh + ps1).
- [ ] TST-01..03: backend, frontend and E2E tests.

### Add After Validation (v1.x) — not in PLAN; only if explicitly requested

- [ ] Trade history panel + `GET /api/trades`: add if users ask "what did I trade?" beyond chat chips (G-22)
- [ ] Click a position row or heatmap tile to select it in the main chart: cheap, natural extension of MD-06
- [ ] Header "P&L since start" (`total_value - 10000`): one line of math, high glanceability
- [ ] Suggested prompt chips in an empty chat ("Analyze my portfolio", "Buy 5 NVDA"): improves first-run discoverability
- [ ] Keyboard shortcuts (`/` focuses chat, `B`/`S` focus trade bar): terminal feel
- [ ] Seeded/deterministic simulator mode for E2E: if G-19 flakiness persists

### Future Consideration (v2+)

- [ ] Multi-user/auth: the schema already carries `user_id`. Needs a product reason first.
- [ ] Limit orders / alerts: needs an order lifecycle and background evaluation
- [ ] Cloud deploy (Terraform App Runner): PLAN §11 stretch goal

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TRD-03 Trade Rules service (+ G-07/08/10) | HIGH | MEDIUM | P1 |
| TRD-05 Tracked-ticker service | HIGH | MEDIUM | P1 |
| PF-01/02/03 Live portfolio (header, table, endpoint) | HIGH | LOW | P1 |
| MD-01..04 Live watchlist + flash + connection status | HIGH | MEDIUM | P1 |
| AI-05/06/08 Chat with auto-execution, context, failure notes | HIGH | HIGH | P1 |
| AI-04 LLM mock | HIGH (enables tests) | LOW | P1 |
| AI-07 Inline action chips | HIGH | MEDIUM | P1 |
| OPS-01..06 Startup, static serving, Docker, scripts | HIGH | MEDIUM | P1 |
| MD-05 Main chart (history + SSE) | HIGH | MEDIUM | P1 |
| PF-07 Heatmap | MEDIUM–HIGH | MEDIUM–HIGH | P1 (PLAN) |
| PF-04/05 P&L chart + snapshots | MEDIUM | MEDIUM | P1 (PLAN) |
| MD-07 Sparklines | MEDIUM | LOW | P1 (PLAN) |
| PF-06 Reset | MEDIUM | MEDIUM | P1 (PLAN) |
| TST-01..03 Tests | HIGH (correctness) | HIGH | P1 (PLAN) |
| v1.x candidates (trade history, P&L since start, prompt chips) | MEDIUM | LOW | P3 (not in PLAN) |

All PLAN features are P1 because the milestone is "everything in PLAN.md". For sequencing, the matrix shows where risk concentrates: trade rules, tracked tickers, the AI executor and E2E.

---

## Competitor Feature Analysis

| Feature | Paper-trading platforms (TradingView, IBKR paper, paperMoney) | AI broker copilots (Robinhood Cortex, Public Alpha/Agents) | FinAlly approach |
|---------|------------------|------------------|--------------|
| Order types | Market, limit, stop, often brackets | n/a or limited supported transactions | Market only (PLAN §3) |
| Fill model | Live-price fills, sometimes with simulated costs | Real broker | Instant fill at cached price, no fees |
| Positions/P&L | Real-time positions and P&L, realized + unrealized | Portfolio summaries/digests | Unrealized P&L, live client-side; realized shows up only in cash |
| Account reset | Yes (semantics vary; TC2000 wipes history, IBKR cash only) | n/a | Full wipe incl. chat and watchlist, then a fresh snapshot |
| AI trade execution | None | Mostly explain/summarize. Execution gated by explicit user sign-off and rule checks | **Auto-execute** structured actions through the same deterministic Trade Rules; per-action results shown inline |
| AI failure reporting | n/a | Confirmation screens | Templated ⚠️ notes appended, no second LLM call |
| Visualization | Full charting suites with indicators | App-native charts | 2 LWC line charts + SVG sparklines + in-house treemap |
| Setup | Account signup | Account + subscription (Cortex is in the Gold tier) | One Docker command, no login |

---

## Sources

- `planning/PLAN.md`: the contract (HIGH)
- `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `backend/app/market/cache.py` / `models.py`: existing behavior, e.g. 2dp price rounding, `open_price` reset on remove (HIGH, read directly)
- [WHATWG HTML: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html): reconnect vs fail-the-connection rules (HIGH)
- [Lightweight Charts ISeriesApi docs](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi): `update()`/`setData()` ordering semantics (MEDIUM)
- [lightweight-charts issue #1884](https://github.com/tradingview/lightweight-charts/issues/1884): fractional-second numeric times are supported; custom formatters are needed for display (MEDIUM)
- [TradingView Paper Trading main functionality](https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/), [TC2000 practice account reset](https://help.tc2000.com/m/69435/l/863440-how-to-reset-or-remove-a-practice-trading-account), [IBKR Paper Trading Account Reset](https://www.interactivebrokers.com.au/en/software/advisors/topics/papertradingaccountreset.htm), [WealthCharts Paper Trading](https://www.wealthcharts.com/trading/paper-trading): paper-trading feature norms (LOW–MEDIUM, web search summaries)
- [Robinhood Cortex support](https://robinhood.com/us/en/support/articles/cortex), [Cortex disclosure](https://cdn.robinhood.com/assets/robinhood/legal/cortex_assistant_disclosure.pdf), [Public Alpha launch](https://fxnewsgroup.com/forex-news/retail-forex/public-introduces-ai-based-investing-co-pilot-alpha/), [Which brokers have an AI assistant](https://walnutinvest.com/resources/which-brokers-have-an-ai-assistant): AI copilot capabilities. Sources conflict on Cortex trade execution (LOW)
- [TradeMind (Alpaca hackathon)](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/trademind/trademind-ai-options-trading-and-risk-engine), [OFFLeash guardrails](https://lablab.ai/ai-hackathons/alpaca-ai-trading-agents-hackathon/khata-lemo/offleash-guardrails-for-ai-trading-agents): propose-then-confirm and deterministic-guardrail patterns (LOW)

---
*Feature research for: AI-powered simulated trading workstation (FinAlly)*
*Researched: 2026-10-23*
