# Phase 1: Live Market Terminal - Research

**Researched:** 2026-10-26
**Domain:** FastAPI app shell (lifespan, SQLite, watchlist API, static serving) + Next.js 16 static-export terminal UI (SSE store, flash, sparklines, Lightweight Charts) + Docker/compose/start scripts
**Confidence:** HIGH (most load-bearing claims were confirmed with positive probes this session: FastAPI/Starlette bump against the 139 market tests, static export build on Node 22 locally and in `node:22-slim`, JSON-404 and mount-order behavior on Starlette 1.10, compose syntax, Vitest 5 + jsdom 30, seed-once SQL)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
None. The discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OPS-01 | `lifespan` creates schema+seed, starts market source with watchlist ∪ positions, records initial snapshot, starts 30s snapshot task, all before requests | Pattern 1 (`create_app` + `lifespan`), Pattern 4 (snapshot recorder). Note: the 30s snapshot task and initial snapshot ARE Phase 1 scope even though trading is Phase 2 |
| OPS-02 | `schema.sql` (`CREATE TABLE IF NOT EXISTS`) + `INSERT OR IGNORE` seed via stdlib `sqlite3`; restart never duplicates/overwrites | Pattern 3 (DB helper) and Pitfall 1 (seed-once gate; probe-verified) |
| OPS-03 | `../.env` loaded with `python-dotenv`, env wins, keys never logged | Pattern 2 (`Settings.from_env`, `load_dotenv(override=False)` before the market factory reads env; `repr=False` on secrets) |
| OPS-04 | `GET /api/health` → `200 {"status": "ok"}` | Pattern 6 (system router; probe-verified) |
| OPS-05 | Static export at `/`; unknown `/api/*` → JSON 404 | Pattern 6 (catch-all `api_route` on all methods registered after routers, `StaticFiles(html=True)` mounted last; probe-verified on Starlette 1.10) |
| OPS-06 | Multi-stage Dockerfile, Node 22 → Python 3.12 + uv, `DB_PATH=/app/db/finally.db`, 1 uvicorn worker on 8000 | Dockerfile example; frontend stage probe-built in `node:22-slim` |
| OPS-07 | compose: `8000:8000`, `env_file: .env`, `finally-data` volume at `/app/db`, healthcheck on `/api/health` | compose example (validated with `docker compose config`); Python healthcheck (no curl in slim) |
| OPS-08 | Idempotent start/stop scripts (sh + ps1), `--build` or missing image builds, print URL, never delete volume | Script patterns; `docker compose up -d --wait --wait-timeout`; PS 5.1 argument probe |
| WL-01 | First launch watchlist = 10 defaults | Seed-once (Pitfall 1); order by `added_at, rowid` (Pitfall 2) |
| WL-02 | `GET /api/watchlist` in `added_at` order with `price`/`open_price` (`null` until priced) | Pattern 5; `PriceCache.get()` returns `PriceUpdate \| None` |
| WL-03 | Add: `201` new / `200` duplicate / `400` malformed | Pattern 5 (regex validated in the service, not in Pydantic, so malformed is 400 not 422) |
| WL-04 | Remove: `204` / `404` not on watchlist | Pattern 5 |
| WL-05 | Cap 50 → `400` clear message | Pattern 5 (duplicate check BEFORE cap check, inside the mutation lock) |
| MD-01 | Exactly one `EventSource`; one prices map shared by all panels | Pattern 8 (Zustand store; replace-not-merge; StrictMode-safe effect) |
| MD-02 | Ticker, price, Chg % since open computed client-side; `—` unpriced | Pattern 8 (`(price - open_price) / open_price * 100`) |
| MD-03 | Flash green/red only on change, fade ~500ms, consecutive ticks re-trigger | Pattern 9 (keyed element + CSS keyframes; lint-safe, no setState-in-effect) |
| MD-04 | Dot green/yellow/red; recreate after CLOSED with 1s→2s→5s backoff | Pattern 7 (connection state machine) |
| MD-05 | SVG polyline sparkline from SSE since load, capped window | Pattern 10 |
| MD-06 | Lightweight Charts chart seeded from history, extended by SSE, drop out-of-order, local `HH:MM:SS` | Pattern 11 (verified against `lightweight-charts@5.2.1` typings and source) |
| MD-07 | Click to chart; first selected on load; removing selected selects first remaining / empty | Pattern 12 (selection rules) |
| UX-01 | Tailwind dark theme, palette, tabular numerals | Tailwind v4 `@theme` tokens; `tabular-nums` utility confirmed in built CSS |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives from `./CLAUDE.md`, `./.claude/CLAUDE.md`, `planning/PLAN.md` and `backend/CLAUDE.md` that plans must honor:

- **Stack fixed:** FastAPI + uv (Python 3.12), stdlib `sqlite3` (no ORM), Next.js static export with TypeScript + Tailwind, Lightweight Charts, LiteLLM → OpenRouter (Phase 3). No other charting libraries; sparklines are inline SVG polylines.
- **One container, one port (8000), one origin.** No CORS in production. Next.js rewrites are not allowed (D-13).
- **Data contracts match PLAN §6–§8 exactly.** REST/DB timestamps ISO 8601 UTC strings (`2026-10-09T14:03:22Z`); SSE/history timestamps Unix float seconds. Business-rule failures → `400 {"error": ...}`; malformed bodies → FastAPI default `422`; not found → `404 {"error": ...}`.
- **Startup in `lifespan` only;** nothing deferred to the first request. Never `@app.on_event`.
- **Single uvicorn worker** (`PriceCache` is process-local).
- **Integrate `backend/app/market/` as-is;** change it only where integration requires. Mount `create_stream_router(price_cache)`; don't rebuild it. Only market sources write to `PriceCache`. Only call `remove_ticker` when no position is held.
- **Backend conventions:** Ruff (line length 100, rules `E,F,I,N,W`), `from __future__ import annotations` in every module, PEP 604 unions, `%s` logging with component prefixes (never f-strings in log calls), no `print` in library code, frozen dataclasses with explicit `to_dict()` for wire shapes, router factories `create_*_router(deps) -> APIRouter` with no module-level state, constructor injection for test seams, env read with `.strip()` and empty treated as unset, blocking work off the event loop (`asyncio.to_thread`), background loops catch `Exception` per iteration and log with `logger.exception`.
- **Tests:** backend pytest under `backend/tests/` mirroring source names; `asyncio_mode = "auto"`; tests patch env with `patch.dict(os.environ, {...}, clear=True)`; never put secrets in code or tests.
- **Visual:** backgrounds `#0d1117` / `#1a1a2e`, muted gray borders, no pure black; accent yellow `#ecad0a`, blue `#209dd7`, purple `#753991` for submit buttons; desktop-first, functional on tablet.
- **GSD workflow:** file edits happen inside GSD commands (`/gsd-execute-phase` for this work).
- **Testing env:** E2E (Phase 3) runs with `LLM_MOCK=true`; add `data-testid` hooks now as panels are built (TST-04).

## Summary

Phase 1 is a walking skeleton across three lanes that can run in parallel: (1) the FastAPI app shell (settings, SQLite schema and seed, `create_app` + `lifespan`, watchlist service and routes, health, JSON 404, guarded static mount, opt-in dev CORS); (2) the Next.js 16 static-export terminal (one SSE store, connection dot, dense watchlist with flash, Chg % and sparklines, Lightweight Charts AreaSeries for the selected ticker, placeholder grid); and (3) packaging (multi-stage Dockerfile, compose with healthcheck and named volume, start/stop scripts for both OS families). The market subsystem already provides the SSE stream, the history endpoint, session open price and the 5-minute ring buffer. All PLAN §6 **[change]** items, including `MASSIVE_POLL_INTERVAL`, are already implemented [VERIFIED: backend/app/market/factory.py:16-41, cache.py:22-23].

Every risky claim was probed this session. The FastAPI bump has a trap: `uv add "fastapi>=0.135"` resolves FastAPI 0.162.0 but **leaves Starlette at 0.52.1**. You also need `uv lock --upgrade-package starlette --upgrade-package uvicorn`. After that, all 139 market tests pass on FastAPI 0.162.0 / Starlette 1.10.0 / uvicorn 0.54.0 [VERIFIED: scratch probe]. The `create-next-app@16.4.3` defaults differ from earlier project research. `--yes` turns on `cacheComponents` and `partialPrefetching` and wires Tailwind through `@tailwindcss/turbopack`, with no PostCSS config. Scaffold with `--no-cache-components`, then switch to `@tailwindcss/postcss` + `postcss.config.mjs` and `output: "export"`. That combination builds `out/index.html` + `out/404.html` locally and in `node:22-slim` with the Windows-generated lockfile [VERIFIED: probe].

Two findings change the design. First, a literal "INSERT OR IGNORE the default watchlist at every startup" brings removed default tickers back on every restart. That breaks success criterion 4 ("watchlist edits survive a stop and start"), so seed the watchlist only when the default user row is newly inserted (probe-verified). Second, `eslint-config-next@16.4.3` bundles `eslint-plugin-react-hooks@7.1.1`, which **errors** on `setState` called synchronously inside `useEffect` [VERIFIED: probe]. The price flash must be derived in render (a keyed element plus CSS keyframes), not toggled with effect state.

