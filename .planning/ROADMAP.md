# Roadmap: FinAlly — AI Trading Workstation

## Overview

FinAlly goes from a finished market-data engine to a complete AI trading terminal in three vertical slices. Each slice is a working app the user opens at `http://localhost:8000`. Phase 1 is the walking skeleton: one start script builds the container, and the user watches the default watchlist stream live, charts any ticker and edits the watchlist. Phase 2 adds money: manual trades through one shared trade service, a live client-side portfolio (header, positions, heatmap, P&L chart, trade history) and account reset. Phase 3 adds the AI copilot, which executes trades and watchlist changes through the same services, completes the full terminal layout, and proves the product with backend, frontend and Playwright suites. Every phase integrates the existing `backend/app/market/` subsystem as-is; none rebuilds it.

**Coverage:** 64/64 v1 requirements mapped (traceability in `.planning/REQUIREMENTS.md`).

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Live Market Terminal** - One command launches the container; the user watches a dark terminal stream, chart and edit a live watchlist (completed 2026-10-27)
- [x] **Phase 2: Trading and Live Portfolio** - The user trades from the trade bar and sees cash, positions, heatmap, P&L and trade history update live, then can reset (completed 2026-10-28)
- [x] **Phase 3: AI Copilot and Complete Terminal** - The user trades and manages the watchlist by chatting with FinAlly; the full terminal is proven end to end (completed 2026-10-30)

## Phase Details

### Phase 1: Live Market Terminal

**Goal**: A user runs one start script, opens `http://localhost:8000`, and watches a dark trading terminal stream live prices for a watchlist they can chart, add to and remove from
**Mode:** mvp
**Depends on**: Nothing (first phase; integrates the completed `backend/app/market/` subsystem)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08, WL-01, WL-02, WL-03, WL-04, WL-05, MD-01, MD-02, MD-03, MD-04, MD-05, MD-06, MD-07, UX-01
**Success Criteria** (what must be TRUE):
  1. On Windows (`scripts/start_windows.ps1`) or macOS/Linux (`scripts/start_mac.sh`), one command builds and starts a single container and prints the URL; `http://localhost:8000` shows a dark terminal (no pure black; yellow, blue and purple accents) with the 10 default tickers (AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX) already streaming in simulator mode with no API keys; re-running the start script is harmless, and the stop script leaves the data volume intact.
  2. Each watchlist row shows its ticker, a price that flashes green on an uptick or red on a downtick and fades over about 500ms, Chg % since session open (`—` until priced), and a sparkline that fills in from page load; tabular digits don't jitter as they tick.
  3. Clicking a watchlist row shows a larger chart of that ticker, already filled with the last ~5 minutes of prices and extending live with local `HH:MM:SS` times; the first ticker is selected on load, and removing the selected ticker selects the first remaining one.
  4. User can add a ticker from the watchlist panel (it starts pricing immediately in simulator mode) and remove one; re-adding a watched ticker is harmless, a malformed symbol or a 51st ticker shows a clear error, and watchlist edits survive a stop and start because the database lives in the `finally-data` volume and seeding never duplicates or overwrites rows.
  5. The header dot is green while streaming, yellow while reconnecting and red when closed, and turns green again on its own once the server is back; `GET /api/health` returns `{"status": "ok"}` and drives the compose healthcheck, and any unknown `/api/*` path returns a JSON 404 rather than the terminal page.

**Plans**: 7/7 plans complete

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Wave 0: package-legitimacy gate, FastAPI/Starlette 1.x bump (139-test gate), Next.js 16 static-export scaffold with the dark theme

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-02-PLAN.md — Walking-skeleton tracer: seeded watchlist → lifespan → SSE → static-export page; health, JSON 404, opt-in dev CORS

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-03-PLAN.md — Container (Dockerfile, compose, finally-data volume), idempotent start/stop scripts, dev-loop and LAN-exposure docs
- [x] 01-04-PLAN.md — Watchlist add/remove API with the 50 cap, tracked-ticker reconcile, initial and 30s snapshots, Settings tests
- [x] 01-05-PLAN.md — Terminal grid, reconnecting stream with connection dot, dense rows (flash, Chg %, sparkline, selection)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-06-PLAN.md — Main Lightweight Charts price chart: history seed, live append, Open line, loading/empty states
- [x] 01-07-PLAN.md — Watchlist add input and row × remove wired to the API, shared client regex, inline errors

**UI hint**: yes

### Phase 2: Trading and Live Portfolio

