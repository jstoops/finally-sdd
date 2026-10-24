# Project Research Summary

**Project:** FinAlly (Finance Ally), AI trading workstation
**Domain:** Single-container simulated trading terminal with streaming prices and an LLM copilot that auto-executes trades
**Researched:** 2026-10-23
**Confidence:** MEDIUM-HIGH (stack versions HIGH; integration and LLM-provider behavior MEDIUM)

## Executive Summary

FinAlly is a brownfield build. The market-data subsystem (simulator, Massive client, `PriceCache`, SSE router) is done and tested. The rest of `planning/PLAN.md` is the fixed scope: SQLite persistence, trade rules, portfolio, watchlist, reset, an LLM chat that executes structured actions, a Next.js static-export terminal UI, Docker packaging, and unit plus Playwright tests. Scope is not in question. The research's job was to find where the plan is under-specified and where agents will go wrong.

The recommended approach is a layered backend and a store-driven frontend, built in two parallel lanes. Backend: a `create_app(settings)` factory, all startup work in `lifespan`, and a single async `Commands` layer. Manual trades, LLM trades, watchlist edits and reset all go through `Commands`. It holds one mutation lock and runs sync `sqlite3` work in `asyncio.to_thread`. A `TickerTracker.reconcile()` call after every mutation keeps the market source's ticker set equal to watchlist ∪ positions, replacing five ad-hoc rules. Pure `rules.py` and `valuation.py` modules hold the money math. The chat pipeline sits behind an `LLMClient` protocol, and the mock and the real client share the same parse, execute, note and store path. Frontend: one `EventSource` feeding a Zustand store with per-ticker selectors, live portfolio values computed client-side, and Lightweight Charts v5 created only in effects.

The main risks are all integration-level, not library-level:
1. Blocking the event loop (sync DB or sync `litellm.completion` freezes every SSE stream).
2. Race conditions and float drift in the trade path.
3. Breaking the tracked-ticker invariant.
4. OpenRouter silently falling back to a provider that ignores `response_format`.
5. Lightweight Charts throwing on duplicate or out-of-order times.
6. Static serving that swallows `/api/*`.
7. Playwright flakiness against random prices.

Each has a concrete prevention below. Placing them in the owning phase's plan is the main value of this research.

## Decisions Already Made (treat as settled)

- **Node 22** (`node:22-slim`, `.nvmrc` = 22, `engines ^22.22.0`) replaces PLAN's Node 20. PLAN §11 is updated. Node 20 is EOL and Vitest 5, jsdom 30 and jest-dom 7 will not install on it. Local Node 24 users need Node 22 alongside it.
- **Already committed, not remaining work:** `.gitignore` fix (`frontend/src/lib/` no longer ignored; `node_modules`, `.next`, `out`, `db/*.db` ignored), `.gitattributes` (LF default, CRLF for `.ps1/.bat/.cmd`), `.dockerignore`, `.env.example` (`DB_PATH` commented out to avoid the empty-override pitfall), `db/.gitkeep`, root `.nvmrc` (`22`).
- Still open from those items: the executable bit on `scripts/*.sh` (`git update-index --chmod=+x`) and ASCII-only `.ps1` files. Both belong to the packaging phase.

## Key Findings

### Recommended Stack

PLAN fixes the stack. Research pinned versions and configuration. See `STACK.md`.