**Primary recommendation:** Build the backend as `create_app(settings=None, *, source_factory=None)` run with `uvicorn app.main:create_app --factory`. Use one `asyncio.Lock`-guarded watchlist/tracker service that owns every `add_ticker`/`remove_ticker` call. On the frontend, use one Zustand price store fed by a single `EventSource` state machine, and drive charts imperatively from store subscriptions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schema creation, seed-once, persistence | Database / Storage (SQLite at `DB_PATH`) | API / Backend (`app/db/`) | PLAN §7; stdlib `sqlite3`, run from `lifespan` |
| Startup ordering (schema → source.start → snapshot → loop) | API / Backend (`lifespan`) | — | PLAN §3: before any request is accepted |
| Ticker validation (`^[A-Z][A-Z0-9.]{0,9}$`) | API / Backend (authoritative) | Browser (mirror, D-08) | Server validates everything; client mirror is UX only |
| Watchlist CRUD, 50 cap, idempotent add | API / Backend (watchlist service) | Database | Business rules + transaction; lock-serialized |
| Tracked-ticker set (watchlist ∪ positions) | API / Backend (tracker `reconcile()`) | Market source | Only caller of `source.add_ticker/remove_ticker` |
| Live prices, session open, 5-min history | API / Backend (existing `PriceCache` + sources) | — | Exists; only sources write the cache |
| SSE delivery | API / Backend (existing stream router) | Browser (`EventSource`) | One stream per tab |
| Portfolio snapshot (initial + 30s) | API / Backend (snapshot task) | Database | OPS-01; Phase 1 value is cash only, since there are no positions yet |
| Static asset serving | API / Backend (`StaticFiles` mounted last) | CDN/Static (Next export `out/`) | Single origin; JSON 404 for `/api/*` |
| Chg %, flash direction, sparkline buffers | Browser / Client | — | PLAN §6/§10: computed client-side from SSE |
| Connection status state machine | Browser / Client | — | Driven by `EventSource.readyState` |
| Main chart (history seed + live append) | Browser / Client | API (`/api/prices/{t}/history`) | Lightweight Charts in effects only |
| Selection state (selected ticker) | Browser / Client | — | UI state |
| Container build, health gating, start/stop | OS / Docker (compose, scripts) | API (`/api/health`) | compose healthcheck drives `--wait` |

## Standard Stack

### Core (backend)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | 0.162.0 (declare `>=0.135`) | App, routers, lifespan, exception handlers | D-16; current; 139 market tests pass on it [VERIFIED: PyPI JSON + scratch pytest run] |
| Starlette | 1.10.0 (transitive; must be upgraded explicitly in the lock) | ASGI toolkit, `StaticFiles`, `CORSMiddleware` | Starlette 1.x removed the decorator event APIs; `lifespan=` only [VERIFIED: installed `starlette/applications.py` docstring "replaces the `on_startup` and `on_shutdown` handlers"] |
| uvicorn[standard] | 0.54.0 | ASGI server; `--factory`, `--workers 1`, `--timeout-graceful-shutdown` | Flags confirmed in `uvicorn --help` [VERIFIED: probe] |
| python-dotenv | 1.2.4 (declare `>=1.2`) | Load `<repo>/.env` in local dev | PLAN §5 [VERIFIED: PyPI] |
| stdlib `sqlite3` | CPython 3.12 (Docker) | Persistence | PLAN §7, no ORM |

### Core (frontend)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.4.3 | App Router, `output: "export"` | Current stable; export build probe-verified [VERIFIED: npm registry + build] |
| react / react-dom | 19.3.x (template pins `19.3.0`; latest `19.3.1`) | UI | Next 16 peer [VERIFIED: npm registry] |
| typescript | `~5.9.3` (NOT latest 7.0.2) | Types | TS 7 lacks the classic compiler API Next/typescript-eslint need [CITED: .planning/research/STACK.md; npm `typescript` latest = 7.0.2 VERIFIED] |
| tailwindcss + @tailwindcss/postcss | 4.3.3 (exact, both same version) | Styling via CSS-first `@theme` | Probe built with this pair; `tabular-nums` and arbitrary colors emitted [VERIFIED: built CSS] |
| lightweight-charts | 5.2.1 | Main price chart (P&L chart in Phase 2) | PLAN §10; v5 API verified in `dist/typings.d.ts` [VERIFIED: package tarball] |
| zustand | 5.0.16 | Single price/watchlist/ui store with selectors | Per-row selector subscriptions avoid app-wide re-render each 500ms tick [CITED: .planning/research/ARCHITECTURE.md Pattern 6] |

### Supporting (frontend dev/test)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 5.0.5 | Unit tests | All frontend unit tests [VERIFIED: probe run] |
| vite | 8.3.5 | Vitest peer | Install explicitly; provides native `resolve.tsconfigPaths` |
| @vitejs/plugin-react | 6.1.2 | JSX in tests | |
| jsdom | 30.1.3 | DOM env (needs Node ≥ 22.22.2) | Has no `EventSource`, canvas or `ResizeObserver`; stub them |
| @testing-library/react / dom / jest-dom / user-event | 16.3.3 / 10.4.2 / 7.0.1 / 14.6.8 | Component tests | jest-dom via `@testing-library/jest-dom/vitest` |
| eslint + eslint-config-next | `^9` (template) + 16.4.3 | Lint (`npm run lint` = `eslint`) | Keep ESLint 9: ESLint 10 installs with an `ERESOLVE overriding peer dependency` warning [VERIFIED: probe], a risk for `npm ci` |
| @types/node | `^22` | Node types | Template writes `^20`; bump to match Node 22 |

**Do not install** `vite-tsconfig-paths`. Vite 8 resolves `@/*` natively with `resolve: { tsconfigPaths: true }`, and the plugin prints a deprecation notice [VERIFIED: probe; alias test passed]. **Do not install** `@tailwindcss/turbopack` (the template default). It is flagged SUS (low downloads), and the PostCSS path works.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| zustand | Hand-rolled `useSyncExternalStore` store (~40 lines) | Zero extra dependency; slightly more code to get selectors right. Acceptable if the planner wants to avoid the SUS recency flag |
| Keyed-span CSS flash | Web Animations API `el.animate()` | Imperative and restart-safe, but jsdom lacks `Element.animate`, so it's harder to unit-test |
| `docker compose up --wait` | Polling `/api/health` with curl / `Invoke-WebRequest` | `--wait` reuses the compose healthcheck (one definition) and works the same on both OSes; polling duplicates the URL logic |
| Fractional chart times | Floor to integer seconds + same-second replace | Floor halves the point density and needs a history dedupe; fractional is legal per typings and `PriceCache` guarantees strictly increasing times |

**Installation:**
```bash
# ---- backend (from backend/) — order matters; verified in a scratch copy ----
uv add "fastapi>=0.135" "python-dotenv>=1.2"
uv lock --upgrade-package fastapi --upgrade-package starlette --upgrade-package uvicorn --upgrade-package python-dotenv
uv sync --extra dev
uv run --extra dev pytest -q            # gate: 139 passed
uv tree --depth 1 | grep -i starlette   # must show starlette 1.x (else the bump didn't happen)

# ---- frontend (from repo root; Node 22 active via fnm/.nvmrc) ----
npx -y create-next-app@16.4.3 frontend --yes --ts --tailwind --eslint --app --src-dir \
  --import-alias "@/*" --use-npm --disable-git --skip-install --no-agent-feedback --no-cache-components
cd frontend
# then: delete turbopack.rules from next.config.ts, add postcss.config.mjs, set output:"export"
npm install
npm uninstall @tailwindcss/turbopack
npm install -D @tailwindcss/postcss@4.3.3 tailwindcss@4.3.3 typescript@~5.9.3 @types/node@^22
npm install lightweight-charts@^5.2.1 zustand@^5.0.16
npm install -D vitest@^5.0.5 vite@^8 @vitejs/plugin-react@^6 jsdom@^30 \
  @testing-library/react@^16.3 @testing-library/dom@^10 @testing-library/jest-dom@^7 @testing-library/user-event@^14
# package.json: "engines": {"node": "^22.22.0"}; scripts: "test": "vitest run"
```

**Version verification (this session, 2026-10-26):** npm: next 16.4.3, react 19.3.1, typescript 7.0.2 (latest; pin 5.9.3), tailwindcss 4.3.3, @tailwindcss/postcss 4.3.3, lightweight-charts 5.2.1, zustand 5.0.16, vitest 5.0.5, vite 8.3.5, @vitejs/plugin-react 6.1.2, jsdom 30.1.3, @testing-library/react 16.3.3, dom 10.4.2, jest-dom 7.0.1, user-event 14.6.8, eslint 10.13.0 (latest; keep ^9), eslint-config-next 16.4.3, @types/node 26.6.5 (latest; use ^22). PyPI: fastapi 0.162.0 (uploaded 2026-10-23), starlette 1.10.0 (2026-10-24), uvicorn 0.54.0 (2026-09-25), python-dotenv 1.2.4, pytest 9.1.1, pytest-asyncio 1.4.1, ruff 0.17.3, uv 0.13.6 (2026-10-27; pin image 0.13.5). Docker tags `ghcr.io/astral-sh/uv:0.13.5`, `node:22-slim`, `python:3.12-slim` all resolve (`docker manifest inspect`) [VERIFIED].

## Package Legitimacy Audit

Run via `gsd-tools query package-legitimacy check` on 2026-10-26. Every SUS verdict except `@tailwindcss/turbopack` is the `too-new` heuristic firing on a **recent release** of a long-established package (created 2011–2021, tens of millions of weekly downloads, official repos, no `postinstall` script) [VERIFIED: `npm view <pkg> time.created repository.url scripts.postinstall`].

