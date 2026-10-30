# FinAlly — AI Trading Workstation

## What This Is

FinAlly (Finance Ally) is a single-container AI trading workstation. It streams live (simulated or real) market prices, lets the user trade a $10,000 simulated portfolio, and has an LLM chat copilot that analyzes positions and executes trades and watchlist changes in plain language. It looks like a dark, data-dense Bloomberg-style terminal. It is a course capstone that shows how orchestrated AI coding agents can build a production-quality full-stack app. Students run it with one Docker command and open `http://localhost:8000`, with no login and no setup.

The full product specification is `planning/PLAN.md`. This document captures the project context; PLAN.md stays the detailed contract for API shapes, schema, and behavior.

## Current State

**Shipped: v1 MVP (2026-10-30).** Every PLAN.md feature ships in one container: the live market terminal, manual trading with a live portfolio, and the AI copilot (real model or `LLM_MOCK`), with backend (577), frontend (347) and Playwright E2E (17) suites green. The milestone audit scored 64/64 requirements, 10/10 integration and 7/7 flows, with status tech_debt. See `.planning/MILESTONES.md`.

## Next Milestone Goals

Not defined yet; start with `/gsd-new-milestone`. Candidates:
- Pay down the v1 tech debt listed under Active (stale-image start scripts, volume naming, the watchlist load race, portfolio load-error states, 768px ticker clipping)
- Close backlog 999.1 (macOS/Linux start-script browser launch) and Phase 3 Nyquist validation
- Stretch: cloud deployment (PLAN §11 App Runner/Render), CI running ruff, pytest, vitest and E2E

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
- ✓ `POST /api/portfolio/trade`: market orders at the cached price under the shared Trade Rules (ticker regex, qty > 0 rounded half-up to 4 dp and capped at 1,000,000,000, cash/shares checks with 1e-6 tolerance, avg-cost math, dust removal), one transaction under `state_lock`, then a snapshot; returns trade plus updated portfolio — Phase 2
- ✓ `GET /api/portfolio` (cash, positions value, total, unrealized P&L, per-position P&L/P&L %/weight, avg-cost fallback), `GET /api/portfolio/history` (oldest first), `GET /api/trades` — Phase 2
- ✓ `POST /api/reset`: one transaction restores the seeded state, re-syncs tracked tickers, records a fresh snapshot; PLAN §8 contract kept exactly (U-1) — Phase 2
- ✓ Tracked tickers with positions: a held ticker removed from the watchlist keeps streaming; selling an unwatched ticker to zero drops it — Phase 2
- ✓ Header live total, cash, P&L and Reset with `window.confirm`; positions table; squarified-treemap heatmap; P&L BaselineSeries chart at $10,000; trade bar with inline errors; trade history — all live from SSE with no `/api/portfolio` polling (P&L history polls every 30 s to match snapshots) — Phase 2 (UAT 02: 5/5)
- ✓ `POST /api/chat` via LiteLLM → OpenRouter (`openrouter/openai/gpt-oss-120b`, Cerebras, strict structured output), portfolio context plus last 20 messages, FinAlly system prompt — Phase 3
- ✓ Auto-execution (watchlist changes first, then trades, each independent, per-action status in `actions`, at most 10 + 10 per reply) through the same `TradeService`/`WatchlistService` rules; templated ⚠️ failure notes, no second LLM call — Phase 3
- ✓ `GET /api/chat/history` (last 50, oldest first); `LLM_MOCK=true` deterministic mock through the same path; 503 without a key, 502 on LLM failure/unparseable output with the user message stored; 2,000-character cap — Phase 3
- ✓ AI chat panel: collapsible side rail (≥1280px) / stacked below, history on load, starter prompts, loading row, inline action chips with failed actions distinct; refetch after actions; reset clears chat, sparklines and selection (PF-10) and waits for an in-flight chat turn — Phase 3 (UAT 03: 3/3)
- ✓ Backend pytest (577), frontend unit tests (347), Playwright E2E (17) in `test/docker-compose.test.yml` with `LLM_MOCK=true` and reset per test, covering all §12 scenarios plus tablet layout — Phase 3

### Active

<!-- Everything else in planning/PLAN.md. Hypotheses until shipped. -->

**Packaging & ops**
- [ ] Start scripts reuse an existing `finally:latest` image after code changes unless `--build` is passed; rebuild when sources are newer, or say so in the README quick start (UAT 01 gap, minor; bit again in UAT 02 test 5, where a stale image hid the 02-07 quantity cap)
- [ ] Compose volume naming: an existing `finally_finally-data` volume no longer matches the compose file's `finally-data`, so a rebuild can start on a fresh database (seen during UAT 02)

**UI polish**
- [ ] Watchlist column clips ticker symbols to one letter at 768px width (found in quick task 261029-vpc; predates it)

