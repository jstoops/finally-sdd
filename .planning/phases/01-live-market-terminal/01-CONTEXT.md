# Phase 1: Live Market Terminal - Context

**Gathered:** 2026-10-26
**Status:** Ready for planning

<domain>
## Phase Boundary

The walking skeleton. One start script (`scripts/start_windows.ps1` or `scripts/start_mac.sh`) builds and starts a single container. `http://localhost:8000` shows a dark terminal where the 10 default tickers stream live in simulator mode. The user can chart any watchlist ticker (seeded from the 5-minute history, then extended live) and add or remove tickers. Backend scope: the FastAPI app with `lifespan`, the SQLite schema and seed, watchlist routes, health, static serving with a JSON 404 for `/api/*`, and Docker/compose/scripts. Requirements: OPS-01..08, WL-01..05, MD-01..07, UX-01.

Not in this phase: trading, portfolio panels, Reset (Phase 2), chat (Phase 3). The tracked-ticker reconcile (watchlist ∪ positions) can be built now, but its position behaviors are verified in Phase 2 (WL-06).

</domain>

<decisions>
## Implementation Decisions

### Screen layout
- **D-01:** Lay out the **full final terminal grid now**: header across the top; watchlist in the left column; main chart in the center top; heatmap and P&L chart side by side under it; positions and trade bar below them; chat in the right column. Panels not built yet (heatmap, P&L, positions/trade bar, chat) render as dimmed, labeled placeholders, e.g. "Heatmap — coming in Phase 2". Later phases fill slots instead of re-flowing the grid.
- **D-02:** The Phase 1 header shows only the **FinAlly wordmark and the connection-status dot**. Total value, cash, P&L since start and Reset arrive in Phase 2, so there are no fake `$—` values or dead buttons.
- **D-03:** Watchlist rows are **one compact line (~28px)**: ticker · price · Chg % · sparkline. All 10 defaults fit without scrolling. Bloomberg-dense.
- **D-04:** The selected watchlist row gets a **2px `#209dd7` left border plus a subtle background tint**.

### Watchlist add/remove UX
- **D-05:** The add input is **pinned at the top of the watchlist panel**, under the title: a compact "Add ticker" input with a `+` button that also submits on Enter. New rows appear at the bottom, in `added_at` order.
- **D-06:** Remove with a small **`×` that appears on row hover or focus**. It is keyboard reachable and always visible on touch/tablet. One click removes the ticker, with no confirmation. Clicking `×` must not also select the row.
- **D-07:** Add errors appear **inline in red text under the input**. They clear on the next keystroke, and the typed text stays.
- **D-08:** **Mirror the ticker regex client-side.** Trim and uppercase as the user types, then block symbols that don't match `^[A-Z][A-Z0-9.]{0,9}$` before sending, with an inline message. The server still validates everything. The 50-ticker cap message and any other `400` come from the server and show in the same inline slot. Keep the client regex in one shared constant (e.g. in `src/api/` or `src/lib/`) so it isn't scattered.

### Main chart presentation
- **D-09:** Use a Lightweight Charts **AreaSeries**: a `#209dd7` line with a gradient fill that fades downward.
- **D-10:** The chart panel header shows the **ticker, live price and Chg %**, with Chg % colored green or red, e.g. `AAPL  190.52  +0.27%`.
- **D-11:** Draw a **subtle dashed price line at `open_price`, labeled "Open"** (`createPriceLine`). It updates if the open price first arrives after selection.
- **D-12:** Loading and empty states are **centered muted text**: "Loading AAPL…" while history loads, "Add a ticker to start charting" when the watchlist is empty, and "Waiting for prices…" when a ticker has no points yet.

### Dev loop and start scripts
- **D-13:** **Dev loop: opt-in CORS plus an API base.** `next dev` on :3000 talks to uvicorn on :8000. The frontend prefixes every REST and `EventSource` URL with `process.env.NEXT_PUBLIC_API_BASE ?? ''`, which is empty in production builds. FastAPI adds `CORSMiddleware` **only** when `DEV_CORS_ORIGIN` is set (e.g. `http://localhost:3000`), and it is never set in Docker, so production stays single-origin with no CORS. Don't use Next.js rewrites; they are unsupported with `output: 'export'`. Document the loop in `frontend/CLAUDE.md` and/or the README.
- **D-14:** After `docker compose up`, the start scripts **wait for `GET /api/health`** (bounded timeout, roughly 60s, with a clear message if it times out), print the URL, then **open the browser** (`open` / `xdg-open` / `Start-Process`). `--no-open` skips opening the browser.
- **D-15:** If `.env` is missing, the start scripts **copy `.env.example` to `.env`** and print a note that the simulator works with no keys and the AI chat needs `OPENROUTER_API_KEY`. The app always starts. `.env.example` is committed in this phase.
- **D-16:** **Bump FastAPI to >=0.135 (Starlette 1.x) at the start of Phase 1**, before new routes are built on it, and re-run the 139 market tests as the gate. If the bump breaks the market subsystem, fix only what integration requires (PROJECT.md constraint), or stay on 0.128.7 and record why.