| Package | Registry | Age (created) | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|---------------|--------------|-------------|---------|-------------|
| next | npm | 2011 | 38.2M | github.com/vercel/next.js | SUS (too-new release) | Approved; flagged; pin 16.4.3 |
| react / react-dom | npm | 2011 | 144.7M / 136.4M | github.com/react/react | SUS (too-new) | Approved; flagged |
| typescript | npm | — | 216.3M | microsoft | OK | Approved (pin ~5.9.3) |
| tailwindcss / @tailwindcss/postcss | npm | — | 116.9M / 23.5M | tailwindlabs | OK | Approved |
| lightweight-charts | npm | — | 738K | tradingview | OK | Approved (only dep `fancy-canvas@2.1.0`) |
| zustand | npm | 2019 | 40.9M | github.com/pmndrs/zustand | SUS (too-new; 5.0.16 published 2026-10-22) | Approved; flagged |
| vitest / vite / @vitejs/plugin-react | npm | 2020–2021 | 68M / 144M / 65.7M | vitest-dev, vitejs | SUS (too-new) | Approved; flagged |
| jsdom | npm | 2011 | 76.7M | github.com/jsdom/jsdom | SUS (too-new) | Approved; flagged |
| @testing-library/react / dom / jest-dom | npm | — | 43M / 53M / 49M | testing-library | OK | Approved |
| @testing-library/user-event | npm | 2019 | 37.2M | testing-library | SUS (too-new) | Approved; flagged |
| eslint / eslint-config-next | npm | 2013 / 2015 | 137M / 21.9M | eslint, vercel | SUS (too-new) | Approved; flagged (keep eslint ^9) |
| @types/node | npm | 2016 | 363M | DefinitelyTyped | SUS (too-new) | Approved; flagged (use ^22) |
| @tailwindcss/turbopack | npm | 2026-07-31 | 0 reported | tailwindlabs | SUS (low-downloads) | **Not used.** Replaced by `@tailwindcss/postcss` |
| vite-tsconfig-paths | npm | — | 28.3M | — | OK | **Not used** (Vite 8 native) |
| fastapi / starlette / python-dotenv | PyPI | — | unknown | tiangolo / encode / theskumar | SUS (too-new, unknown-downloads) | Approved; flagged; versions locked by `uv.lock` hashes |
| uvicorn | PyPI | — | unknown | encode | SUS (unknown-downloads) | Approved |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** next, react, react-dom, zustand, vitest, vite, @vitejs/plugin-react, jsdom, @testing-library/user-event, eslint, eslint-config-next, @types/node, fastapi, starlette, python-dotenv, uvicorn. All are recency/metadata flags on mainstream packages. **Planner action:** add one consolidated `checkpoint:human-verify` before the first `npm install` / `uv lock` in Phase 1 that lists these exact versions. A separate checkpoint per package adds nothing. `@tailwindcss/turbopack` is excluded from the plan entirely.

## Architecture Patterns

### System Architecture Diagram

```
 start_mac.sh / start_windows.ps1
   │ (.env missing? copy .env.example) → docker compose up -d [--build] --wait --wait-timeout N
   ▼
 ┌──────────────── container "app" (127.0.0.1:8000 → 8000) ── volume finally-data → /app/db ─┐
 │ uvicorn app.main:create_app --factory --workers 1                                          │
 │   lifespan: db.init (schema.sql + seed-once) → tracked = watchlist ∪ positions             │
 │             → source.start(tracked) → snapshot() → task: snapshot every 30s               │
 │                                                                                            │
 │  Request ─► Router order:                                                                  │
 │   1 stream router  GET /api/stream/prices (SSE) ── reads ─┐                                │
 │                    GET /api/prices/{t}/history ── reads ──┤                                │
 │   2 watchlist router GET/POST /api/watchlist, DELETE /api/watchlist/{t}                    │
 │        └─► WatchlistService [asyncio.Lock]                                                 │
 │              ├─ to_thread: validate → txn (dup? → 200 | cap? → 400 | insert → 201)         │
 │              └─ tracker.reconcile() ─► source.add_ticker / remove_ticker ─► PriceCache ◄───┘
 │   3 system router  GET /api/health                                                         │
 │   4 catch-all      /api/{path:path} (all methods) → 404 {"error": "Not found"}             │
 │   5 StaticFiles("/", html=True) → out/index.html | 404.html   (only if index.html exists)  │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ REST (JSON, ISO times)                         ▲ SSE frames (all tickers, Unix float s)
 ┌──────┴────────────── Browser: single page (Next static export) ─────┴──────────────────────┐
 │ priceStream (one EventSource; status machine; backoff) ─► priceStore.ingestFrame(frame)    │
 │ watchlist fetch ─► watchlistStore            ui store: selectedTicker                      │
 │ Header(dot ◄ status) │ Watchlist rows (selector per ticker: price, Chg %, flash, spark)    │
 │ MainChart: on select → GET history (request-id guarded) → setData → subscribe → update()   │
 │ Placeholders: heatmap, P&L, positions/trade bar, chat (D-01)                               │
 └────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
backend/app/
├── main.py              # create_app(settings=None, *, source=None) -> FastAPI; lifespan; no module-level app
├── config.py            # Settings.from_env(): dotenv, DB_PATH/STATIC_DIR defaults, DEV_CORS_ORIGIN
├── errors.py            # DomainError(400), NotFoundError(404) + handlers → {"error": msg}
├── db/
│   ├── __init__.py      # Database(path): connect(), transaction(), init(), now_iso()
│   ├── schema.sql       # all six PLAN §7 tables (CREATE TABLE IF NOT EXISTS)
│   └── seed.py          # DEFAULT_USER_ID, DEFAULT_CASH, DEFAULT_WATCHLIST; seed-once
├── tickers.py           # TICKER_RE, normalize_ticker() (raises DomainError)
├── tracker.py           # TickerTracker.reconcile() (watchlist ∪ positions vs source)
├── snapshots.py         # record_snapshot(), run_snapshot_loop()
├── watchlist/
│   ├── repo.py          # SQL: list, get, count, insert, delete
│   └── service.py       # WatchlistService (asyncio.Lock; owns reconcile calls)
├── api/
│   ├── watchlist.py     # create_watchlist_router(service, cache)
│   └── system.py        # create_system_router(): /api/health
└── market/              # EXISTS — unchanged
backend/tests/
├── conftest.py          # settings(tmp_path), app/client fixtures (with TestClient(app) as c)
├── test_config.py  test_db.py  test_tracker.py  test_snapshots.py
└── api/ test_watchlist.py  test_system.py  test_static.py
frontend/
├── .env.development     # NEXT_PUBLIC_API_BASE=http://localhost:8000 (committed; next dev only)
├── next.config.ts  postcss.config.mjs  vitest.config.mts  vitest.setup.ts  CLAUDE.md
└── src/
    ├── app/ layout.tsx  page.tsx ("use client" <Terminal/>)  globals.css (@theme, flash keyframes)
    ├── api/ client.ts (apiFetch, ApiError)  types.ts (PLAN §6/§8)  ticker.ts (TICKER_RE)  watchlist.ts
    ├── stream/ priceStream.ts (connectPriceStream(opts, makeEventSource))
    ├── store/ prices.ts  watchlist.ts  ui.ts
    ├── domain/ format.ts  chgPercent.ts  sparkline.ts  chartTime.ts  selection.ts
    ├── components/ Terminal.tsx  header/  watchlist/  chart/  placeholders/
    └── test/ FakeEventSource.ts  fixtures.ts
Dockerfile  docker-compose.yml  scripts/{start_mac.sh,stop_mac.sh,start_windows.ps1,stop_windows.ps1}
```

### Verified in-repo values (quoted verbatim, for code that touches the market package)

- Public exports [VERIFIED: backend/app/market/__init__.py:12-25 (cat this session; re-exports confirmed in backend/CLAUDE.md:15)]: `from app.market import PriceCache, PricePoint, PriceUpdate, MarketDataSource, create_market_data_source` plus `create_stream_router`.
- Routes [VERIFIED: backend/app/market/stream.py:29, 51]: `@router.get("/api/stream/prices")` and `@router.get("/api/prices/{ticker}/history")`. History returns `{"ticker": symbol, "points": [p.to_dict() ...]}` with `symbol = ticker.strip().upper()` (lines 54-58).
- SSE preamble [VERIFIED: stream.py:77]: `yield "retry: 1000\n\n"`; keep-alive `": keep-alive\n\n"` after `KEEPALIVE_INTERVAL = 15.0` (line 19). Frames go out on every `price_cache.version` change (lines 86-90).
- SSE tick fields [VERIFIED: backend/app/market/models.py:55-64]: `"ticker"`, `"price"`, `"previous_price"`, `"open_price"`, `"timestamp"`, `"change"`, `"change_percent"`, `"direction"`; direction values `"up"`, `"down"`, `"flat"` (lines 47-51).
- Factory reads env at construction [VERIFIED: factory.py:29]: `api_key = os.environ.get("MASSIVE_API_KEY", "").strip()`. So `load_dotenv` must run **before** `create_market_data_source(cache)`.
- Cache [VERIFIED: cache.py:22-23, 48-53, 72-78]: `HISTORY_SECONDS: float = 300.0`, `HISTORY_MAX_POINTS: int = 600`; timestamps forced strictly increasing per ticker (`ts = prev.timestamp + 0.001`); `remove()` drops price, open and history and bumps `version`.
- Simulator [VERIFIED: simulator.py:258-277]: `add_ticker` seeds the cache immediately (`if price is not None and ticker not in self._cache: self._cache.update(...)`); `remove_ticker` calls `self._cache.remove(ticker)`; `get_tickers()` returns `[]` before start. Probe: `start([])` then `add_ticker("PYPL")` prices immediately; remove clears it.
- `.env.example` already committed [VERIFIED: .env.example:1-21] with `# DB_PATH=` commented out (line 21) and `OPENROUTER_API_KEY=`, `MASSIVE_API_KEY=`, `MASSIVE_POLL_INTERVAL=15`, `LLM_MOCK=false`. D-15's "committed in this phase" is already satisfied; add `DEV_CORS_ORIGIN` as a commented line only.
- `.dockerignore` already excludes `.env`, `.env.*` (root only), `db`, `test`, `**/node_modules`, `frontend/.next`, `frontend/out`, `**/.venv`, `**/CLAUDE.md` [VERIFIED: .dockerignore:4-45].
- `.gitattributes` [VERIFIED: .gitattributes:3,6]: `* text=auto eol=lf` and `*.ps1 text eol=crlf`.

