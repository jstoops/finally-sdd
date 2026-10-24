# Stack Research

**Domain:** Single-container AI trading workstation. FastAPI + SSE + SQLite backend, Next.js static-export frontend, LiteLLM → OpenRouter (Cerebras) chat with structured output.
**Researched:** 2026-10-23
**Confidence:** HIGH for versions (read directly from npm/PyPI registry metadata and the create-next-app 16.4.3 template); MEDIUM for configuration guidance (official docs cross-checked against registry data); LOW only where noted.

> **Scope.** PLAN.md fixes the stack. This file pins versions, sets configuration, and lists what NOT to use. The market subsystem (`backend/app/market/`) is not re-researched.

> **Confidence method.** Version numbers come from `npm view` and the PyPI JSON API, which are primary sources. The GSD `classify-confidence` seam rates `webfetch`/`websearch` as LOW, or MEDIUM when verified. Doc-derived claims below are therefore MEDIUM unless a registry artifact (peer deps, engines, template files) confirms them. In that case they are HIGH.

---

## Decided Items and Plan Guardrails

| Item | Status | Detail | Confidence |
|---|---|---|---|
| **Node.js runtime = Node 22 LTS** for the frontend Docker build stage **and** local dev | **DECIDED** (user decision, recorded in PLAN.md §11 "Stage 1: Node 22 slim") | Use `node:22-slim` (currently 22.23.4, published 2026-10-21), `@types/node ^22`, `"engines": { "node": "^22.22.0" }` and an `.nvmrc` containing `22`. Node 22 meets every engine floor in the stack: Vitest 5 needs `^22.12`, jsdom 30 needs `^22.22.2`, jest-dom 7 needs `>=22`, Vite 8 needs `>=22.12`, ESLint needs `^22.13`, and Next 16 needs `>=20.9`. The `^22.22.0` engines floor is set by jsdom 30. Node 22 is in maintenance LTS until **2027-04-30**, so a future milestone should plan the move to 24/26. Node 20 (end of life since 2026-04-30) is ruled out because Vitest 5, jsdom 30 and jest-dom 7 will not install on it. **Local dev note:** the developer machine currently runs Node v24.21.0. Install Node 22 alongside it (nvm-windows, fnm or Volta) and select it via `.nvmrc`. | HIGH |
| Startup via `lifespan` only (PLAN §3, already correct) | Guardrail for the planner | **Never** use `@app.on_event`. Starlette 1.0 (2026-03-22) **removed** `on_startup`/`on_shutdown`, `on_event()` and `add_event_handler()`. Agents trained on older FastAPI examples will reach for `@app.on_event("startup")`, so plans should state "lifespan only" explicitly. | HIGH |

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended | Conf. |
|---|---|---|---|---|
| Python | **3.12** (`python:3.12-slim`, now Debian trixie-based) | Backend runtime | Fixed by PLAN. `requires-python >=3.12` is already set. 3.12 receives security fixes until 2028-10. LiteLLM supports `<3.15`. | HIGH |
| uv | **0.13.5** (pin the image `ghcr.io/astral-sh/uv:0.13.5`) | Python project and lock manager | Already in use (`uv.lock` rev 5). Pin the exact tag in the Dockerfile, because floating `:latest` breaks reproducibility. Local uv 0.13.0 is compatible. | HIGH |
| FastAPI | **0.162.0** (raise the floor to `>=0.135`) | HTTP API, lifespan, static serving | Currently locked at 0.128.7 with Starlette 0.52.1. Bump to current in the foundation phase, then re-run the 139 market tests. The existing code uses only `APIRouter` and `StreamingResponse`, which Starlette 1.x keeps. Moving to current FastAPI also puts the app on Starlette 1.x, so lifespan-only startup is enforced by the framework, not just convention. | MEDIUM |
| Starlette | **1.9.0** (transitive) | ASGI toolkit | Comes with FastAPI. 1.0 removed the decorator-style event, route and middleware APIs (see above). | HIGH |
| Uvicorn | **0.54.0** (`uvicorn[standard]`) | ASGI server | Already declared. Run exactly **one worker** because `PriceCache` is process-local. Do not use `--reload` in the container. | HIGH |
| stdlib `sqlite3` | ships with CPython 3.12 (SQLite 3.46+ on trixie) | Persistence | Fixed by PLAN. Supports `INSERT OR IGNORE`, UPSERT and `RETURNING`. No ORM. | HIGH |
| LiteLLM | **1.106.2** (declare `litellm>=1.106,<2`; the exact version is locked by `uv.lock` with hashes) | LLM client → OpenRouter → Cerebras | Required by the project's `cerebras-inference` skill. It accepts a Pydantic class as `response_format`. See the supply-chain note under What NOT to Use. | HIGH (version) / MEDIUM (config) |
| Pydantic | **2.14.1** (declare `pydantic>=2.11`) | Structured-output schema, request models | The skill says to `uv add litellm pydantic`. FastAPI already depends on it, but declare it explicitly because the code imports it directly. | HIGH |
| Node.js | **22 LTS** (`node:22-slim`, 22.23.4; engines `^22.22.0`) | Frontend build, local dev and test runtime | **Decided** (PLAN §11). This is the lowest Node line that runs the whole current toolchain. See Decided Items. | HIGH |
| Next.js | **16.4.3** | Frontend framework, static export | Current stable. Turbopack is the default for `next build`, and `next lint` is removed. Requires Node `>=20.9`. | HIGH |
| React / React DOM | **19.3.1** (`^19`) | UI | Next 16 peer range is `^18.2 \|\| ^19`. The App Router uses React 19.2+ features. | HIGH |
| TypeScript | **5.9.3** (pin `~5.9.3`, **not** `latest`) | Types | `npm i typescript` now installs **7.0.2**, which has no classic compiler API: its root export is only `lib/version.cjs`, and the API lives under `./unstable/*`. typescript-eslint 8.72 peers on `typescript <6.1.0`. create-next-app 16.4.3 itself writes `typescript: "^5"`. | HIGH |
| Tailwind CSS | **4.3.3** with `@tailwindcss/postcss` **4.3.3** | Styling, dark theme | This is what create-next-app 16 scaffolds. Configuration is CSS-first (`@import "tailwindcss"` plus `@theme` in `globals.css`), so there is **no `tailwind.config.js`**. | HIGH |
| Lightweight Charts | **5.2.1** | Main price chart and P&L chart | Fixed by PLAN. v5 changed the series API (see Configuration). The package is ESM-only (`"type": "module"`, import-only exports) and its only dependency is `fancy-canvas`. | HIGH |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Conf. |
|---|---|---|---|---|
| python-dotenv | **1.2.4** | Loads `../.env` in local dev | Call `load_dotenv(ROOT / ".env", override=False)` once in app startup, so real environment variables win (PLAN §5). LiteLLM already pulls it in transitively, but declare it because the app imports it. | HIGH |
| zustand | **5.0.16** (`^5`) | Client store for live prices, positions and connection state | This is the one frontend dependency PLAN doesn't mandate. All tickers update every 500ms, and plain React Context would re-render every consumer on each tick. Selector subscriptions such as `usePrice("AAPL")` keep re-renders local to the row that changed. A hand-rolled `useSyncExternalStore` store is an acceptable zero-dependency alternative. | MEDIUM |
| eslint + eslint-config-next | **9.39.x** + **16.4.3** | Linting (flat config, `eslint.config.mjs`) | Keep what create-next-app writes (`eslint ^9`). ESLint 10 also works with `eslint-config-next >=16.4.0`, but brings no benefit here. | HIGH |
| @types/node | **^22** (22.20.5) | Node types | Match the decided Node 22 runtime. The template writes `^20`, so bump it. Vitest 5 peers on `@types/node ^22 \|\| >=24`. | HIGH |
| @types/react, @types/react-dom | **^19** (19.3.0) | React types | Template default. | HIGH |