### Claude's Discretion
- Exact grid proportions, column widths and placeholder styling, as long as it follows D-01 and the UX-01 palette. The UI phase (`/gsd-ui-phase 1`) may refine them.
- Sparkline window size, sparkline color (e.g. green/red by session move vs neutral) and stroke width.
- Connection-dot tooltip text and placement within the header.
- Chart time window (fit to content vs a fixed 5-minute window), crosshair styling, price-scale formatting.
- Whether adding a duplicate ticker shows any feedback; the API returns `200` and it's harmless.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product contract
- `planning/PLAN.md` §3 — startup sequence, architecture, single container
- `planning/PLAN.md` §5 — environment variables and `.env` loading
- `planning/PLAN.md` §6 — SSE payload, session open price, history endpoint, tracked tickers
- `planning/PLAN.md` §7 — schema, conventions, seed data
- `planning/PLAN.md` §8 — watchlist and health endpoint shapes and status codes
- `planning/PLAN.md` §10 — frontend layout, data flow, charting rules (Lightweight Charts, SVG sparklines)
- `planning/PLAN.md` §11 — Dockerfile, compose, start/stop scripts

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — OPS-01..08, WL-01..05, MD-01..07, UX-01 (Phase 1 set), plus WL-06 for the reconcile service
- `.planning/ROADMAP.md` — Phase 1 success criteria and the cross-phase planning notes

### Research (gap resolutions and traps)
- `.planning/research/SUMMARY.md` — research flags for Phase 1
- `.planning/research/FEATURES.md` — G-01 (connection-dot semantics), G-02, G-04, G-05, G-18, G-23
- `.planning/research/PITFALLS.md` — static-export limits, no dev proxy, Docker traps (SSE graceful shutdown, Python healthcheck, npm lockfile native packages, tolerant `env_file`), `.sh` executable bit, ASCII-only `.ps1`
- `.planning/research/ARCHITECTURE.md` — `Settings` from env, router-factory layout, dev CORS recommendation
- `.planning/research/STACK.md` — Next.js 16 / Tailwind 4 / Vitest / Lightweight Charts versions

### Existing market subsystem
- `planning/MARKET_DATA_SUMMARY.md` — what the market package provides and how to integrate it
- `backend/CLAUDE.md` — cache key normalization; only call `remove_ticker` when no position is held
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/CONCERNS.md` — patterns and known concerns

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `app.market` public API (`backend/app/market/__init__.py`): `PriceCache`, `create_market_data_source(price_cache)`, `create_stream_router(price_cache)`, `MarketDataSource` (`start(tickers)` / `stop()` / `add_ticker` / `remove_ticker` / `get_tickers`). It already serves `GET /api/stream/prices` and `GET /api/prices/{ticker}/history`. Mount it; don't rebuild it.
- `PriceCache.get(ticker)` returns `PriceUpdate` with `price` and `open_price`. Use it for `GET /api/watchlist`, where both are `null` when uncached.

### Established Patterns
- Router factories `create_*_router(deps) -> APIRouter` with no module-level state. Dependencies are built in `lifespan` and injected. Apply this to the watchlist, health and system routers.
- Read env vars at the point of use with `.strip()`, treat empty values as unset, and parse numbers through validating helpers. The `Settings` dataclass is proposed in research.
- Keep blocking work off the event loop (`asyncio.to_thread`). Only market sources write to `PriceCache`.
- Ruff (line length 100, `E,F,I,N,W`), `from __future__ import annotations`, `%s` logging with component prefixes, frozen dataclasses with explicit `to_dict()` for wire shapes.
- Run a single uvicorn worker, because `PriceCache` is process-local.

### Integration Points
- New `backend/app/main.py` (app + `lifespan`), `backend/app/db/` (`schema.sql`, seed, connection helpers), watchlist router, tracked-ticker service, static mount of the Next.js export with a JSON 404 for unknown `/api/*`.
- `frontend/` is empty. Create the Next.js 16 static-export project from scratch (TypeScript, Tailwind 4, Vitest, Node 22 / `.nvmrc`).
- `test/` is empty. Phase 1 doesn't need E2E, but add `data-testid` hooks as panels are built (TST-04).
- Root: `Dockerfile`, `docker-compose.yml`, `.env.example`, `db/.gitkeep`, `scripts/*.sh` (executable bit) and `scripts/*.ps1` (ASCII-only).

</code_context>

<specifics>
## Specific Ideas

- Layout reference sketch (agreed):
  ```
  ┌ HEADER  FinAlly  ● ──────────────────────────┐
  ├──────────┬──────────────────┬──────────────┤
  │WATCHLIST │  MAIN CHART      │              │
  │ [+ add]  │                  │   CHAT       │
  │ AAPL ~~  ├────────┬─────────┤  (Phase 3)   │
  │ GOOGL ~~ │HEATMAP │ P&L     │              │
  │ ...      │(Ph 2)  │ (Ph 2)  │              │
  │          ├────────┴─────────┤              │
  │          │POSITIONS / TRADE │              │
  └──────────┴──────────────────┴──────────────┘
  ```
- Bloomberg-dense feel: compact rows, tabular numerals, muted placeholders that don't compete with live data.

</specifics>

<deferred>
## Deferred Ideas

None. The discussion stayed within phase scope.

</deferred>

---

*Phase: 01-live-market-terminal*
*Context gathered: 2026-10-26*