### Pattern 1: App factory + lifespan, run with `--factory`
**What:** Build inert objects in `create_app()`, do all work in `lifespan`. Run uvicorn with `app.main:create_app --factory` so importing `app.main` in tests has **no side effects** (no dotenv load, no env read). A module-level `app = create_app()` would load the developer's real `.env` (possibly with a real `MASSIVE_API_KEY`) at test import time.
**When to use:** The single entry point; tests call `create_app(Settings(...), source_factory=lambda cache: ...)`.
```python
# Source: probe-verified on FastAPI 0.162.0 / Starlette 1.10.0 (scratch), pattern from .planning/research/ARCHITECTURE.md
SourceFactory = Callable[[PriceCache], MarketDataSource]

def create_app(settings: Settings | None = None, *, source_factory: SourceFactory | None = None) -> FastAPI:
    settings = settings or Settings.from_env()          # loads .env BEFORE the factory reads MASSIVE_API_KEY
    cache = PriceCache()
    source = (source_factory or create_market_data_source)(cache)   # tests inject a source bound to THIS cache
    db = Database(settings.db_path)
    tracker = TickerTracker(db, source)
    watchlist = WatchlistService(db, cache, tracker)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await asyncio.to_thread(db.init)                                   # schema + seed-once
        await source.start(await asyncio.to_thread(db.tracked_tickers))   # watchlist ∪ positions
        await watchlist.record_snapshot()                                  # OPS-01 initial snapshot
        task = asyncio.create_task(run_snapshot_loop(watchlist, 30.0), name="snapshot-loop")
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
            await source.stop()

    app = FastAPI(lifespan=lifespan, exception_handlers=error_handlers())
    if settings.dev_cors_origin:                                           # D-13: opt-in only
        app.add_middleware(CORSMiddleware, allow_origins=[settings.dev_cors_origin],
                           allow_methods=["*"], allow_headers=["*"])
    app.include_router(create_stream_router(cache))
    app.include_router(create_watchlist_router(watchlist, cache))
    app.include_router(create_system_router())
    install_api_not_found(app)                                             # AFTER all /api routers
    mount_static(app, settings.static_dir)                                 # LAST; skipped if no index.html
    return app
```
Note: the snapshot lock and the "record snapshot" method can live on a small `Commands`-style object. Phase 2's trade and reset will take the same lock; name it so Phase 2 extends it instead of creating a second lock.

### Pattern 2: Settings from env
- `load_dotenv(REPO_ROOT / ".env", override=False)` where `REPO_ROOT = Path(__file__).resolve().parents[2]` (`backend/app/config.py` → repo). In Docker, `.env` isn't in the image (dockerignored), so this is a no-op.
- `db_path = os.environ.get("DB_PATH", "").strip() or str(REPO_ROOT / "db" / "finally.db")`. Then `Path(db_path).resolve().parent.mkdir(parents=True, exist_ok=True)`, and log the resolved path at INFO (never log key values).
- `static_dir = os.environ.get("STATIC_DIR", "").strip() or str(Path(__file__).resolve().parents[1] / "static")`. That is `backend/static` locally and `/app/static` in the image (backend copied to `/app`).
- `dev_cors_origin = os.environ.get("DEV_CORS_ORIGIN", "").strip() or None`.
- Frozen dataclass. Any secret fields added later (Phase 3 `openrouter_api_key`) use `field(repr=False)`, so a logged or printed `Settings` never leaks keys (OPS-03).
- Configure logging once (`logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")`). Otherwise the app and market INFO lifecycle logs go to Python's last-resort handler, which prints WARNING+ only [ASSUMED: standard Python logging behavior with uvicorn's default config, which only configures `uvicorn.*` loggers].

### Pattern 3: SQLite helper, connection per unit of work
```python
# Source: Python 3.12 sqlite3 docs (cited in .planning/research/PITFALLS.md #3); seed-once probe-verified
class Database:
    def __init__(self, path: str) -> None:
        self._path = path

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._path, timeout=5.0, isolation_level=None)  # explicit txns
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        with closing(self.connect()) as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                yield conn
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            conn.execute("COMMIT")

    def init(self) -> None:
        with closing(self.connect()) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA_SQL)              # only here: executescript COMMITs implicitly
        with self.transaction() as conn:
            seed(conn)                                  # seed-once, see Pitfall 1
```
- Timestamps: `datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")`. No `detect_types`.
- `schema.sql` contains all six PLAN §7 tables now (users_profile, watchlist, positions, trades, portfolio_snapshots, chat_messages), with `UNIQUE (user_id, ticker)` on watchlist and positions. Phase 2/3 then never alter the schema.
- `db.tracked_tickers()` = `SELECT ticker FROM watchlist WHERE user_id=? ORDER BY added_at, rowid` ∪ `SELECT ticker FROM positions WHERE user_id=?`, de-duplicated with order preserved.

### Pattern 4: Snapshot recorder (OPS-01, Phase 1 scope)
`total_value = cash + Σ quantity × (cache.get_price(t) or avg_cost)`, inserted into `portfolio_snapshots` with a UUID id and ISO `recorded_at`. The DB work runs via `asyncio.to_thread`, under the same mutation lock the watchlist service uses (Phase 2 reset and trades will share it). The loop: `while True: await asyncio.sleep(interval); try: await record() except Exception: logger.exception("Snapshot failed")`. Do not catch `CancelledError`. With no positions in Phase 1 it records 10000.0. Keep the valuation as a pure function so Phase 2's `GET /api/portfolio` reuses it.

### Pattern 5: Watchlist service + tracker reconcile
```python
# Source: .planning/research/ARCHITECTURE.md Patterns 2-3; ordering rules from PLAN §8 + G-13
class WatchlistService:
    def __init__(self, db, cache, tracker):
        self._db, self._cache, self._tracker = db, cache, tracker
        self._lock = asyncio.Lock()

    async def add(self, raw: str) -> tuple[dict, bool]:          # (entry, created)
        ticker = normalize_ticker(raw)                            # DomainError → 400 (NOT a Pydantic pattern → 422)
        async with self._lock:
            row, created = await asyncio.to_thread(self._add_tx, ticker)  # dup → existing (200) BEFORE cap check
            if created:
                await self._tracker.reconcile()                   # simulator prices it now
        return self._entry(row), created

    def _add_tx(self, ticker):
        with self._db.transaction() as conn:
            existing = repo.get(conn, ticker)
            if existing:
                return existing, False
            if repo.count(conn) >= WATCHLIST_CAP:                 # 50
                raise DomainError(f"Watchlist is full ({WATCHLIST_CAP} tickers). Remove one first.")
            return repo.insert(conn, ticker, now_iso()), True

    async def remove(self, raw: str) -> None:
        ticker = normalize_ticker(raw)
        async with self._lock:
            deleted = await asyncio.to_thread(self._remove_tx, ticker)
            if not deleted:
                raise NotFoundError(f"{ticker} is not on your watchlist")
            await self._tracker.reconcile()                       # held tickers stay tracked

    def _entry(self, row) -> dict:                                # PLAN §8 shape
        u = self._cache.get(row["ticker"])
        return {"ticker": row["ticker"], "price": u.price if u else None,
                "open_price": u.open_price if u else None, "added_at": row["added_at"]}
```
- `TickerTracker.reconcile()`: `desired = set(await to_thread(db.tracked_tickers))`, `current = set(source.get_tickers())`. Await `add_ticker` for `desired - current` and `remove_ticker` for `current - desired`, **on the event loop**. The simulator isn't thread-safe, so never call it from `to_thread` or a sync route.
- Routes are `async def`. POST returns `JSONResponse(entry, status_code=201 if created else 200)`. DELETE returns `Response(status_code=204)`. The request body model is `class WatchlistAdd(BaseModel): ticker: str`, with no `pattern=` (a pattern would turn malformed tickers into 422 instead of the required 400).
- A malformed ticker in `DELETE /api/watchlist/{ticker}` → 400 (PLAN §8 "malformed ticker" is a business-rule failure).
- In Massive mode an added ticker has `price: null` until the next poll. That is expected (PLAN §6).