**Core technologies:**
- **Python 3.12, uv 0.13.5 (pinned image), FastAPI >=0.135 (current 0.162, Starlette 1.x), Uvicorn with exactly one worker.** Starlette 1.x removed `on_event`, so use `lifespan=` only. Move off the locked FastAPI 0.128.7 early and re-run the 139 market tests.
- **stdlib `sqlite3`, no ORM.** Connection per unit of work, WAL, `busy_timeout`, `BEGIN IMMEDIATE`, hand-written ISO 8601 UTC timestamps.
- **LiteLLM `>=1.106,<2` via `acompletion`** to `openrouter/openai/gpt-oss-120b`. Use `extra_body={"provider": {"order": ["cerebras"], "require_parameters": True}}` and `reasoning_effort="low"`. Pydantic `response_format`. Set `LITELLM_LOCAL_MODEL_COST_MAP=True`. Never use 1.82.7/1.82.8 (compromised releases). Add uv `exclude-newer = "7 days"`.
- **Next.js 16.4.3 static export, React 19, TypeScript pinned `~5.9.3` (not `latest`, which is TS 7 with no classic API), Tailwind 4 (CSS-first `@theme`, no config file).**
- **Lightweight Charts 5.2.1** (v5 API: `addSeries(LineSeries, ...)`, times in integer seconds). Sparklines are inline SVG. The heatmap is an in-house squarified treemap. No other chart libraries.
- **Zustand 5** for the price/portfolio/chat stores (the one frontend dependency PLAN does not mandate; the alternative is a ~30-line `useSyncExternalStore` store).
- **Tests:** pytest with `with TestClient(app)`; Vitest 5 plus jsdom 30 plus Testing Library (stub `EventSource`, `ResizeObserver`, `lightweight-charts`; fallback to Vitest 4.1.12 on friction); `@playwright/test` pinned to exactly 1.64.1 to match `mcr.microsoft.com/playwright:v1.64.1-noble`.

### Expected Features

Every PLAN feature is in scope for v1. See `FEATURES.md`, which also lists 23 gaps (G-01 to G-23) with recommended resolutions.

**Must have (table stakes):**
- Live SSE watchlist with Chg % since session open, price flash, connection dot, main chart seeded from history, and click-to-select.
- Trade bar with inline 400 errors and a success message. One shared trade-rules service (ticker regex, 4dp quantity, cached-price fill, weighted avg cost, dust deletion, single transaction plus snapshot).
- Tracked-ticker integrity, live client-side portfolio (header, positions table), `GET /api/portfolio`, snapshots, P&L chart, reset.
- Watchlist CRUD, chat panel with history, 502/503 error states, mock mode.
- Lifespan startup, static serving with JSON 404 for `/api/*`, health endpoint, Docker/compose/start-stop scripts (sh and ps1), and the three test layers.

**Should have (differentiators, all in PLAN):**
- Agentic auto-execution of structured `trades` and `watchlist_changes` through the same rules as manual trades.
- Portfolio-aware prompt context, inline action chips (failed visibly distinct), templated failure notes, and post-action UI refetch.
- Treemap heatmap, SVG sparklines, and the dark terminal aesthetic (tabular numerals).

**Defer (v1.x or later; not in PLAN):**
- Trade-history panel and endpoint, P&L-since-start header, prompt chips, keyboard shortcuts, seeded simulator for E2E.
- Limit orders, alerts, multi-user, cloud deploy.
- Anti-features to refuse: confirmation dialogs, candles and indicators, extra chart libraries, token streaming, polling `/api/portfolio`, a second LLM call.

**Gap resolutions the requirements should adopt:**
- Connection status: green = open, yellow = connecting, red = closed, with manual backoff reconnect (G-01).
- Cap sparklines at 300 to 600 points (G-02).
- Refetch `/api/portfolio/history` every 30s (G-03).
- Round cash to cents (G-07).
- Serialize trades (G-08).
- Validate LLM action items individually (G-11).
- Percent units: `*_percent` fields are percent, `weight` is a 0 to 1 fraction (G-12).
- Watchlist cap of 50 (G-13).
- Word-boundary mock regexes (G-14).
- Check 503 before storing anything (G-15).
- Cap 10 trades and 10 watchlist changes per response (G-21).

### Architecture Approach

Dependencies point strictly downward: HTTP routers, then the command layer, then pure domain code and repos, then SQLite. Everything may read `PriceCache`. Only market sources write to it, and only the command layer touches the source's ticker set. See `ARCHITECTURE.md`.

**Major components:**
1. **`Settings` and `create_app` with `lifespan`.** Build inert dependencies in the factory, do all work (schema and seed, `source.start`, initial snapshot, 30s snapshot task) in lifespan. Mount routers first, then a JSON `/api/{path}` 404, then `StaticFiles(html=True)` last and only if `index.html` exists.
2. **`Commands` plus `TickerTracker`.** One `asyncio.Lock`, DB work via `to_thread`, source calls awaited on the loop (the simulator is not thread-safe), reconcile then snapshot after each mutation. The LLM call must never run under the lock.
3. **Domain and repos.** Pure `rules.py` and `valuation.py`; repos take a connection so one command is one transaction.
4. **`ChatService`.** Store user message, build context, call `LLMClient` (real or mock, same pipeline), execute watchlist changes then trades one by one, append failure notes, store the reply.
5. **Frontend `PriceStream` and stores.** One `EventSource` created in an effect, frame dedupe by per-ticker timestamp, replace (not merge) frames, derived `livePortfolio` selector that mirrors the server `valuation.py`.
6. **Chart wrappers.** `useLightweightChart` created in effects with `chart.remove()` cleanup, `toChartTime` helper with dedupe and a monotonic guard.

