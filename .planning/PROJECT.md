# FinAlly — AI Trading Workstation

## What This Is

FinAlly (Finance Ally) is a single-container AI trading workstation. It streams live (simulated or real) market prices, lets the user trade a $10,000 simulated portfolio, and has an LLM chat copilot that analyzes positions and executes trades and watchlist changes in plain language. It looks like a dark, data-dense Bloomberg-style terminal. It is a course capstone that shows how orchestrated AI coding agents can build a production-quality full-stack app. Students run it with one Docker command and open `http://localhost:8000`, with no login and no setup.

The full product specification is `planning/PLAN.md`. This document captures the project context; PLAN.md stays the detailed contract for API shapes, schema, and behavior.

## Core Value

A user can open one URL, watch prices stream live, and trade a simulated portfolio, either manually or by asking the AI copilot, with every number (cash, positions, P&L) staying correct and updating in real time.

## Requirements

### Validated

<!-- Inferred from existing code (backend/app/market/, 139 passing tests). See .planning/codebase/. -->

- ✓ `MarketDataSource` interface with two implementations, selected by `MASSIVE_API_KEY` — existing
- ✓ GBM simulator: ~500ms ticks, correlated moves, random 2–5% events, realistic seed prices, deterministic random seed price for unknown tickers, new tickers priced immediately — existing
- ✓ Massive (Polygon) REST poller with `MASSIVE_POLL_INTERVAL` (default 15s) and LIVE→EOD fallback for free-tier keys — existing
- ✓ Thread-safe `PriceCache` with latest/previous price, session open price, 5-minute history ring buffer per ticker, and a version counter — existing
- ✓ `GET /api/stream/prices` SSE (`retry: 1000`, one event with all tickers, `open_price` field, keep-alive) via the `create_stream_router` factory — existing
- ✓ `GET /api/prices/{ticker}/history` returning the last ~5 minutes of points — existing
- ✓ All PLAN.md §6 **[change]** items and all 15 findings in `planning/MARKET_DATA_REVIEW.md` are implemented and tested — existing
- ✓ FastAPI `create_app` factory with a `lifespan` hook: schema and seed once, market source started with watchlist ∪ positions, initial snapshot, 30s snapshot task — Phase 1
- ✓ SQLite via stdlib `sqlite3` at `DB_PATH`: six-table `schema.sql` with `user_id` and an idempotent seed (default user with $10k, 10-ticker watchlist) — Phase 1
- ✓ Environment loading: `python-dotenv` reads `../.env` in local dev; real env vars take precedence — Phase 1
- ✓ `GET /api/health`, JSON 404 for unknown `/api/*`, static serving of the Next.js export at `/` — Phase 1
- ✓ `GET/POST/DELETE /api/watchlist` with PLAN §8 status codes and the 50-ticker cap — Phase 1
- ✓ Tracked-ticker reconcile (watchlist ∪ positions) as the only caller of `add_ticker`/`remove_ticker` — Phase 1 (position behaviors verified in Phase 2)
- ✓ Header connection status dot (green/yellow/red) with automatic reconnect — Phase 1
- ✓ Watchlist panel: flashing price, Chg % from session open, inline SVG sparkline, add/remove with inline errors — Phase 1
- ✓ Main chart (Lightweight Charts) seeded from the history endpoint and extended from SSE — Phase 1
- ✓ Multi-stage Dockerfile (Node 22 → Python 3.12 + uv, one uvicorn worker), `docker-compose.yml` with `finally-data`, idempotent start/stop scripts, `.env.example`, `db/.gitkeep` — Phase 1 (`start_mac.sh` browser launch still unverified on macOS/Linux; ROADMAP backlog 999.1)

### Active

<!-- Everything else in planning/PLAN.md. Hypotheses until shipped. -->