### Pattern 6: Error envelope, JSON 404, static mount (probe-verified)
```python
# Source: probe on Starlette 1.10.0 — results: GET/POST /api/nope → 404 {"error":"Not found"};
# GET / → index.html 200; GET /missing-page → 404.html (text/html, 404); POST / → 405 {"error": ...}
async def http_exc(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

def error_handlers() -> dict:
    return {StarletteHTTPException: http_exc, DomainError: domain_exc, NotFoundError: not_found_exc}

def install_api_not_found(app: FastAPI) -> None:
    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                   include_in_schema=False)
    async def api_not_found(path: str) -> JSONResponse:
        return JSONResponse({"error": "Not found"}, status_code=404)

def mount_static(app: FastAPI, static_dir: str) -> None:
    if (Path(static_dir) / "index.html").is_file():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
```
- Leave `RequestValidationError` with FastAPI's default 422 (PLAN §8).
- Side effect: the all-methods catch-all fully matches `PUT /api/health`, so it returns 404, not 405 (probe). Acceptable. Without all methods, `POST /api/unknown` would fall through to `StaticFiles` → 405.
- Do **not** add `GZipMiddleware` (it buffers SSE).

### Pattern 7: Connection status state machine (MD-04, G-01)
```ts
// Source: WHATWG EventSource readyState semantics (cited in .planning/research/FEATURES.md G-01)
type Status = "connecting" | "open" | "closed";        // yellow | green | red
const BACKOFF_MS = [1000, 2000, 5000];
export function connectPriceStream(
  opts: { url: string; onFrame: (f: PriceFrame) => void; onStatus: (s: Status) => void },
  makeEventSource: (url: string) => EventSource = (u) => new EventSource(u),
): () => void {
  let es: EventSource | null = null, attempt = 0, timer: ReturnType<typeof setTimeout> | null = null, stopped = false;
  const open = () => {
    opts.onStatus("connecting");
    es = makeEventSource(opts.url);
    es.onopen = () => { attempt = 0; opts.onStatus("open"); };
    es.onmessage = (e) => opts.onFrame(JSON.parse(e.data));
    es.onerror = () => {
      if (!es || es.readyState !== EventSource.CLOSED) { opts.onStatus("connecting"); return; } // browser retries (retry: 1000)
      opts.onStatus("closed");
      es.close(); es = null;
      const delay = BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)];
      if (!stopped) timer = setTimeout(open, delay);          // browser never retries after CLOSED
    };
  };
  open();
  return () => { stopped = true; if (timer) clearTimeout(timer); es?.close(); };
}
```
- Start it once from the root client component's `useEffect` and return the cleanup. Under StrictMode the effect mounts, cleans up and mounts again, so one connection survives.
- URL is `` `${API_BASE}/api/stream/prices` `` with `API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? ""`. That must be a **direct** `process.env.NEXT_PUBLIC_API_BASE` access. Next does not inline dynamic lookups such as `process.env[name]` or `const env = process.env; env.X` [CITED: Next.js 16 docs, environment-variables guide via Context7].
- Treat `EventSource.CLOSED` as the constant `2` in tests: the FakeEventSource must expose `CONNECTING=0, OPEN=1, CLOSED=2` statics and be installed on `globalThis`.

### Pattern 8: Price store (MD-01, MD-02, G-23)
```ts
// Source: .planning/research/ARCHITECTURE.md Pattern 6 (frame ingestion rules)
ingestFrame(frame: Record<string, PriceTick>) {
  set((s) => {
    const ticks: Record<string, PriceTick> = {};            // REPLACE, never merge (removed tickers vanish)
    const lastTs: Record<string, number> = {}; const spark: Record<string, number[]> = {};
    for (const [t, tick] of Object.entries(frame)) {
      ticks[t] = tick;
      const prev = s.lastTs[t] ?? 0;
      lastTs[t] = Math.max(prev, tick.timestamp);
      const buf = s.spark[t] ?? [];
      spark[t] = tick.timestamp > prev ? [...buf, tick.price].slice(-SPARK_MAX) : buf;  // new tick only
    }
    return { ticks, lastTs, spark };
  });
}
// Chg % (MD-02): open_price > 0 ? (price - open_price) / open_price * 100 : null  → render "—" for null
```
- Rows subscribe with a narrow selector (`usePrices((s) => s.ticks[ticker])`) and `React.memo`, so each 500ms frame re-renders only the rows that changed.
- Initial render falls back to `GET /api/watchlist` `price`/`open_price` until the first SSE frame arrives.
- Format with a fixed locale (`Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })`) and `tabular-nums`.

### Pattern 9: Price flash without setState-in-effect (MD-03)
`eslint-plugin-react-hooks@7.1.1` (bundled by `eslint-config-next@16.4.3`) reports `react-hooks/set-state-in-effect` as an **error** [VERIFIED: probe lint output]. Derive the flash in render instead: key a span by the tick timestamp so React remounts it on every new tick, which restarts the CSS animation.
```tsx
// Flash only on a real change: direction comes from the SSE tick ("up" | "down" | "flat")
const flash = tick && tick.direction !== "flat" ? `flash-${tick.direction}` : "";
<span key={tick?.timestamp} className={`tabular-nums ${flash}`} data-testid={`price-${ticker}`}
      data-direction={tick?.direction}>{fmt(tick?.price)}</span>
```
```css
/* globals.css */
@keyframes flash-up   { from { background-color: rgb(34 197 94 / 0.35); } to { background-color: transparent; } }
@keyframes flash-down { from { background-color: rgb(239 68 68 / 0.35); } to { background-color: transparent; } }
.flash-up   { animation: flash-up 500ms ease-out; }
.flash-down { animation: flash-down 500ms ease-out; }
```
Unit test: render with tick A (up) → class `flash-up`; rerender with tick B (new timestamp, up) → a new element exists (not the same node) and still carries `flash-up`; a flat tick → no class. Use only the timestamp as the key. Frames with an unchanged timestamp (Massive mode repeats) don't remount, so they don't flash.