**Goal**: The user can buy and sell shares from the trade bar and watch cash, positions, the heatmap, the P&L chart and trade history update live and stay correct to the cent, then reset to a fresh $10,000 account
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: TRD-01, TRD-02, TRD-03, TRD-04, TRD-05, TRD-06, TRD-07, TRD-08, TRD-09, TRD-10, WL-06, PF-01, PF-02, PF-03, PF-04, PF-05, PF-06, PF-07, PF-08, PF-09, MD-08
**Success Criteria** (what must be TRUE):
  1. User enters a ticker and a quantity (fractional allowed) and clicks Buy or Sell; the order fills instantly at the current streamed price with no confirmation dialog, a brief self-clearing "Bought 10 AAPL @ $190.52" message appears, the quantity field clears, cash moves by exactly the trade cost to the cent (even under rapid repeated clicks), and the trade appears at the top of the trade history panel.
  2. An invalid order (insufficient cash, selling more than held, a quantity that rounds to zero, a malformed or unpriced ticker) shows the server's message inline beside the trade bar and changes nothing; the message clears on the next edit; selling a whole position removes it from the positions table and heatmap at once.
  3. The header total value, cash and P&L since start, the positions table (quantity, avg cost, current price, P&L and P&L % in green/red) and the heatmap (tiles sized by weight, shaded by P&L %) all move live with streamed prices without polling `/api/portfolio`; with no positions the heatmap reads "No positions — buy something or ask FinAlly"; clicking a position row or heatmap tile charts that ticker.
  4. The P&L chart plots total portfolio value from snapshots recorded at startup, every 30 seconds and after each trade; it renders sensibly with a single point and refreshes every 30 seconds and after each trade.
  5. A held ticker removed from the watchlist keeps streaming and keeps its live P&L, and selling an unwatched ticker to zero stops pricing it; after confirming Reset in the header, the user sees $10,000 cash, no positions or trades, a fresh P&L starting point, and the default watchlist.

**Plans**: 7/7 plans complete

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Tracer: trade bar Buy/Sell → TradeService (shared lock, one transaction) → route → portfolio store → inline fill message

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-02-PLAN.md — In-transaction trade snapshot, tracked-ticker reconcile, every trade rule, cent rounding, exact half-cent P&L and the parallel-buy proof
- [x] 02-03-PLAN.md — Portfolio load on mount and reconnect, live header Total/Cash/P&L since start (server parity to the cent), held-aware chart selection

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-04-PLAN.md — Live positions table and squarified heatmap with click-to-chart
- [x] 02-05-PLAN.md — Trade bar feedback (client checks, inline errors, auto-clearing fill message) and the trade history (GET /api/trades)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 02-06-PLAN.md — P&L BaselineSeries chart from snapshot history, and confirmed one-transaction Reset (PLAN §8 contract) with tracked-ticker re-sync

**Wave 5** *(gap closure; blocked on Wave 4 completion)*
- [x] 02-07-PLAN.md — Gap closure: MAX_QUANTITY cap and DomainError backstops so a huge quantity is a 400, not a 500 (CR-01); StrictFloat trade quantity so true or "10" is a 422 (WR-03)

**UI hint**: yes

### Phase 3: AI Copilot and Complete Terminal

**Goal**: The user can ask FinAlly in plain language to analyze the portfolio, trade and manage the watchlist, see every requested action execute instantly through the same rules as manual trades, and use the finished terminal with every panel on screen, proven by the full unit and end-to-end suites
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08, AI-09, AI-10, AI-11, AI-12, AI-13, AI-14, AI-15, AI-16, PF-10, UX-02, TST-01, TST-02, TST-03, TST-04
**Success Criteria** (what must be TRUE):
  1. Asking "Analyze my portfolio" returns a concise plain-text answer that cites the user's actual cash, positions and P&L; typing "Buy 5 NVDA" (or clicking a starter prompt chip in an empty chat) and pressing Enter shows a loading indicator, blocks a second send, and returns a reply with an inline chip (side, quantity, ticker, fill price), after which positions, heatmap, cash, P&L chart, watchlist and trade history reflect the trade within about a second.
  2. When a requested action can't run (insufficient cash, removing an unwatched ticker, more than 10 trades or 10 watchlist changes, a malformed item), the reply carries a templated "Couldn't ..." warning note and a visibly distinct failed chip, while the other actions in the same reply still execute.
  3. Without `OPENROUTER_API_KEY` the app still starts and the chat shows a "not configured" system bubble; an LLM failure or unreadable reply shows an error bubble while the user's message is kept; an empty or over-long message is rejected with a clear bubble; with `LLM_MOCK=true`, "buy", "sell", "add PYPL" and "remove PYPL" behave deterministically with no API key.
  4. Reloading the page restores the last 50 chat messages with their action chips exactly as they first appeared; Reset (disabled while a chat request is in flight) clears the chat panel, sparklines and chart selection and refetches every panel.
  5. On a wide screen the header, watchlist, main chart, heatmap, P&L chart, positions table, trade bar and collapsible chat panel are all visible at once and stay usable on a tablet; the backend pytest, frontend unit and Playwright suites pass, with E2E run from `test/docker-compose.test.yml` under `LLM_MOCK=true`, resetting before each test and covering all seven PLAN §12 scenarios.