**Portfolio & trading**
- [ ] `POST /api/portfolio/trade`: market orders at the cached price, shared Trade Rules (ticker regex, qty > 0 rounded to 4dp, cash/shares checks with 1e-6 tolerance, avg-cost math, dust removal), one transaction, then a snapshot; returns trade plus updated portfolio
- [ ] `GET /api/portfolio`: cash, positions value, total, unrealized P&L, per-position P&L, P&L %, and weight; falls back to avg cost when no price is cached
- [ ] `GET /api/portfolio/history`: snapshots oldest first
- [ ] `POST /api/reset`: one transaction restores the seeded state, re-syncs tracked tickers, and records a fresh snapshot

**Tracked tickers**
- [ ] Removing a held ticker from the watchlist keeps it priced; selling an unwatched ticker to zero drops it (reconcile exists; verify with positions)

**AI chat**
- [ ] `POST /api/chat` via LiteLLM → OpenRouter (`openrouter/openai/gpt-oss-120b`, Cerebras provider) with structured output (`message`, `trades`, `watchlist_changes`)
- [ ] Portfolio context and the last 20 messages in the prompt; FinAlly system prompt
- [ ] Auto-execution: watchlist changes first, then trades; each action independent; per-action status recorded in `actions`
- [ ] Templated ⚠️ failure notes appended to the message; no second LLM call
- [ ] `GET /api/chat/history` (last 50 messages, oldest first)
- [ ] `LLM_MOCK=true` deterministic mock (buy / sell / add X / remove X / greeting) through the same execution path
- [ ] Missing `OPENROUTER_API_KEY` → 503; LLM failure or unparseable output → 502 with the user message still stored

**Frontend (Next.js static export, TypeScript, Tailwind dark theme)**
- [ ] Header: live total value, cash, Reset with `window.confirm`
- [ ] Portfolio heatmap: in-house squarified treemap sized by weight, colored by P&L
- [ ] P&L chart (Lightweight Charts) from `/api/portfolio/history`
- [ ] Positions table: ticker, qty, avg cost, current price, unrealized P&L, P&L %
- [ ] Trade bar: ticker, quantity, buy/sell, inline 400 errors
- [ ] AI chat panel: collapsible, history loaded on page load, loading indicator, inline action confirmations, failed actions visibly distinct
- [ ] Data flow: live values computed client-side from SSE plus positions; refetch after chat actions; full refetch and cleared chat/sparklines after reset

**Packaging & ops**
- [ ] Start scripts reuse an existing `finally:latest` image after code changes unless `--build` is passed; rebuild when sources are newer, or say so in the README quick start (UAT 01 gap, minor)

**Testing**
- [ ] Backend pytest: tracked tickers, trade logic and edge cases, LLM parsing, partial failures and mock mode, API status codes and shapes, reset
- [ ] Frontend unit tests: rendering, price flash, connection status transitions, watchlist CRUD, portfolio calculations, chat rendering
- [ ] Playwright E2E in `test/` with `docker-compose.test.yml`, `LLM_MOCK=true`, reset before each test, covering all §12 scenarios

### Out of Scope

- Authentication, signup, multi-user — single hardcoded `"default"` user by design; the schema keeps `user_id` for the future
- Limit orders, order book, partial fills, fees, confirmation dialogs — market orders with instant fill keep the portfolio math simple
- Streaming (token-by-token) chat responses — structured output must be complete before it can be parsed and executed
- WebSockets — SSE covers one-way push
- ORM or Postgres — six small tables in SQLite with stdlib `sqlite3`
- Pruning snapshots or trades — the volume is trivial for SQLite
- Charting libraries other than Lightweight Charts — sparklines are inline SVG, the heatmap is in-house
- Cloud deployment (Terraform/App Runner) — stretch goal, not part of the core build
- Rewriting the market data subsystem — it is complete and tested; change it only where integration requires

## Context