Resolved conflicts between research files: the `Commands` layer uses an `asyncio.Lock` (ARCHITECTURE) rather than a `threading.Lock` (PITFALLS). PITFALLS is right that snapshot and reset must take the same lock, and `Commands` does that. Use `src/api/` and similar names on the frontend by default. `lib/` is no longer ignored, but nothing needs it.

### Critical Pitfalls

1. **Blocking the event loop.** Sync `sqlite3` or `litellm.completion` inside `async def` freezes SSE and the snapshot task. Use `to_thread` for DB work and `acompletion` for the LLM. Add a test that a slow mock chat does not delay SSE frames.
2. **Trade, snapshot and reset races, and float money drift.** Use one mutation lock, `BEGIN IMMEDIATE`, and cash rounded to cents with a half-cent tolerance on the cash check ("buy max" must succeed). Clamp sells within tolerance. Guard every division. Include a 20-parallel-buys test.
3. **Tracked-ticker invariant.** `remove_ticker` on a held ticker silently zeroes P&L (price falls back to `avg_cost`). Use the single `reconcile()` after every watchlist change, trade, reset and at startup. Cap the watchlist, and give Massive "tracked but not yet priced" a distinct message.
4. **OpenRouter fallback and strict-schema failures.** Without `require_parameters: True`, a fallback provider may ignore `response_format`. Required (possibly empty) list fields, `Literal` enums, `extra="forbid"`, no numeric or regex constraints in the schema, and validation in the Trade Rules. Parser: `content or ""`, strip fences, and map `ValidationError`, `TypeError` and LiteLLM errors to 502. Do a spike with a real call using the final schema.
5. **Lightweight Charts time rules and the render storm.** Floor to integer seconds, dedupe, guard monotonic updates, and discard stale history responses on ticker switch. Charts subscribe to the store imperatively. Settle the state architecture before building panels.
6. **Static serving and SSE delivery.** Mount static last and return a JSON 404 under `/api`. Do not add gzip middleware. Run uvicorn with `--workers 1 --timeout-graceful-shutdown 5`. Replace price maps per frame, and keep one `EventSource` per tab.
7. **Mock drift and LLM semantics.** The mock returns the same raw JSON string as the real client and flows through the shared path. Gate `LLM_MOCK` before the API-key check. Replay history as plain text summaries so the model does not re-emit old trades.
8. **Config and packaging traps.** Treat empty env vars as unset and log the resolved `DB_PATH` (must start with `/app/db/`). Bind compose to `127.0.0.1:8000`. Use a Python-based healthcheck (no `curl` in slim images). Add a persistence test (down then up).

## Implications for Roadmap

The architecture research proposes six phases with two parallel lanes (backend P1 then P2 then P3; frontend P4 then P5 after P1). I recommend keeping that structure. Given that repo hygiene is already committed, Phase 1 is smaller than the research assumed.

### Phase 1: Backend foundation and app shell
**Rationale:** Root of the dependency graph. It gives a runnable server with real SSE and history, and fixes the conventions every later phase copies.
**Delivers:** `Settings` (dotenv, empty-as-unset env handling, resolved and logged `DB_PATH`); `db/` (`schema.sql`, seed, connection helper, `transaction()`); `create_app` plus `lifespan`; the existing stream router mounted; `/api/health`; error envelope (`{"error": ...}`); JSON 404 for `/api/*`; guarded static mount; FastAPI/Starlette bump with the 139 market tests re-run; the `MASSIVE_POLL_INTERVAL` factory change and tests for the session-open and history **[change]** items (verify first whether any are already done).
**Avoids:** Pitfalls 2 (documented async/threading convention), 3, 7, 8 (shutdown flags), 11 (mount order).