### Development Tools

| Tool | Version | Purpose | Notes | Conf. |
|---|---|---|---|---|
| pytest | 9.1.1 (locked 9.0.2) | Backend unit and API tests | Already configured. Run `TestClient` as `with TestClient(app) as c:` so lifespan runs. Without the context manager, startup never executes. | HIGH |
| pytest-asyncio | 1.4.0 (locked 1.3.0) | Async tests | In 1.x the `event_loop` fixture is removed. `asyncio_mode = "auto"` is already set. | MEDIUM |
| httpx | 0.28.1 | `TestClient` transport | Already in dev extras. | HIGH |
| Ruff | 0.17.2 (locked 0.15.0) | Lint and format | Existing config. Fine to bump. | HIGH |
| Vitest | **5.0.5** | Frontend unit tests | Use with `environment: 'jsdom'`. **`vite` is only a peer of Vitest 5**, so install `vite` explicitly. Vitest 5 clears mocks before each test by default and fails on unawaited async assertions. Both defaults help with agent-written tests. **Fallback:** if any v5 friction appears, pin `vitest@^4.1.12`; the API used here is identical. | MEDIUM |
| vite | **8.3.5** | Peer of Vitest and plugin-react | Required by `@vitejs/plugin-react` 6 (`vite ^8`). | HIGH |
| @vitejs/plugin-react | **6.1.2** | JSX transform for tests | | HIGH |
| vite-tsconfig-paths | **6.1.1** | Resolves the `@/*` alias in tests | As in the Next.js Vitest guide. | HIGH |
| jsdom | **30.1.3** | DOM environment | Requires Node `^22.22.2`, which is why the engines floor is `^22.22.0`; `node:22-slim` 22.23.4 qualifies. Has **no `EventSource`, no canvas and no `ResizeObserver`**, so stub all three in `vitest.setup.ts`. | HIGH |
| @testing-library/react | **16.3.3** | Component tests | Requires `@testing-library/dom` as a separate peer. | HIGH |
| @testing-library/dom | **10.4.2** | RTL peer | | HIGH |
| @testing-library/jest-dom | **7.0.1** | `toBeInTheDocument`, etc. | Import `@testing-library/jest-dom/vitest` in the setup file. Requires Node `>=22`. | HIGH |
| @testing-library/user-event | **14.6.8** | Realistic typing and clicks | Trade bar and chat input tests. | HIGH |
| @playwright/test | **1.64.1** | E2E tests | **Must exactly match** the browser image tag `mcr.microsoft.com/playwright:v1.64.1-noble`. A version mismatch causes "Executable doesn't exist" failures. | HIGH |