- **Current state (after Phase 1):** the walking skeleton ships in one container: app entry point, SQLite, watchlist API, SSE-driven terminal with watchlist, sparklines and main chart, Docker and start/stop scripts. Portfolio, trading, reset, AI chat and E2E tests are still absent.
- **Established patterns to follow:** router factories (`create_*_router(deps)`) with no module-level state; dependencies built in `lifespan` and injected; blocking work kept off the event loop; only sources write to `PriceCache`; trades read prices from `PriceCache`.
- **Single process:** `PriceCache` is process-local, so uvicorn must run with one worker.
- **Known concerns (CONCERNS.md):** `MASSIVE_POLL_INTERVAL` can go as low as 1s, which exceeds the free-tier limit; SSE ticks are sent even when nothing changed; the test-module table in `MARKET_DATA_SUMMARY.md` is stale; there is no CI running ruff/pytest.
- **Agent collaboration:** agents coordinate through files in `planning/`; `planning/PLAN.md` is the shared contract.
- **LLM calls:** use the project's `cerebras-inference` skill (LiteLLM → OpenRouter, Cerebras provider). `OPENROUTER_API_KEY` is in the root `.env`.
- **Platform:** the developer works on Windows 11; the scripts must cover both shell families.

## Constraints

- **Tech stack**: FastAPI + uv (Python 3.12), stdlib `sqlite3`, Next.js static export with TypeScript and Tailwind, Lightweight Charts, LiteLLM → OpenRouter — fixed by PLAN.md §3 and §10
- **Deployment**: one container, one port (8000), one origin — no CORS, simple for students
- **Data contracts**: API shapes, status codes, and timestamp conventions (ISO 8601 for REST/DB, Unix float seconds for SSE/history) must match PLAN.md §6–§8 exactly; the frontend and E2E tests depend on them
- **Startup**: all initialization runs in `lifespan` before requests are accepted; nothing is deferred to the first request
- **Testing**: E2E runs with `LLM_MOCK=true` and needs no API keys; each test resets state
- **Visual**: dark theme (`#0d1117` / `#1a1a2e`, no pure black); accent yellow `#ecad0a`, blue `#209dd7`, purple `#753991` for submit buttons; desktop-first, functional on tablet

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build the entire PLAN.md as the v1 milestone | User request: "everything as described in planning/PLAN.md" | — Pending |
| Keep the existing market subsystem as validated; integrate rather than rewrite | Complete, tested, and reviewed (all 15 review findings fixed) | — Pending |
| SSE over WebSockets; static Next.js export served by FastAPI | One-way push is enough; single origin, single port | — Pending |
| Non-streaming chat with structured output and auto-execution | Must parse the complete JSON before executing; it's a zero-stakes simulated environment and makes a fluid agentic demo | — Pending |
| Failed-action notes are templated by the backend, not a second LLM call | The LLM writes its message before actions run; a template is cheap and deterministic | — Pending |
| Tracked tickers = watchlist ∪ held positions | Removing a held ticker from the watchlist must not break valuation | — Pending |
| GSD model profile: quality; parallel execution with worktrees | User settings choice | — Pending |
| Node 22 (not PLAN.md's original Node 20) for the frontend build stage and local dev | Node 20 reached end-of-life in April 2026; user decision 2026-10-23 (PLAN.md §11 updated to match) | ✓ Shipped in Phase 1 |
| Bump to FastAPI 0.162 / Starlette 1.10 before building on the backend | Current Starlette 1.x; all 139 market tests pass unchanged | ✓ Phase 1 |
| One shared `state_lock` (asyncio.Lock) per app for every mutation | Watchlist, snapshots, and Phase 2 trade/reset services must serialize against each other | ✓ Phase 1; Phase 2 must reuse it |
| `NotFoundError` subclasses `DomainError` | Phase 3 chat actions can catch one type for every business failure | ✓ Phase 1 |
| One authoritative ticker rule per side (`app/tickers.py`, `frontend/src/api/ticker.ts`), non-ASCII rejected before uppercasing | Prevents "aß" folding to "ASS"; no duplicated regexes | ✓ Phase 1 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-27 after Phase 1*