### Pattern 10: Sparkline (MD-05)
A pure function `sparkPoints(values, width, height)` returns the `points` string for `<polyline fill="none" stroke=... strokeWidth={1}>`. Scale min/max to the box and handle a single point and `min === max` (flat line at mid-height). `SPARK_MAX = 300` (about 2.5 min at 500ms, inside G-02's 300–600 range). The color is discretion; the recommendation is green when `price >= open_price`, red otherwise. Drop buffers for tickers absent from the frame (the replace semantics above already do this).

### Pattern 11: Main chart (MD-06, D-09..D-12), verified against lightweight-charts 5.2.1
```tsx
// Source: lightweight-charts@5.2.1 dist/typings.d.ts (AreaSeries, createPriceLine, LineStyle.Dashed = 2,
// TickMarkFormatter = (time, tickMarkType, locale) => string | null, UTCTimestamp seconds) + Context7 v5.2.1 docs
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const toLocal = (t: Time) => (typeof t === "number" ? fmtTime.format(new Date(t * 1000)) : String(t));

useEffect(() => {                                   // create ONCE per mount
  const chart = createChart(el.current!, {
    autoSize: true,
    layout: { background: { color: "#0d1117" }, textColor: "#8b949e" },
    grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
    timeScale: { timeVisible: true, secondsVisible: true, tickMarkFormatter: toLocal },
    localization: { timeFormatter: toLocal },
  });
  const series = chart.addSeries(AreaSeries, {
    lineColor: "#209dd7", topColor: "rgba(32,157,215,0.35)", bottomColor: "rgba(32,157,215,0)", lineWidth: 2,
  });
  chartRef.current = { chart, series, openLine: null, lastTime: -Infinity };
  return () => chart.remove();
}, []);
```
- **On ticker change:** bump a request id, `series.setData([])`, show "Loading AAPL…", then `fetch(history)`. If the response's request id is stale, discard it. Otherwise `setData(points.map(p => ({ time: p.timestamp as UTCTimestamp, value: p.price })))`, set `lastTime` to the last point, and `chart.timeScale().fitContent()`.
- **Live append:** subscribe imperatively (`usePrices.subscribe(...)`), not through props. For the selected ticker's new tick: if `tick.timestamp <= lastTime`, drop it (MD-06 out-of-order guard; `update()` throws `Cannot update oldest data` when `time < last` [VERIFIED: lightweight-charts.development.mjs:11646-11647]). Otherwise `series.update({ time, value })` and set `lastTime = time`. Ignore ticks until history has loaded.
- **Fractional seconds:** pass Unix float seconds as-is. The typings example is `(Date.now() / 1000) as UTCTimestamp` [VERIFIED: typings.d.ts:5012-5015], and `PriceCache` guarantees strictly increasing per-ticker times [VERIFIED: cache.py:52-53]. Never pass milliseconds.
- **Open line (D-11):** `series.createPriceLine({ price: open, color: "#8b949e", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Open" })`. Store the `IPriceLine` and call `line.applyOptions({ price })` if `open_price` arrives later or changes. On ticker switch, `series.removePriceLine(line)` [VERIFIED: typings.d.ts:2229-2552].
- Give the container an explicit height (the flex/grid cell) and create the chart only in `useEffect`. Next prerenders client components at build time, so chart code must never run at module or render scope.

### Pattern 12: Selection rules (MD-07, G-05)
Pure `nextSelection(watchlist: string[], selected: string | null, removed?: string): string | null`:
- On load: `watchlist[0] ?? null`.
- After removing the selected ticker: the first remaining ticker, or `null` (empty state "Add a ticker to start charting").
- Otherwise keep the current selection.

Clicking `×` calls `event.stopPropagation()` (D-06). Make the row a `button`-like element with `aria-pressed` and the `×` a separate focusable button, so both are keyboard reachable.

### Pattern 13: Packaging
```dockerfile
# Frontend stage probe-built in node:22-slim with the Windows-generated lockfile (npm ci OK)
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build                                   # → /frontend/out (index.html, 404.html, _next/)

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0 \
    DB_PATH=/app/db/finally.db PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project
COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked
COPY --from=frontend /frontend/out ./static
RUN mkdir -p /app/db
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--timeout-graceful-shutdown", "5"]
```
(Dev tools are a `[project.optional-dependencies] dev` extra [VERIFIED: backend/pyproject.toml:14-22], so `uv sync --locked` without `--extra dev` already excludes them.)
```yaml
# docker-compose.yml — syntax validated with `docker compose config` on Compose v5.5.1
name: finally
services:
  app:
    build: .
    image: finally:latest            # stable name for the start scripts' "image missing?" check
    ports:
      - "127.0.0.1:8000:8000"         # see Assumption A2
    env_file:
      - path: .env
        required: false               # fresh clone without .env still starts
    volumes:
      - finally-data:/app/db
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
volumes:
  finally-data:
    name: finally-data                # exact volume name (otherwise it is prefixed with the project name)
```
- Start scripts: Docker running? (`docker info` → `$LASTEXITCODE`/`$?`). Copy `.env.example` to `.env` if missing (D-15). Build when `--build` is passed or `docker image inspect finally:latest` fails. Then `docker compose up -d [--build] --wait --wait-timeout 90`. On a non-zero exit, print `docker compose logs --tail 50 app` and a clear message. Print `http://localhost:8000` and open the browser unless `--no-open`. Stop scripts: `docker compose down` (never `-v`).
- PowerShell 5.1 is the only shell on this machine (no `pwsh`) [VERIFIED: `$PSVersionTable` 5.1.26100]. This param block accepts both `-Build/-NoOpen` and literal `--build/--no-open` [VERIFIED: probe]:
  `param([switch]$Build, [switch]$NoOpen, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)`, then `if ($Rest -contains "--build") { $Build = $true }`. Native commands don't throw, so check `$LASTEXITCODE` after every `docker` call. Keep the file ASCII-only (no em dashes or check marks). The CurrentUser policy here is `RemoteSigned` [VERIFIED], but document `powershell -ExecutionPolicy Bypass -File scripts\start_windows.ps1` for students.
- `.sh` files: `#!/usr/bin/env bash`, `set -euo pipefail`, LF (enforced by `.gitattributes`), and the exec bit via `git add --chmod=+x scripts/*.sh` (verify with `git ls-files -s scripts` → `100755`). Open the browser with `open` (macOS) or `xdg-open` (Linux, if present).

### Anti-Patterns to Avoid
- **Module-level `app = create_app()`:** loads the real `.env` at test import. Use `--factory`.
- **Pydantic `pattern=` on the ticker field:** turns malformed tickers into 422; the contract says 400.
- **Cap check before duplicate check:** a 50-ticker list would reject re-adding an existing ticker with 400 instead of 200.
- **Calling `source.add_ticker/remove_ticker` from sync routes or `to_thread`:** races the simulator loop. Await them on the event loop.
- **Merging SSE frames into the price map:** removed tickers ghost forever. Replace per frame.
- **`setState` in `useEffect` for flashes:** lint error (react-hooks 7) and extra renders. Derive in render.
- **Chart created in render or recreated on data change:** canvas flashes, zoom is lost, prerender crashes.
- **`next/font/google` (template default Geist):** downloads fonts during `next build`, a network dependency in Docker. Use the system `font-mono` / `font-sans` stacks.
- **`frontend/.env.local` with `NEXT_PUBLIC_API_BASE`:** `next build` loads `.env.local`, and the root `.dockerignore` pattern `.env.*` only matches the root. A developer's local file would be baked into the image's bundle. Put the dev API base in `frontend/.env.development` (loaded only by `next dev`) and add `**/.env*.local` to `.dockerignore`.
- **GZip middleware, multiple workers, `--reload` in Docker:** buffered SSE or divergent caches.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE endpoint, price history, session open | A new stream/history route | Existing `create_stream_router(price_cache)` | Built and tested (139 tests) |
| Static file serving / path safety | Custom file route | `StaticFiles(directory, html=True)` | Handles traversal, `index.html`, `404.html`, HEAD |
| Dev CORS | Manual headers | `starlette.middleware.cors.CORSMiddleware` (opt-in) | Preflight for DELETE handled |
| Health gating in scripts | Bespoke curl/IWR retry loops | `docker compose up --wait --wait-timeout N` + compose healthcheck | One definition (OPS-07); identical on both OSes |
| Time-axis formatting | Pre-shifting timestamps by the tz offset | `timeScale.tickMarkFormatter` + `localization.timeFormatter` with `Intl.DateTimeFormat` | Library rule: "do not pre-shift timestamps" (Context7 LWC v5.2.1 rules) |
| Chart rendering | Canvas/SVG main chart | Lightweight Charts 5.2.1 | PLAN §10 |
| Env loading | Hand parsing `.env` | `python-dotenv` `load_dotenv(path, override=False)` | Precedence and quoting edge cases |
| Store selectors | Context + useReducer for live prices | Zustand selectors (or `useSyncExternalStore`) | Context re-renders every consumer on each tick |

**Key insight:** most of this phase is glue around a finished market engine. The expensive mistakes come from re-implementing pieces (stream, static serving, health waits) or from defaults that look harmless (seed every start, Pydantic regex, module-level app, merge frames).

## Common Pitfalls

### Pitfall 1: Re-seeding removed default tickers on every restart
**What goes wrong:** `INSERT OR IGNORE` of the 10 defaults runs at every startup, so a removed AAPL comes back after `stop`/`start`. That breaks success criterion 4.
**Why it happens:** PLAN §7's idempotent seed is read as "insert defaults every time".
**How to avoid:** In one transaction, `cur = conn.execute("INSERT OR IGNORE INTO users_profile ...")`. Insert the default watchlist **only if `cur.rowcount == 1`** (the user row was just created). Still `INSERT OR IGNORE`, still no "is the DB empty?" probe. Probe result: first seed `True`, after deleting AAPL the second seed is `False`, and AAPL stays gone [VERIFIED: sqlite3 3.53.1 probe]. Phase 2's Reset restores the default watchlist explicitly.
**Warning signs:** a test "remove AAPL → re-run `db.init()` → AAPL absent" fails.

### Pitfall 2: Nondeterministic watchlist order
**What goes wrong:** the seed writes all 10 rows within the same second; `ORDER BY added_at` ties and the order is unstable.
**How to avoid:** `ORDER BY added_at, rowid` (the tables have a rowid because they aren't `WITHOUT ROWID`) [VERIFIED: probe returned seed order].

### Pitfall 3: FastAPI bumped but Starlette not
**What goes wrong:** `uv add "fastapi>=0.135"` yields FastAPI 0.162.0 with **Starlette 0.52.1** still locked [VERIFIED: scratch]. D-16's intent (Starlette 1.x) silently isn't met.
**How to avoid:** `uv lock --upgrade-package fastapi --upgrade-package starlette --upgrade-package uvicorn --upgrade-package python-dotenv`, then check `uv tree` and run the 139 tests (they pass on 0.162.0 / 1.10.0 / 0.54.0).
**Warning signs:** `uv.lock` shows `name = "starlette"` / `version = "0.52.1"`.
**Note:** Starlette 1.10 emits `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated; install httpx2 instead` [VERIFIED: starlette/testclient.py:26-44]. It is only a warning; keep `httpx`. Optionally add a pytest `filterwarnings` entry. Do not add `httpx2` in this phase (not legitimacy-checked).

### Pitfall 4: create-next-app 16.4.3 defaults
**What goes wrong:** `--yes` enables `cacheComponents: true` + `partialPrefetching: true` and writes a Turbopack-only Tailwind loader (`@tailwindcss/turbopack`, no `postcss.config.mjs`). It also uses `next/font/google` Geist and a light/`prefers-color-scheme` `globals.css` [VERIFIED: scaffold probe + `create-next-app` dist source].
**How to avoid:** pass `--no-cache-components --disable-git --skip-install --no-agent-feedback`. Replace `next.config.ts` with `{ output: "export", images: { unoptimized: true } }`. Add `postcss.config.mjs` with `@tailwindcss/postcss`. Remove the Geist font imports and the template's color-scheme block. Keep the generated `AGENTS.md` (its "read `node_modules/next/dist/docs/`" note helps agents) and add `frontend/CLAUDE.md` with `@AGENTS.md` plus the dev-loop notes (D-13).

### Pitfall 5: Prerender crashes and hydration mismatches
**What goes wrong:** `EventSource`, `createChart`, `window` or `ResizeObserver` touched at module or render scope breaks `next build`. Locale-dependent formatting differs between build and browser.
**How to avoid:** all browser APIs in `useEffect`; `"use client"` on the terminal root; fixed `en-US` number formatting; live values render after mount. The time formatter uses `undefined` (local) locale only inside chart callbacks, never in prerendered markup.

### Pitfall 6: Red dot never appears during a plain server stop
**What goes wrong:** with the server down, browsers usually treat connection-refused as a network error and keep `readyState === CONNECTING` (yellow), retrying every `retry: 1000` ms. Red (`CLOSED`) happens on a non-200 or wrong-content-type response [CITED: WHATWG via .planning/research/FEATURES.md G-01; per-browser connection-refused behavior ASSUMED].
**How to avoid:** implement the state machine exactly as specified and unit-test red with the FakeEventSource. For manual UAT, stopping the container shows yellow; red can be forced by making the stream return non-200. Don't add a "no data for N seconds → red" heuristic (Massive mode ticks every 15s).

### Pitfall 7: `DB_PATH` outside the volume / empty override
**What goes wrong:** an empty `DB_PATH=` from `.env` overrides the Dockerfile `ENV`, falls back to `<repo>/db` = `/db` in the image, and data is lost on `down`/`up`.
**How to avoid:** `.env.example` already comments it out [VERIFIED: .env.example:21]. Treat empty as unset, log the resolved path at startup, and in Docker expect `/app/db/finally.db`.

### Pitfall 8: Volume and project naming
**What goes wrong:** without `name: finally-data` under `volumes:`, Compose creates `<project>_finally-data` (the project defaults to the directory name `finally-std`). The start script's image check then guesses the wrong image name.
**How to avoid:** a top-level `name: finally`, an explicit volume `name:`, and `image: finally:latest` [VERIFIED: `docker compose config` output shows `name: finally-data`].

### Pitfall 9: Lint and type gates the scaffold adds
`eslint-config-next` 16 rules (`react-hooks/set-state-in-effect`, `refs`, `@typescript-eslint/no-explicit-any`) fail on common agent patterns, including test files [VERIFIED: probe]. Make `npm run lint` and `npx tsc --noEmit` per-plan gates.

### Pitfall 10: Local Python ≠ container Python
`backend/.venv` here is Python 3.13 (uv picked 3.13.16; no `.python-version`) while the image is 3.12 [VERIFIED: `pyvenv.cfg` version_info = 3.13]. Recommend `backend/.python-version` = `3.12` so local tests match the container (uv downloads 3.12 automatically). If adopted, the venv is recreated.

## Code Examples

### Ticker normalization (shared by every route)
```python
TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.]{0,9}$")   # PLAN §7

def normalize_ticker(raw: str) -> str:
    symbol = (raw or "").strip().upper()
    if not TICKER_RE.fullmatch(symbol):
        raise DomainError(f"Invalid ticker {symbol or raw!r}: use 1-10 letters, digits or '.', starting with a letter.")
    return symbol
```
```ts
// frontend/src/api/ticker.ts — the single client constant (D-08); alias import verified in probe
export const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
export const normalizeTicker = (s: string) => s.trim().toUpperCase();
```

### Tailwind v4 theme (UX-01)
```css
/* Source: Tailwind v4 @theme (Context7 tailwindcss.com docs); utilities verified in built CSS */
@import "tailwindcss";
@theme {
  --color-bg: #0d1117;  --color-panel: #1a1a2e;  --color-border: #30363d;
  --color-muted: #8b949e;  --color-text: #e6edf3;
  --color-accent: #ecad0a;  --color-primary: #209dd7;  --color-submit: #753991;
  --color-up: #22c55e;  --color-down: #ef4444;
}
html, body { background: var(--color-bg); color: var(--color-text); }
```
`bg-bg`, `bg-panel`, `text-accent`, `border-primary`, `bg-submit` and `tabular-nums` are then available. Exact neutrals and up/down hues are discretion (the UI phase may refine them).

### Vitest config (Vite 8 native alias)
```ts
// vitest.config.mts — probe-verified (2 test files passed, alias resolved)
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"] },
});
// vitest.setup.ts: import "@testing-library/jest-dom/vitest"; install FakeEventSource on globalThis;
// stub ResizeObserver; vi.mock("lightweight-charts", ...) (jsdom has no canvas)
```

### Backend test fixture
```python
@pytest.fixture
def client(tmp_path):
    settings = Settings(db_path=str(tmp_path / "t.db"), static_dir=str(tmp_path / "static"), dev_cors_origin=None)
    app = create_app(settings, source_factory=lambda cache: SimulatorDataSource(price_cache=cache, update_interval=0.05))
    with TestClient(app) as c:      # context manager → lifespan runs
        yield c
```
(`SimulatorDataSource(price_cache=..., update_interval=...)` matches the constructor [VERIFIED: backend/app/market/simulator.py:222-227]. For "unpriced" cases, inject a fake `MarketDataSource` whose `add_ticker` doesn't write the cache.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@app.on_event("startup")` | `FastAPI(lifespan=...)` | Starlette 1.0 (2026-03) removed the Starlette-level APIs; FastAPI 0.162 marks `on_event` deprecated | lifespan only |
| `tailwind.config.js` + `@tailwind` directives | `@import "tailwindcss"` + `@theme` | Tailwind 4 | no config file |
| `chart.addLineSeries()` | `chart.addSeries(AreaSeries, opts)` | Lightweight Charts 5 | tree-shaken series imports |
| `vite-tsconfig-paths` plugin | `resolve: { tsconfigPaths: true }` | Vite 8 | one less dependency |
| `next export` command | `output: "export"` in `next.config.ts` | Next 14 | `next build` emits `out/` |
| `next lint` | `eslint` (flat config) | Next 16 | `npm run lint` runs `eslint` |

**Deprecated/outdated:** ESLint 9.39.x prints "no longer supported" on install. It's cosmetic for now; ESLint 10 is blocked by a peer conflict in the Next 16.4.3 plugin set (probe). Revisit in a later milestone.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Seeding the default watchlist only when the default user row is newly created is the right reading of PLAN §7 + success criterion 4 | Pitfall 1 | If the user wants defaults restored every boot, removed defaults reappear (current literal PLAN behavior). Confirm before locking |
| A2 | Compose binds `127.0.0.1:8000:8000` (security hardening) rather than literal `8000:8000` | Pattern 13 | Anyone on the LAN can't reach it (intended); if the user wants LAN or tablet access, use `8000:8000` |
| A3 | Browsers keep `CONNECTING` (yellow) on connection-refused during a server stop; red needs a non-200 | Pitfall 6 | UAT may expect red on stop; only affects how criterion 5 is demonstrated |
| A4 | `--wait-timeout` counts only the wait after containers start, not build time | Pattern 13 | A first build could look like a timeout; mitigate with a generous timeout (90s) or by building first, then `up --wait` |
| A5 | App INFO logs need `logging.basicConfig` under uvicorn's default log config | Pattern 2 | Resolved `DB_PATH` and source lifecycle logs invisible; low impact |
| A6 | React remounting a `key`ed span restarts the CSS animation on every new tick | Pattern 9 | Consecutive same-direction ticks might not re-flash; covered by a unit test asserting a new node |
| A7 | Fractional Unix-second times render cleanly at 500ms spacing (typings allow; visual unverified) | Pattern 11 | Odd tick labels; fallback: floor to seconds + same-second replace |
| A8 | Zustand (not PLAN-mandated) is acceptable as the one extra frontend dependency | Standard Stack | If refused, a `useSyncExternalStore` store with the same API replaces it |
| A9 | `frontend/.env.development` is loaded only by `next dev`, never by `next build` | Anti-patterns | If loaded in build, production would call `http://localhost:8000` (cross-origin); verify with a grep of `out/` for `localhost:8000` |

## Open Questions

1. **Seed-once semantics (A1).**
   - What we know: the literal "INSERT OR IGNORE defaults every start" breaks criterion 4; the rowcount-gated seed fixes it and is still idempotent.
   - Recommendation: adopt the gated seed and record it as a decision in the plan. Add a test for "remove a default, restart, still removed".
2. **Port binding (A2).**
   - Recommendation: `127.0.0.1:8000:8000` by default. Mention in the README how to expose it for tablet testing.
3. **uv `exclude-newer` now or in Phase 3?**
   - What we know: FastAPI 0.162.0 and Starlette 1.10.0 are 2–3 days old, so `exclude-newer = "7 days"` would lock slightly older versions (untested combination).
   - Recommendation: lock the verified 0.162.0 / 1.10.0 now; add `exclude-newer` in Phase 3 with LiteLLM. If added now, re-run the 139-test gate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 (fnm) | frontend build/tests | ✓ (active default) | v22.23.4 (also v24.21.0 installed) | — |
| npm | frontend | ✓ | 10.9.9 | — |
| uv | backend | ✓ | 0.13.0 local (image pinned 0.13.5) | — |
| Python | backend local | ✓ | 3.13.16 via uv (3.14.5 pyenv); container 3.12 | add `.python-version` 3.12 (Pitfall 10) |
| Docker Engine | OPS-06/07/08 | ✓ running (linux engine) | 29.8.0 | — |
| Docker Compose | OPS-07/08 (`env_file.required`, `--wait`) | ✓ | v5.5.1 | — |
| Windows PowerShell | `start_windows.ps1` | ✓ | 5.1.26100 (no `pwsh`) | write 5.1-compatible, ASCII-only |
| bash (Git Bash) | lint/run `.sh` locally | ✓ | Git 2.54 bash | real macOS/Linux test is manual |
| Registry access (npm, PyPI, ghcr, Docker Hub) | installs, image pulls | ✓ | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none. `start_mac.sh` can be exercised in Git Bash/WSL, but `open`/`xdg-open` behavior needs a real macOS/Linux check (manual).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Backend framework | pytest 9.x + pytest-asyncio (`asyncio_mode = "auto"`), httpx TestClient |
| Backend config | `backend/pyproject.toml` `[tool.pytest.ini_options]` (exists) |
| Frontend framework | Vitest 5.0.5 + jsdom 30 + Testing Library (Wave 0: install + config) |
| Frontend config | `frontend/vitest.config.mts`, `frontend/vitest.setup.ts` (Wave 0) |
| Quick run (backend) | `cd backend && uv run --extra dev pytest -q -x tests/api tests/test_db.py` |
| Quick run (frontend) | `cd frontend && npx vitest run` |
| Full suite | `cd backend && uv run --extra dev pytest -q && uv run --extra dev ruff check app tests && uv run --extra dev ruff format --check app tests`; `cd frontend && npx vitest run && npm run lint && npx tsc --noEmit && npm run build` |
| Packaging smoke | `docker compose up -d --build --wait --wait-timeout 180 && curl -fsS http://localhost:8000/api/health && curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/api/nope` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OPS-01 | lifespan: schema, source started with tracked set, initial snapshot row exists, task running; shutdown stops source | integration | `pytest tests/test_lifespan.py -x` | ❌ Wave 0 |
| OPS-02 | init idempotent; seed-once (removed default stays removed after re-init); 6 tables | unit | `pytest tests/test_db.py -x` | ❌ Wave 0 |
| OPS-03 | env wins over `.env`; empty `DB_PATH` → default; Settings repr hides secrets | unit | `pytest tests/test_config.py -x` | ❌ Wave 0 |
| OPS-04 | `/api/health` → 200 `{"status":"ok"}` | API | `pytest tests/api/test_system.py -x` | ❌ Wave 0 |
| OPS-05 | GET/POST `/api/nope` → JSON 404; `/` → index.html when present; app works with no static dir | API | `pytest tests/api/test_static.py -x` | ❌ Wave 0 |
| OPS-06 | image builds, runs 1 worker, DB at `/app/db/finally.db` | smoke | packaging smoke + `docker compose logs app \| grep /app/db/finally.db` | manual-assisted |
| OPS-07 | healthcheck healthy; data survives `down`/`up` (add a ticker, down, up, still there) | smoke | `docker compose up -d --wait` then a curl add/down/up/curl check | manual-assisted |
| OPS-08 | scripts idempotent (run twice), build on missing image, never delete the volume | manual | run each script twice; `docker volume inspect finally-data` | manual (both OS families) |
| WL-01 | defaults in order | API | `pytest tests/api/test_watchlist.py::test_defaults -x` | ❌ Wave 0 |
| WL-02 | shape + null prices for an unpriced ticker (fake source) | API | `pytest tests/api/test_watchlist.py -k get -x` | ❌ Wave 0 |
| WL-03 | 201 new (priced in sim) / 200 dup / 400 malformed (not 422) | API | `pytest tests/api/test_watchlist.py -k add -x` | ❌ Wave 0 |
| WL-04 | 204 / 404 `{"error"}`; ticker leaves the source | API | `pytest tests/api/test_watchlist.py -k remove -x` | ❌ Wave 0 |
| WL-05 | 51st → 400; dup at 50 → 200 | API | `pytest tests/api/test_watchlist.py -k cap -x` | ❌ Wave 0 |
| (WL-06 groundwork) | reconcile keeps a held ticker tracked (insert a positions row directly) | unit | `pytest tests/test_tracker.py -x` | ❌ Wave 0 |
| MD-01 | one EventSource; frame replace drops removed tickers | unit | `npx vitest run src/store src/stream` | ❌ Wave 0 |
| MD-02 | Chg % math; `—` when no open | unit | `npx vitest run src/domain` | ❌ Wave 0 |
| MD-03 | flash class on up/down, none on flat, re-triggers on a new timestamp | component | `npx vitest run src/components/watchlist` | ❌ Wave 0 |
| MD-04 | connecting→open→connecting→open; CLOSED → red + backoff 1s/2s/5s (fake timers) | unit | `npx vitest run src/stream` | ❌ Wave 0 |
| MD-05 | sparkline points, cap 300, flat/single-point cases | unit | `npx vitest run src/domain/sparkline` | ❌ Wave 0 |
| MD-06 | history→setData, stale response discarded, `t <= last` dropped (mocked LWC) | component | `npx vitest run src/components/chart` | ❌ Wave 0 |
| MD-07 | selection rules (load / remove selected / empty) | unit | `npx vitest run src/domain/selection` | ❌ Wave 0 |
| UX-01 | palette tokens present; no `#000`/`black` in source | static check | `grep -rniE "#000\b\|#000000\|\bbg-black\b" frontend/src` → no hits | manual-assisted |

### Sampling Rate
- **Per task commit:** the quick command for the touched lane (backend `pytest -q -x <touched tests>` or `npx vitest run <dir>`).
- **Per wave merge:** the full backend suite (including the 139 market tests) plus the full frontend suite, lint, typecheck and `npm run build`.
- **Phase gate:** full suites green, plus the packaging smoke and the manual script checks, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `backend/tests/conftest.py`: `settings(tmp_path)`, `client` fixture (`with TestClient(app)`), fake `MarketDataSource` for unpriced cases
- [ ] `backend/tests/test_config.py`, `test_db.py`, `test_lifespan.py`, `test_tracker.py`, `tests/api/test_watchlist.py`, `test_system.py`, `test_static.py`
- [ ] Frontend: Vitest stack install; `vitest.config.mts`, `vitest.setup.ts`; `src/test/FakeEventSource.ts` (statics `CONNECTING/OPEN/CLOSED`, `emitOpen/emitMessage/emitError(readyState)`); `"test": "vitest run"` script
- [ ] Backend dependency bump gate (139 tests) before any new backend file

## Security Domain

`security_enforcement: true`, ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no login by design, PLAN §2) | Compensate with a loopback-only port bind (A2) |
| V3 Session Management | no | — |
| V4 Access Control | no (single user) | Loopback bind; document that public exposure is unsupported |
| V5 Input Validation | yes | `normalize_ticker()` with `^[A-Z][A-Z0-9.]{0,9}$` on body and path params; Pydantic body models (422 for wrong types); 50-ticker cap |
| V6 Cryptography | no | — (UUID4 ids via `uuid.uuid4()` are not security tokens) |
| V7 Error Handling & Logging | yes | `{"error": msg}` envelopes, no stack traces to clients (FastAPI default 500 body), `%s` logging, never log env or key values, `repr=False` on secret settings |
| V12 Files & Resources | yes | `StaticFiles` (normalizes paths and stays within its directory); no user file uploads |
| V14 Configuration | yes | `.env` gitignored and dockerignored; CORS only when `DEV_CORS_ORIGIN` is set; single worker; pinned base images and uv; lockfiles with hashes |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via ticker | Tampering | Parameterized `?` placeholders only, plus the regex allowlist |
| Ticker flood (simulator O(n²) rebuild on the event loop) | DoS | 50-ticker cap enforced server-side inside the lock |
| LAN user editing the watchlist (no auth) | Elevation / Tampering | `127.0.0.1` bind (A2) |
| XSS via ticker text | Tampering | React escapes text; ticker regex blocks markup characters |
| Secrets in logs or the image | Info disclosure | dotenv `override=False`; no env dumps; `.env` dockerignored |
| Dev CORS leaking to prod | Info disclosure | `CORSMiddleware` only when `DEV_CORS_ORIGIN` is set; the Dockerfile never sets it (test: absent env → no `access-control-allow-origin` header) |
| Supply chain (fresh releases) | Tampering | Exact pins via lockfiles; legitimacy audit above; `@tailwindcss/turbopack` avoided |

## Sources

### Primary (HIGH confidence)
- Repository files read this session: `backend/app/market/{stream,cache,factory,models,simulator,interface,__init__}.py`, `backend/pyproject.toml`, `backend/CLAUDE.md`, `.env.example`, `.dockerignore`, `.gitattributes`, `.gitignore`, `.planning/*` (CONTEXT, REQUIREMENTS, STATE, ROADMAP, research/*, codebase/CONCERNS).
- Positive probes (scratchpad): FastAPI 0.162.0 / Starlette 1.10.0 / uvicorn 0.54.0, 139 market tests passed; JSON 404 + StaticFiles behavior; create-next-app 16.4.3 scaffold; static export build (local + `node:22-slim` `npm ci`); Vitest 5 + jsdom 30 + RTL; ESLint 9 vs 10; react-hooks lint rule; sqlite seed-once; PowerShell 5.1 args; `docker compose config`; `docker manifest inspect` of the three base images.
- `lightweight-charts@5.2.1` tarball: `dist/typings.d.ts`, `dist/lightweight-charts.development.mjs`.
- npm registry and PyPI JSON (versions, upload times, engines, repos, postinstall).

### Secondary (MEDIUM confidence)
- Context7 `/tradingview/lightweight-charts/v5.2.1` (AreaSeries, createPriceLine, timezone formatter rules).
- Context7 `/vercel/next.js/v16.2.9` (static export, `NEXT_PUBLIC_` inlining rules).
- Context7 `/tailwindlabs/tailwindcss.com` (`@theme`).
- Prior project research `.planning/research/{STACK,ARCHITECTURE,PITFALLS,FEATURES}.md` (2026-10-23).

### Tertiary (LOW confidence)
- Per-browser `EventSource` behavior on connection refused (A3); Compose `--wait-timeout` scope (A4).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Every version was read from the registry today, and the critical combinations were installed and run.
- Architecture: HIGH (backend; mount order, JSON 404 and lifespan probe-verified) / MEDIUM-HIGH (frontend; patterns cross-checked against package typings and lint behavior).
- Pitfalls: HIGH for the ones reproduced (seed re-insert, Starlette lock, scaffold defaults, lint rule); MEDIUM for browser- and compose-timing behavior.

**Research date:** 2026-10-26
**Valid until:** 2026-11-09 (fast-moving: FastAPI/Starlette and Next ship weekly; re-check versions if planning slips more than 2 weeks)