---

## Installation

```bash
# ---------- backend (from backend/) ----------
uv add "fastapi>=0.135" "litellm>=1.106,<2" "pydantic>=2.11" "python-dotenv>=1.2"
uv lock --upgrade-package fastapi --upgrade-package starlette --upgrade-package uvicorn
uv run --extra dev pytest -q          # confirm the 139 market tests still pass after the bump

# ---------- frontend (from repo root) ----------
npx create-next-app@16.4.3 frontend --ts --tailwind --eslint --app --no-src-dir \
    --import-alias "@/*" --use-npm
cd frontend
npm install lightweight-charts@^5.2.1 zustand@^5
npm install -D typescript@~5.9.3 @types/node@^22
# package.json: "engines": { "node": "^22.22.0" }   and   echo 22 > .nvmrc
npm install -D vitest@^5.0.5 vite@^8 @vitejs/plugin-react@^6 vite-tsconfig-paths@^6 \
    jsdom@^30 @testing-library/react@^16.3 @testing-library/dom@^10 \
    @testing-library/jest-dom@^7 @testing-library/user-event@^14

# ---------- E2E (test/) ----------
npm install -D @playwright/test@1.64.1   # exact pin; match the Docker image tag
```

---

## Configuration That Matters

### Backend

**`pyproject.toml` additions**
```toml
[tool.uv]
# Supply-chain cooldown: never resolve a release younger than 7 days.
# This would have blocked the March 2026 LiteLLM compromise, which was live for about 4.5 hours.
exclude-newer = "7 days"
```
uv accepts friendly durations here (MEDIUM: uv settings reference). The setting only matters when re-locking. Installs still use `uv.lock` with hashes.

**FastAPI app skeleton rules (HIGH)**
- `app = FastAPI(lifespan=lifespan)`. Do all initialization inside `lifespan`: schema and seed, market source start, initial snapshot, snapshot task. On shutdown, cancel the snapshot task and stop the source.
- Include every `/api` router **before** `app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")`. A mount at `/` swallows any route registered after it.
- Guard the static mount with `if STATIC_DIR.is_dir()` so local dev and pytest work without a frontend build.
- Return `{"error": ...}` bodies by raising a small custom exception handled through `exception_handlers=`, or by returning `JSONResponse(status_code=400, content={"error": msg})`. FastAPI's default `HTTPException` produces `{"detail": ...}`, which violates PLAN §8.

**Uvicorn command (MEDIUM)**
```dockerfile
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--timeout-graceful-shutdown", "5"]
```
Use exec form so SIGTERM reaches uvicorn. `--timeout-graceful-shutdown` stops long-lived SSE connections from holding `docker compose down` until the 10s SIGKILL.