**v1 tech debt (from `milestones/v1-MILESTONE-AUDIT.md`)**
- [ ] `loadWatchlist` sequence guard so a slow GET can't overwrite a newer add/remove (Phase 1 IN-02)
- [ ] Positions table and heatmap show a load error instead of the empty state when `/api/portfolio` fails (Phase 2 WR-04)
- [ ] Guard the post-commit `view_sync` so a committed fill never reports 500/failed (Phase 2 IN-01)
- [ ] Concurrency test for read isolation of `GET /api/portfolio` and `/history` under concurrent trades
- [ ] Reconcile Phase 3 Nyquist validation (`03-VALIDATION.md` still draft)
- [ ] CI that runs ruff, pytest, vitest and E2E (no CI runs them today)

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

- **Current state (v1 shipped 2026-10-30, ~3.3k backend + ~8k frontend LOC):** every PLAN.md feature ships in one container: live terminal, manual trading, the AI copilot (real model or `LLM_MOCK`) that trades and edits the watchlist, and the full test pyramid (577 backend, 347 frontend, 17 E2E). All roadmap phases are complete; open items are minor packaging/ops and UI polish.
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
| Build the entire PLAN.md as the v1 milestone | User request: "everything as described in planning/PLAN.md" | ✓ Good: shipped v1 in 3 vertical slices over 5 days |
| Keep the existing market subsystem as validated; integrate rather than rewrite | Complete, tested, and reviewed (all 15 review findings fixed) | ✓ Good: integrated unchanged apart from the FastAPI/Starlette bump |
| SSE over WebSockets; static Next.js export served by FastAPI | One-way push is enough; single origin, single port | ✓ Good: one origin, no CORS, reconnect via `retry: 1000` |
| Non-streaming chat with structured output and auto-execution | Must parse the complete JSON before executing; it's a zero-stakes simulated environment and makes a fluid agentic demo | ✓ Good: shipped in Phase 3 |
| Failed-action notes are templated by the backend, not a second LLM call | The LLM writes its message before actions run; a template is cheap and deterministic | ✓ Good: shipped in Phase 3 |
| Tracked tickers = watchlist ∪ held positions | Removing a held ticker from the watchlist must not break valuation | ✓ Good: verified in Phase 2 |
| GSD model profile: quality; parallel execution with worktrees | User settings choice | ✓ Good: parallel worktrees worked; frequent merges |
| Node 22 (not PLAN.md's original Node 20) for the frontend build stage and local dev | Node 20 reached end-of-life in April 2026; user decision 2026-10-23 (PLAN.md §11 updated to match) | ✓ Shipped in Phase 1 |
| Bump to FastAPI 0.162 / Starlette 1.10 before building on the backend | Current Starlette 1.x; all 139 market tests pass unchanged | ✓ Phase 1 |
| One shared `state_lock` (asyncio.Lock) per app for every mutation | Watchlist, snapshots, and Phase 2 trade/reset services must serialize against each other | ✓ Phase 1; Phase 2 must reuse it |
| `NotFoundError` subclasses `DomainError` | Phase 3 chat actions can catch one type for every business failure | ✓ Phase 1 |
| One authoritative ticker rule per side (`app/tickers.py`, `frontend/src/api/ticker.ts`), non-ASCII rejected before uppercasing | Prevents "aß" folding to "ASS"; no duplicated regexes | ✓ Phase 1 |
| Trade quantity: StrictFloat at the route, capped at 1,000,000,000 on the raw value before rounding; oversized orders rejected, never clamped | 1e24 overflowed Decimal rounding into a 500; the Phase 3 executor needs every quantity failure to be a `DomainError` | ✓ Phase 2 (02-07) |
| Trade error messages carry "need $X, have $Y" / "need N, have M" fragments | Phase 3 builds templated failure notes from them without a second LLM call | ✓ Phase 2 |
| `POST /api/reset` keeps PLAN §8 exactly: no body, no headers, no 400 path | User decision U-1; E2E reset calls need no special body | ✓ Phase 2 |
| P&L chart is a BaselineSeries at $10,000 and polls `/api/portfolio/history` every 30 s | Matches the backend snapshot timer so points appear without a trade; `/api/portfolio` itself is never polled | ✓ Phase 2 |
| `litellm==1.106.2` exact pin; OpenRouter routing `require_parameters: True`, `allow_fallbacks: False` | Supply-chain safety (avoid the compromised 1.82.7/1.82.8); keep requests on a provider that honors strict `response_format` | ✓ Phase 3 |
| Lenient envelope parse with per-item `StrictStr`/`StrictFloat` validation; services enforce all semantics | A malformed item fails alone instead of failing the whole reply | ✓ Phase 3 |
| `POST /api/reset` takes the chat turn lock before the state lock (CR-01) | A reset mid-turn must not let the turn's trades land in the fresh account | ✓ Phase 3 (836898b) |
| Panel pairs stack below `lg` (1024px), not `md` | At 768px side-by-side halves were too cramped for the positions table | ✓ Quick task 261029-vpc |

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
*Last updated: 2026-10-30 after v1 milestone*