### Phase 2: Portfolio, watchlist and tracked tickers
**Rationale:** This is the Core Value, correct numbers, and the `Commands` layer it defines is reused by chat. It must precede chat.
**Delivers:** `rules.py`, `valuation.py`, repos; `Commands` (trade, add and remove watch, reset) with lock; `TickerTracker.reconcile()`; snapshot loop; routes for portfolio, trade, history, watchlist and reset; `api/models.py` response models, with per-endpoint key-exact tests as the frozen contract.
**Addresses:** TRD-01..05 (backend), PF-03/05/06, WL-01..03, and the PLAN §12 portfolio and tracked-ticker tests.
**Avoids:** Pitfalls 4, 5, 6 (including G-07/08/10/12/13).

### Phase 3: AI chat
**Rationale:** The executor is a thin loop over `Commands`, so it needs Phase 2. This is the highest-uncertainty phase.
**Delivers:** `LLMClient` protocol with `LiteLLMClient` and `MockLLMClient`; prompt and context builder; per-item action validation; caps; failure notes; chat routes (503 before storing, 502 after); history; parser fixture-corpus tests.
**Avoids:** Pitfalls 2, 12, 13, 14.

### Phase 4: Frontend shell and live market UI
**Rationale:** Needs only Phase 1 (SSE and history exist), so it runs in parallel with Phases 2 and 3. It carries the riskiest frontend logic.
**Delivers:** Next export scaffold (`engines ^22.22.0` in `package.json`; root `.nvmrc` already exists; TS ~5.9.3, Tailwind 4 theme, Vitest setup with stubs); `api/types.ts` transcribed from PLAN; stores and `PriceStream` with the G-01 status machine and dedupe/replace; header and connection dot; watchlist with flash, Chg % and capped SVG sparklines; main `PriceChart` (history plus SSE, race-safe, local-time formatter); `data-testid` and `data-*` hooks for E2E.
**Avoids:** Pitfalls 8 (client side), 9, 10, 11 (prerender and hydration).

### Phase 5: Frontend portfolio, trade and chat
**Rationale:** Depends on the Phase 2 routes, and on Phase 3 for chat. It can start against typed fixtures.
**Delivers:** `livePortfolio` selector (tested in parallel with the server `valuation.py`), positions table, treemap heatmap (color by `unrealized_pnl_percent`, clamped at plus or minus 5%, empty state), P&L chart (30s refetch), trade bar (in-flight disable, success message), chat panel (action chips, failed styling, loading, error bubbles), post-action refetch, reset flow (clear chat, sparklines, selection).
**Avoids:** Pitfalls 5 (formatters), 9 (P&L same-second duplicates), 10.

### Phase 6: Packaging and E2E
**Rationale:** E2E covers cross-stack behavior, so it comes last. Do a smoke Docker build at the end of Phase 4 to catch static-serving problems early.
**Delivers:** Dockerfile (node:22-slim, uv-pinned python:3.12-slim, `LITELLM_LOCAL_MODEL_COST_MAP`, one worker, graceful shutdown), `docker-compose.yml` (named volume `finally-data`, `127.0.0.1` bind, Python healthcheck, tolerant of a missing `.env`), start/stop scripts (sh with exec bit, ASCII-only ps1, idempotent), `test/docker-compose.test.yml` (own project name, no shared volume, `LLM_MOCK=true`), Playwright with `workers: 1`, relational assertions, and the seven PLAN scenarios.
**Avoids:** Pitfalls 7 (persistence test), 15, 16, 17.

### Phase Ordering Rationale

- Phase 1 must be first because everything needs the app factory, DB and error envelope.
- Phase 2 before 3 because chat reuses `Commands`. Building the executor first would force a rewrite.
- Phases 4 and 5 are separate because Phase 4 depends only on Phase 1 and de-risks the streaming, chart and state design while the backend lane proceeds.
- The contract between lanes is PLAN §6/§8, frozen as `api/models.py` and `src/api/types.ts` with exact-key tests.
- If the roadmap must be sequential, use 1, 2, 4, 3, 5, 6, and keep the Docker smoke build after Phase 4.

### Research Flags