**sqlite3 (MEDIUM)**
- Write timestamps yourself as ISO 8601 UTC strings: `datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")`. Do **not** use `detect_types` or the default datetime adapters, which are deprecated since Python 3.12.
- Per connection, run `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000` and `PRAGMA foreign_keys=ON`.
- Use one connection per request or unit of work (sync routes run in FastAPI's threadpool), or a single connection opened with `check_same_thread=False` and guarded by a lock. Do not share a cursor across threads.
- Use explicit `BEGIN IMMEDIATE` for trade and reset transactions so the read-check-write on cash and positions is atomic.

**LiteLLM → OpenRouter → Cerebras (MEDIUM, confirmed against the live OpenRouter endpoint API)**

The Cerebras endpoint for `openai/gpt-oss-120b` supports `response_format`, `structured_outputs` and `reasoning_effort`. It has a 131,072-token context and a maximum of 40,960 completion tokens. Several other providers of the same model do **not** support structured outputs: Venice, Novita, SambaNova, DigitalOcean and Amazon Bedrock. OpenRouter's default `allow_fallbacks: true` could route to one of them during a Cerebras outage. Extend the skill's `EXTRA_BODY` with `require_parameters`:

```python
from litellm import acompletion   # async variant; the skill shows sync `completion`

MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"], "require_parameters": True}}

response = await acompletion(
    model=MODEL,
    messages=messages,
    response_format=ChatResponse,      # Pydantic class
    reasoning_effort="low",
    extra_body=EXTRA_BODY,
    timeout=30,
)
parsed = ChatResponse.model_validate_json(response.choices[0].message.content)
```
- **Use `acompletion`, not `completion`.** The sync call inside an `async def` route blocks the event loop, which freezes the SSE stream and the snapshot task for 1–3s per chat. Alternatively, make the route sync so FastAPI runs it in the threadpool.
- **Schema shape for strict structured outputs:** make every field required and use no defaults (`trades: list[TradeAction]`, `watchlist_changes: list[WatchlistAction]`), and tell the prompt to return `[]` when there are none. Use `Literal["buy","sell"]` and `Literal["add","remove"]` with `model_config = ConfigDict(extra="forbid")`. Keep numeric and regex validation **out of the schema**: provider support for `minimum` and `pattern` varies, and the backend's Trade Rules validate anyway. Treat a `model_validate_json` failure as a `502`.
- **Set `LITELLM_LOCAL_MODEL_COST_MAP=True`** in the Dockerfile and the test environment. Otherwise LiteLLM fetches its model cost map from GitHub on import, with a 5s timeout. That adds startup latency and fails noisily when offline or under E2E (MEDIUM).
- **Import LiteLLM lazily or once at startup.** It is a heavy package: its hard dependencies include `boto3`, `tokenizers`, `huggingface-hub` and `aiohttp`. Expect it to add roughly 150–250 MB to the image (LOW: estimate, not measured).
- **`LLM_MOCK=true` must short-circuit before any LiteLLM import or call**, so E2E needs no key and no network.

### Frontend

**`next.config.ts` (HIGH)**
```ts
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  output: isDev ? undefined : "export",   // emits frontend/out/
  images: { unoptimized: true },           // default image loader is unsupported in export
  trailingSlash: false,                    // StaticFiles(html=True) serves out/index.html at /
  // Dev only: proxy /api to FastAPI. Rewrites are unsupported with output:'export',
  // so they must not be present in the production build.
  ...(isDev && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: "http://localhost:8000/api/:path*" }];
    },
  }),
};
export default nextConfig;
```
- The Dockerfile copies `frontend/out/` to the backend's `static/` directory.
- The app is a single route (`app/page.tsx`) that renders a `"use client"` dashboard. All data comes from client-side `fetch` and `EventSource` in effects.
- SSE through the Next dev rewrite proxy normally works. If the dev server buffers the stream, point `EventSource` straight at `http://localhost:8000` in dev only (MEDIUM).

**Tailwind v4 theme (HIGH: matches the template's `globals.css` shape)**
```css
@import "tailwindcss";

@theme {
  --color-bg: #0d1117;
  --color-panel: #1a1a2e;
  --color-accent: #ecad0a;
  --color-primary: #209dd7;
  --color-submit: #753991;
  --color-up: #22c55e;
  --color-down: #ef4444;
}
```
This generates utilities such as `bg-panel`, `text-accent` and `bg-submit`. Remove the template's `prefers-color-scheme` block, because the app is always dark.

**Lightweight Charts v5 API (HIGH: official v4→v5 migration guide)**
```ts
import { createChart, LineSeries, AreaSeries, type UTCTimestamp } from "lightweight-charts";

const chart = createChart(el, { autoSize: true, layout: { background: { color: "#0d1117" }, textColor: "#8b949e" } });
const series = chart.addSeries(LineSeries, { color: "#209dd7", lineWidth: 2 });   // NOT chart.addLineSeries()
series.setData(points.map(p => ({ time: Math.floor(p.timestamp) as UTCTimestamp, value: p.price })));
series.update({ time: Math.floor(t) as UTCTimestamp, value: price });  // same time → replaces the last point
// cleanup: chart.remove() in the effect's teardown
```
- `UTCTimestamp` is in **seconds**. SSE and history already send Unix seconds, so do not multiply by 1000. P&L snapshots are ISO strings, so convert them with `Date.parse(s) / 1000`.
- `update()` requires `time >=` the last point's time. Ticks arrive every 500ms, so **floor to whole seconds** and let a same-second update replace the last point. Also deduplicate and sort history before calling `setData` (MEDIUM: fractional timestamps are undocumented, so integer seconds are the safe choice).
- Markers use `createSeriesMarkers(series, [...])`, and the watermark uses `createTextWatermark(chart.panes()[0], …)`. The v4 `series.setMarkers` and the `watermark` option no longer exist.
- Create charts only inside `useEffect`. The library touches the DOM and canvas, and Next prerenders client components at build time.

**Vitest config (HIGH: Next.js Vitest guide, updated for current majors)**
```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: false },
});
```
In `vitest.setup.ts`, import `@testing-library/jest-dom/vitest`, install a controllable `MockEventSource` on `globalThis` (to drive connection-status and flash tests), stub `ResizeObserver`, and `vi.mock("lightweight-charts")`, because jsdom has no canvas.

### Docker

**Dockerfile shape (MEDIUM: uv Docker guide plus PLAN §11)**
```dockerfile
# ---- Stage 1: frontend ----
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build                      # → /frontend/out

# ---- Stage 2: backend ----
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.5 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_DEV=1 UV_PYTHON_DOWNLOADS=0 \
    LITELLM_LOCAL_MODEL_COST_MAP=True DB_PATH=/app/db/finally.db \
    PATH="/app/.venv/bin:$PATH"
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project
COPY backend/ ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked
COPY --from=frontend /frontend/out ./static
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-graceful-shutdown", "5"]
```
- Add a `.dockerignore` covering `**/node_modules`, `**/.next`, `frontend/out`, `backend/.venv`, `**/__pycache__`, `db/*.db`, `.env` and `.git`. Copying a Windows `.venv` or `node_modules` into a Linux image breaks the build.
- The slim images have no `curl`. Write the compose healthcheck as `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"`.
- `RUN --mount` requires BuildKit, which is the default in Docker 23+ (the developer runs 29.8).

**E2E (`test/docker-compose.test.yml`) (HIGH for the versions, MEDIUM for the shape)**
- `app`: builds `..` (the root Dockerfile) with `LLM_MOCK=true` and no `env_file`, so no keys are needed. Use a `tmpfs` or throwaway volume at `/app/db` and the Python healthcheck above.
- `playwright`: `image: mcr.microsoft.com/playwright:v1.64.1-noble`, `depends_on: { app: { condition: service_healthy } }`, `BASE_URL=http://app:8000`, `ipc: host`, `working_dir` mounted to `test/`, then run `npx playwright test`.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Node 22 LTS (decided) | Node 24 LTS (until 2028-04-30) | The natural upgrade before Node 22 reaches end of life on 2027-04-30. Every pinned package already supports it. Plan it for a later milestone; it is not in scope now. |
| Node 22 LTS (decided) | Node 26 (Active LTS from 2026-10-28) | Only once it has several months of patch releases. |
| TypeScript 5.9 | TypeScript 6.0.3 | Works with typescript-eslint (`<6.1.0`), but adds deprecation churn and gives Next 16 nothing. Don't. |
| Vitest 5.0 | Vitest 4.1.12 | If any Vitest 5 incompatibility appears. The config and test APIs used here are the same. |
| Vitest | Jest 30 + `next/jest` | Only if the team insists on Jest. Vitest has native ESM (lightweight-charts is ESM-only) and is what Next's docs show first. |
| zustand | `useSyncExternalStore` hand-rolled store | If you want zero non-mandated dependencies. It takes about 30 lines and works the same way. |
| zustand | React Context + `useReducer` | Never for live prices: every 500ms tick re-renders every consumer. It is fine for rarely changing state such as the chat panel's open/closed flag. |
| Existing `StreamingResponse` SSE | FastAPI native `fastapi.sse.EventSourceResponse` (added in 0.135.0) | Only in a future refactor. The existing SSE router is complete and tested, and PLAN says not to rewrite the market subsystem. |
| `litellm.acompletion` | `openai` SDK pointed at OpenRouter | Lighter image, but it violates the project's mandated `cerebras-inference` skill. Don't. |
| Plain `fetch` | SWR / TanStack Query | Not needed. There are six endpoints, and PLAN §10 spells out the refetch rules (after chat actions, after reset). A cache layer adds staleness questions without solving a problem. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|---|---|---|
| `node:20-slim` / Node 20 locally | End of life since 2026-04-30. Vitest 5, jsdom 30 and jest-dom 7 refuse to install. | `node:22-slim` / Node 22 (decided) |
| Node 22 older than 22.22 (for example a stale local install) | jsdom 30 requires `^22.22.2`. | Node ≥ 22.22, enforced by `engines` + `.nvmrc` |
| `npm i typescript` (latest = 7.0.2) | TS 7 (native port) exposes no classic compiler API. Next's type-check step and typescript-eslint (`typescript <6.1.0`) need it. | `typescript@~5.9.3` |
| `@app.on_event("startup")`, `on_startup=[…]`, `@app.middleware`, `@app.exception_handler` on a raw Starlette app | Removed in Starlette 1.0. | `lifespan=`, `middleware=[…]`, `exception_handlers={…}` |
| `HTTPException(status_code=400, detail=…)` for business errors | Produces `{"detail": …}`, but PLAN §8 requires `{"error": …}`. | A custom exception and handler, or a direct `JSONResponse` |
| Sync `litellm.completion` inside `async def` | Blocks the event loop and freezes SSE for 1–3s per chat. | `await litellm.acompletion(...)` |
| `provider: {"order": ["cerebras"]}` alone | Fallback can route to providers that ignore `response_format`, which produces unparseable output and a 502. | Add `"require_parameters": True` |
| LiteLLM **1.82.7 / 1.82.8** | Malicious releases from the TeamPCP supply-chain attack (2026-03-24) that ran a `.pth` payload on interpreter start. Both are removed from PyPI, but a cached wheel or mirror could still serve them. | `>=1.106` locked with hashes, plus uv `exclude-newer = "7 days"` |
| `uvicorn --workers N>1` or gunicorn multi-worker | `PriceCache`, the market source and the snapshot task are per-process, so prices and SSE would diverge between workers. | `--workers 1` |
| `uvicorn --reload` in Docker | Restarts on file changes and double-starts background tasks. | Use it only for local dev. |
| `chart.addLineSeries()`, `series.setMarkers()`, the `watermark` chart option | Lightweight Charts v4 APIs, removed in v5. | `chart.addSeries(LineSeries, …)`, `createSeriesMarkers`, `createTextWatermark` |
| Millisecond timestamps in charts | `UTCTimestamp` is in seconds, so ms values plot dates around the year 57,000. | Use SSE and history seconds as-is; convert ISO with `/1000`. |
| Next.js features incompatible with `output: 'export'` | Fail at `next dev` or `next build`: **Server Actions, Route Handlers that read Request, `cookies()`/`headers()`, rewrites, redirects, `headers` config, `proxy.ts` (formerly middleware), ISR, dynamic routes without `generateStaticParams`, intercepting routes, draft mode, and `next/image` with the default loader** | Client components with `fetch` and `EventSource`, a single static route, and `images.unoptimized: true` |
| `next lint` / `eslint` key in `next.config` | Removed in Next 16. | `eslint .` via the flat `eslint.config.mjs` |
| `tailwind.config.js` + `@tailwind base/components/utilities` | Tailwind v3 setup, which agents still default to | Tailwind v4: `@import "tailwindcss"` plus `@theme` in CSS |
| `next/font/google` | Downloads fonts over the network during `next build`, which is a needless build-time network dependency in Docker. | A system monospace/sans stack, or `next/font/local` |
| Other chart libraries (Recharts, Chart.js, D3, ECharts) | Prohibited by PLAN §10. | Lightweight Charts, an SVG polyline for sparklines, and an in-house treemap |
| SQLAlchemy / any ORM, aiosqlite | PLAN mandates stdlib `sqlite3`. aiosqlite only moves work to a thread, which FastAPI's threadpool already does for sync routes. | stdlib `sqlite3` |
| `detect_types=PARSE_DECLTYPES` / default datetime adapters | Deprecated in 3.12, and they produce non-ISO formats. | Explicit ISO-8601 UTC strings |
| `@playwright/test` version ≠ Docker image tag | The browser binaries won't be found. | Pin both to `1.64.1` |

---

## Stack Patterns by Variant

**Local dev (two processes):**
- Backend: `cd backend && uv run uvicorn app.main:app --reload --port 8000`. dotenv loads `../.env`, and `DB_PATH` defaults to `<repo>/db/finally.db`.
- Frontend: `cd frontend && npm run dev`, on :3000 with the dev-only `/api` rewrite to :8000.
- Why: hot reload on both sides without needing CORS.

**Docker / E2E (one process):**
- `next build` emits `out/`, which is copied to `/app/static`, and FastAPI serves it with `StaticFiles(html=True)` mounted after the API routers.
- Why: PLAN's single-origin, single-port contract.

**`LLM_MOCK=true` (E2E/CI):**
- The mock branch returns a `ChatResponse` instance before any LiteLLM call and goes through the same execute, append-notes and store path.
- Why: deterministic tests with no API key or network.

---

## Version Compatibility

| Package A | Compatible With | Notes |
|---|---|---|
| next@16.4.3 | react/react-dom `^18.2 \|\| ^19`, Node `>=20.9`, TS `>=5.1` | Turbopack is the default for build. A custom `webpack` key fails the build. |
| typescript@5.9.3 | next 16, typescript-eslint 8.72 (`<6.1.0`) | TS 7.x is incompatible with both toolchains' API use. |
| eslint-config-next@16.4.3 | eslint `>=9` (10 supported from 16.4.0) | Flat config only. |
| @tailwindcss/postcss@4.3.3 | tailwindcss **exactly** 4.3.3, postcss `^8.5.16` | Keep the two Tailwind packages on the same version. |
| vitest@5.0.5 | vite `^6.4 \|\| ^7 \|\| ^8` (peer, install it), Node `^22.12 \|\| ^24 \|\| >=26` | |
| @vitejs/plugin-react@6.1.2 | vite `^8` only | If stuck on vite 7, use plugin-react 5.2. |
| jsdom@30.1.3 | Node `^22.22.2 \|\| ^24.15 \|\| >=26` | `node:22-slim` (22.23.4) qualifies. A local Node 22 must be ≥ 22.22.2. |
| node:22-slim | next 16, vite 8, vitest 5, eslint 9/10, jest-dom 7 | All engine floors are satisfied. Node 22 reaches end of life on 2027-04-30. |
| @testing-library/react@16.3.3 | react 18/19, `@testing-library/dom ^10` | |
| @testing-library/jest-dom@7.0.1 | vitest `>=0.32`, dom `>=10 <11`, Node `>=22` | |
| @playwright/test@1.64.1 | `mcr.microsoft.com/playwright:v1.64.1-noble` | Exact match required. `next` lists `@playwright/test ^1.51.1` as an optional peer. |
| fastapi@0.162.0 | starlette `>=0.46` (resolves to 1.9.0), pydantic `>=2.9` | Starlette 1.x API removals apply. |
| litellm@1.106.2 | Python `>=3.10,<3.15`, pydantic `>=2.11`, openai `>=2.20,<3` | Pulls python-dotenv, boto3, tokenizers and aiohttp. |
| python:3.12-slim | uv 0.13.5 (`UV_PYTHON_DOWNLOADS=0` uses the system Python) | The image is now Debian trixie. Use `3.12-slim-bookworm` only if something needs bookworm. |

---

## Sources

- npm registry (`npm view`, 2026-10-23): next, react, react-dom, typescript (dist-tags, 7.0.2 exports), tailwindcss, @tailwindcss/postcss, lightweight-charts (exports, release times), vitest (engines, peers, dist-tags), vite, @vitejs/plugin-react, jsdom, @testing-library/*, @playwright/test, eslint, eslint-config-next, typescript-eslint, zustand, vite-tsconfig-paths. Primary source, **HIGH**.
- create-next-app@16.4.3 tarball (`npm pack`): template `devDependencies` (`typescript ^5`, `eslint ^9`, `tailwindcss ^4`, `@types/node ^20`), `postcss.config.mjs`, `globals.css`, `eslint.config.mjs`, `tsconfig.json`. Primary source, **HIGH**.
- PyPI JSON API (2026-10-23): litellm 1.106.2 (requires_dist; 1.82.7/1.82.8 absent), fastapi 0.162.0, starlette 1.9.0, uvicorn 0.54.0, pydantic 2.14.1, python-dotenv 1.2.4, pytest 9.1.1, pytest-asyncio 1.4.0, ruff 0.17.2, uv 0.13.5. Primary source, **HIGH**.
- nodejs/Release `schedule.json`: Node 20 EOL 2026-04-30, Node 22 maintenance LTS until 2027-04-30, Node 24 LTS until 2028-04-30, Node 26 LTS from 2026-10-28. nodejs.org `dist/index.json`: latest Node 22 is v22.23.4 (2026-10-20). Docker Hub: `node:22-slim` = 22.23.4, updated 2026-10-21. **HIGH**.
- Node 22 runtime: **user decision** relayed by the orchestrator and confirmed in `planning/PLAN.md` §11 ("Stage 1: Node 22 slim").
- OpenRouter API `GET /api/v1/models/openai/gpt-oss-120b/endpoints`: Cerebras supported_parameters include `response_format`, `structured_outputs`, `reasoning_effort`; per-provider structured-output support. **HIGH**.
- OpenRouter docs, provider selection (`require_parameters`, `allow_fallbacks` defaults): https://openrouter.ai/docs/guides/routing/provider-selection. **MEDIUM**.
- LiteLLM `model_prices_and_context_window.json` (GitHub main): `cerebras/gpt-oss-120b` `supports_response_schema: true`. **MEDIUM**.
- LiteLLM JSON mode docs (Pydantic `response_format`): https://docs.litellm.ai/docs/completion/json_mode. **MEDIUM**.
- LiteLLM custom cost map / `LITELLM_LOCAL_MODEL_COST_MAP`: https://docs.litellm.ai/docs/proxy/custom_model_cost_map. **MEDIUM**.
- LiteLLM supply-chain compromise: [BleepingComputer](https://bleepingcomputer.com/news/security/popular-litellm-pypi-package-compromised-in-teampcp-supply-chain-attack), [LWN](https://lwn.net/Articles/1064762/), [NetSPI](https://www.netspi.com/blog/executive-blog/ai-ml-pentesting/litellm-supply-chain-compromise/). **MEDIUM**: multiple sources agree, and the PyPI release list confirms the versions are gone.
- Next.js docs: Static Exports (lastUpdated 2026-08-09) https://nextjs.org/docs/app/guides/static-exports; Upgrading to v16 (lastUpdated 2026-10-15) https://nextjs.org/docs/app/guides/upgrading/version-16; Vitest guide (lastUpdated 2026-08-25) https://nextjs.org/docs/app/guides/testing/vitest. **MEDIUM-HIGH**.
- Lightweight Charts docs: v4→v5 migration https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5; `UTCTimestamp`; `ISeriesApi.update`. **MEDIUM**.
- Starlette release notes (GitHub `docs/release-notes.md`): 1.0.0 released 2026-03-22; removals listed in 1.0.0rc1. **HIGH**.
- FastAPI SSE docs (`fastapi.sse.EventSourceResponse`, added in 0.135.0): https://fastapi.tiangolo.com/tutorial/server-sent-events/. **MEDIUM**.
- uv Docker integration guide: https://docs.astral.sh/uv/guides/integration/docker/; uv settings reference (`exclude-newer` durations): https://docs.astral.sh/uv/reference/settings/. **MEDIUM**.
- Vitest 5 breaking changes: third-party summaries only ([OpenReplay](https://blog.openreplay.com/vitest-5-changes/), [releases.sh digest](https://releases.sh/collections/js-toolchain/digest/2026-08-31)). **LOW** for the specific behavior changes. Engines and peers are confirmed from the registry (HIGH).
- MCR tag list `mcr.microsoft.com/v2/playwright/tags/list`: `v1.64.1-noble` exists. Docker Hub: `python:3.12-slim` and `node:22-slim` updated 2026-10-21/22. **HIGH**.

---
*Stack research for: FinAlly AI trading workstation (brownfield; market subsystem complete)*
*Researched: 2026-10-23*