**Plans**: 5/5 plans complete

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — Tracer: "buy" in the chat panel → POST /api/chat → ChatService (mock LLM → parse → TradeService) → stored reply → chip and panel refetch

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-02-PLAN.md — Every chat rule: lenient parse, per-item validation, 10 + 10 caps, G-20, ⚠️ failure notes, 400/502, FinAlly prompt with live context and 20-message history, GET /api/chat/history
- [x] 03-03-PLAN.md — Complete chat panel (history reload, Enter, loading, chips, bubbles, prompt chips, collapse), PF-10 reset, all panels at once, test hooks
- [x] 03-04-PLAN.md — Blocking legitimacy gate, litellm 1.106.2, OpenRouter → Cerebras client (strict schema, off-loop), key setting, 503 when unconfigured, human-run spike

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-05-PLAN.md — Isolated Playwright E2E (seven PLAN §12 scenarios + layout) from test/docker-compose.test.yml, and the full-suite phase gate

**UI hint**: yes

## Planning Notes

**Cross-phase clauses.** Each requirement maps to the phase that ships its main capability. Where a requirement also says how it reacts to something that arrives later, the later phase wires that part in:
- Reset clearing sparklines (MD-05) and resetting the chart selection (MD-07) ships with PF-10 in Phase 3. Phase 2's reset (PF-09) restores server state and refreshes the portfolio and watchlist panels.
- Refetching the P&L chart (PF-08) and trade history (TRD-10) after chat actions ships with AI-15 in Phase 3.
- The 50-ticker cap (WL-05) and the trade rules (TRD-01..05) cover AI actions because AI-05 routes them through the same services.
- Positions, heatmap and header read held-but-unwatched tickers from the shared price map that Phase 1 builds (MD-01).
- Phase 1 can build the tracked-ticker reconcile (watchlist ∪ positions) right away; WL-06's position behaviors are verified in Phase 2.
- Phase 1 lays out the terminal grid with room for every panel; UX-02 is verified in Phase 3 once all panels exist.

**Tests.** Every phase ships unit tests for its own slice (Nyquist validation is on). TST-01 and TST-02 map to Phase 3 because their checklists span all three slices; Phase 3 closes any remaining gaps. Add `data-testid` hooks and P&L-sign `data-*` attributes (TST-04) as each panel is built, not as a retrofit.

**Parallel work.** Within each phase, backend and frontend plans can run in parallel against the PLAN §6/§8 contract, frozen as backend response models and `src/api/types.ts` with exact-key tests.

**Research flags** (detail in `.planning/research/SUMMARY.md`):
- Phase 1 (light): FastAPI/Starlette 1.x bump with the 139 market tests re-run; Next.js 16 static export, Tailwind 4 and Vitest on Node 22 (fnm, `.nvmrc` = 22); dev-loop choice (opt-in CORS or building the export); Docker traps (graceful shutdown with open SSE streams, Python healthcheck because slim images lack `curl`, npm lockfile with Linux optional native packages, a tolerant `env_file`); executable bit on `.sh` scripts and ASCII-only `.ps1` scripts.
- Phase 2 (none): standard patterns that need careful tests (parallel-buy race, cent rounding, "buy max" succeeds).
- Phase 3 (deep): a live-call spike with the final schema against Cerebras (strict mode, `require_parameters`, empty content with reasoning tokens, fallback policy) before building the pipeline; follow the project `cerebras` skill but call `acompletion` so the event loop never blocks; the AI design contract (`/gsd-ai-integration-phase`) is enabled in config; pin `@playwright/test` to the Playwright container image version.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Live Market Terminal | 7/7 | Complete    | 2026-10-27 |
| 2. Trading and Live Portfolio | 7/7 | Complete    | 2026-10-28 |
| 3. AI Copilot and Complete Terminal | 5/5 | Complete    | 2026-10-30 |

## Backlog

### Phase 999.1: Follow-up — Phase 01 deferred UAT follow-up: Test 5 (BACKLOG)

**Goal:** Resolve the UAT checkpoint deferred during Phase 01 verification
**Source phase:** 01
**Deferred at:** 2026-10-27 during /gsd-verify-work 01 session completion
**Follow-ups:**
- [ ] Test 5: Verify start_mac.sh browser launch (open/xdg-open) and safe re-run on a macOS/Linux desktop (deferred 2026-10-27)