Phases likely needing deeper research or a spike during planning:
- **Phase 3 (AI chat):** run a real-call spike first (final schema against Cerebras strict mode, `require_parameters`, empty content with reasoning tokens, `allow_fallbacks` decision). Use `/gsd-plan-phase --research-phase 3`.
- **Phase 4 (frontend shell):** light research. Verify Vitest 5 behavior, fractional-second chart times (we floor to integers instead), the dev-time API story (opt-in `DEV_CORS_ORIGIN` plus `NEXT_PUBLIC_API_BASE`, or develop against the built export), and SSE behavior through any dev proxy.
- **Phase 6 (packaging):** light research. Check graceful shutdown with open SSE streams, the npm lockfile with Linux optional native packages (regenerate if `npm ci` fails), and Compose `env_file.required` support.

Phases with standard patterns (skip research-phase):
- **Phase 1:** FastAPI lifespan and sqlite3 patterns are well documented. The one thing to check is the Starlette 1.x bump.
- **Phase 2:** Domain logic is defined by PLAN §7 and ARCHITECTURE; it needs careful tests, not research.
- **Phase 5:** Standard React on top of Phase 4 decisions. The treemap algorithm is well known.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions read from npm/PyPI registry and the create-next-app template. Configuration guidance is MEDIUM. Vitest 5 behavior changes are LOW (third-party summaries), with a Vitest 4 fallback. |
| Features | MEDIUM | PLAN scope is HIGH. Gap analysis rests on PLAN text, repo code and the WHATWG spec. Competitor comparisons are LOW to MEDIUM. |
| Architecture | HIGH backend, MEDIUM frontend | Backend derived from the existing market code and PLAN. Frontend and tooling claims cross-checked against docs and package source. |
| Pitfalls | MEDIUM | Several are repo-verified or HIGH-inferred. OpenRouter and Cerebras behavior comes from docs and needs a real-call check. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Cerebras strict-schema acceptance and provider fallback:** unverified against a live call. Spike at the start of Phase 3 and decide `allow_fallbacks`.
- **Whether the PLAN §6 [change] items already exist** (session open price, history ring buffer, `MASSIVE_POLL_INTERVAL`): research implies the cache has them, but the factory change is unconfirmed. Check in Phase 1 and test only what is missing.
- **FastAPI 0.128.7 to 0.162 bump:** expected to be safe because the market code uses only `APIRouter` and `StreamingResponse`. Confirm by running the 139 tests.
- **Dev-loop approach** (CORS opt-in versus building the export): choose one in Phase 1 or 4 and document it in `frontend/CLAUDE.md`.
- **Fractional-second chart times and sub-second labels:** avoided by flooring to whole seconds. Confirm the visual result is acceptable at 500ms ticks.
- **LiteLLM image-size impact** (estimated 150 to 250 MB, unmeasured): measure in Phase 6.
- **Open requirement decisions to confirm in discuss-phase:** the G-xx resolutions listed above, especially G-03 (30s history refetch), G-13/G-21 (caps), and G-15 (503 stores nothing).
- **Node 22 EOL on 2027-04-30:** plan a move to Node 24 in a later milestone.

## Sources

### Primary (HIGH confidence)
- `planning/PLAN.md`, `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, and the `backend/app/market/` code (read directly; `git check-ignore` results).
- npm registry and PyPI JSON metadata for all pinned versions; the create-next-app 16.4.3 template.
- WHATWG HTML SSE spec; Node.js release schedule; OpenRouter endpoints API for Cerebras `gpt-oss-120b` capabilities; Starlette release notes (1.0 removals); MCR Playwright tag list.

### Secondary (MEDIUM confidence)
- Next.js static exports, upgrade and Vitest guides; Lightweight Charts v4 to v5 migration and API docs; Python 3.12 `sqlite3` docs; Starlette `StaticFiles` source.
- OpenRouter provider-selection and structured-output docs; Cerebras structured-output docs; LiteLLM JSON-mode and cost-map docs; uv Docker guide; LiteLLM supply-chain reporting (BleepingComputer, LWN, NetSPI).

### Tertiary (LOW confidence, validate in-phase)
- Competitor and paper-trading feature comparisons (web search).
- Vitest 5 breaking-change summaries (third-party); a single report of Next rewrite proxy buffering SSE.
- Inferred items: browser 6-connection limit, Playwright `networkidle` with SSE, npm optional-dependency lockfile bug, Compose `env_file.required`, image-size estimate.

---
*Research completed: 2026-10-23*
*Ready for roadmap: yes*
