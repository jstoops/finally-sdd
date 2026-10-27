---
phase: 01-live-market-terminal
verified: 2026-10-27T16:20:00Z
status: passed
score: 5/5 must-haves verified
covered_files:
  - ".planning/phases/01-live-market-terminal/01-01-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-01-SUMMARY.md"
  - ".planning/phases/01-live-market-terminal/01-02-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-02-SUMMARY.md"
  - ".planning/phases/01-live-market-terminal/01-03-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-03-SUMMARY.md"
  - ".planning/phases/01-live-market-terminal/01-04-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-04-SUMMARY.md"
  - ".planning/phases/01-live-market-terminal/01-05-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-05-SUMMARY.md"
  - ".planning/phases/01-live-market-terminal/01-06-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-06-SUMMARY.md"
  - ".planning/phases/01-live-market-terminal/01-07-PLAN.md"
  - ".planning/phases/01-live-market-terminal/01-07-SUMMARY.md"
  - "Dockerfile"
  - "backend/app/api/system.py"
  - "backend/app/api/watchlist.py"
  - "backend/app/config.py"
  - "backend/app/db/__init__.py"
  - "backend/app/db/schema.sql"
  - "backend/app/db/seed.py"
  - "backend/app/main.py"
  - "backend/app/tracker.py"
  - "backend/app/watchlist.py"
  - "docker-compose.yml"
  - "frontend/src/app/globals.css"
  - "frontend/src/components/ChartPanel.tsx"
  - "frontend/src/components/Header.tsx"
  - "frontend/src/components/Terminal.tsx"
  - "frontend/src/components/Watchlist.tsx"
  - "frontend/src/store/prices.ts"
  - "frontend/src/store/watchlist.ts"
  - "frontend/src/stream/priceStream.ts"
  - "scripts/start_mac.sh"
  - "scripts/start_windows.ps1"
  - "scripts/stop_mac.sh"
  - "scripts/stop_windows.ps1"
covered_digest: "v3:sha256:04042569b85399280b694de92a0fb1bed21dee8369e82fa1244c8a275b03860f"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open http://localhost:8000 after `scripts/start_windows.ps1` (or `start_mac.sh`) and look at the terminal"
    expected: "Dark terminal (no pure black), yellow/blue/purple accents, 10 default tickers streaming; price cells flash green/red and fade in about 500ms; digits do not jitter; sparklines fill in progressively"
    why_human: "Visual appearance and animation timing. Tests assert the flash class and key remount, not the rendered look or the 500ms fade."
  - test: "Click several watchlist rows and watch the main chart"
    expected: "Lightweight Charts canvas renders an area line pre-filled with about 5 minutes, extends live with local HH:MM:SS axis labels, dashed Open line shown, no flicker on switching"
    why_human: "Chart rendering is canvas; the component tests mock lightweight-charts."
  - test: "Add a ticker, remove one with the hover x, and repeat on a tablet-width window"
    expected: "x appears on row hover or keyboard focus and stays visible on touch/no-hover devices; inline errors for malformed symbol and the 51st ticker are readable"
    why_human: "Hover and tablet visibility depend on real CSS media behavior."
  - test: "With the app open, run `docker compose restart app` (not `down -v`)"
    expected: "Header dot goes yellow, then red after about 3 seconds of failed reconnects, then green again by itself; the watchlist re-fetches and prices resume"
    why_human: "End-to-end behavior of WR-03 and WR-04 against a real server restart. Unit tests exercise the state machine with a fake EventSource only."
  - test: "Run `./scripts/start_mac.sh` on macOS or Linux with a desktop session"
    expected: "Browser opens to http://localhost:8000 (open / xdg-open path); script is harmless on a second run"
    why_human: "Browser auto-open on macOS/Linux was not exercised on a real desktop (the Linux/Mac scripts were only run under Git Bash with --no-open)."
---

# Phase 1: Live Market Terminal Verification Report

**Phase Goal:** A user runs one start script, opens `http://localhost:8000`, and watches a dark trading terminal stream live prices for a watchlist they can chart, add to and remove from
**Verified:** 2026-10-27T16:20:00Z
**Status:** human_needed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | One start script builds and starts one container and prints the URL; `localhost:8000` shows a dark terminal with the 10 default tickers streaming with no API keys; re-run harmless; stop keeps the volume | VERIFIED | `scripts/start_{mac.sh,windows.ps1}` read in full: docker check, `.env` bootstrap from `.env.example` (never overwrites), build only when `--build` or image missing, `docker compose up -d --wait`, prints URL. `stop_*` run plain `docker compose down` (no `-v`). `Dockerfile` is Node 22 slim -> Python 3.12 slim + uv, copies export to `/app/static`, single worker. Compose has `8000:8000`, `env_file` (not required), `finally-data` volume at `/app/db`, python-based healthcheck on `/api/health`, and `DB_PATH` pinned under `environment:`. Locally I ran uvicorn against the real `frontend/out` export: `/` returns the terminal HTML, `/api/watchlist` returns the 10 seeded tickers with prices, and `/api/stream/prices` emits `retry: 1000` then frames. Theme tokens in `globals.css` are `#0d1117`, `#1a1a2e`, `#ecad0a`, `#209dd7`, `#753991`; grep finds no `#000`/`bg-black` in `frontend/src`. Orchestrator ran the containerized flow (Windows scripts x2, one container, volume kept). Docker was not running during my pass, so I did not repeat that. |
| 2 | Each row shows ticker, price flashing green/red over ~500ms, Chg % since open (`—` until priced), and a sparkline from page load; tabular digits | VERIFIED (visual items routed to human) | `Watchlist.tsx` `WatchlistRow`: price span keyed by `tick.timestamp` with `flash-up`/`flash-down` classes; CSS keyframes are 500ms; `chgPercent` returns null for missing/zero open and `formatPct`/`formatPrice` render `—`; `Sparkline` is an inline SVG polyline fed by `usePrices.spark` (capped at `SPARK_MAX`, appended only for newer timestamps); `tabular-nums` on price and Chg cells. Covered by `watchlist.test.tsx`, `market.test.ts` (117 frontend tests pass on my run). |
| 3 | Clicking a row charts that ticker pre-filled with ~5 minutes and extending live with local HH:MM:SS; first ticker selected on load; removing the selected selects the first remaining | VERIFIED (canvas rendering routed to human) | `ChartPanel.tsx` seeds from `/api/prices/{t}/history` with a stale-response request id, then extends via a `usePrices.subscribe` using `isNewer`; `formatLocalTime` via `Intl.DateTimeFormat` h23 for ticks and crosshair. `nextSelection` in `domain/market.ts` keeps selection, else first, else null; `setEntries` applies it on load, add and remove. Live endpoint check: history returns `{ticker, points:[{timestamp,price}...]}` in Unix seconds. |
| 4 | Add a ticker (priced immediately) and remove one; re-add harmless; malformed symbol or 51st ticker shows a clear error; edits survive stop/start with no duplicate/overwritten seed | VERIFIED | Live against a real uvicorn process with a fresh DB: `POST pypl` -> 201 with a price (normalized to PYPL); repeat -> 200; `1BAD` -> 400 with message; `{}` -> 422; `DELETE` -> 204, again -> 404 `{"error": "PYPL is not on your watchlist"}`; after filling to 50, `OVER` -> 400 "Watchlist is full (50 tickers)…" and re-adding `AAPL` at the cap -> 200. After killing and restarting uvicorn on the same DB file: 50 rows, 50 distinct tickers (no duplicates). `seed()` inserts the watchlist only when the user row is new (documented user decision A1, so a removed default ticker stays removed). Frontend: `AddTickerForm` and row x go through `useWatchlist.addTicker/removeTicker`, client `TICKER_RE` mirrors the server, errors in one inline slot. |
| 5 | Header dot green/yellow/red and recovers on its own; `/api/health` returns `{"status":"ok"}` and drives the compose healthcheck; unknown `/api/*` returns JSON 404 | VERIFIED (real-restart behavior routed to human) | `Header.tsx` `ConnectionDot` maps open/connecting/closed to green/yellow/red. `priceStream.ts`: one `new EventSource`, status machine, `DISCONNECTED_AFTER_FAILURES = 3` (WR-03), CLOSED recreate with 1s/2s/5s capped backoff; `Terminal.tsx` re-fetches the watchlist on stream reopen (WR-04). Live: `/api/health` -> `{"status":"ok"} [200]`; `GET /api/nope` and `POST /api/nope` -> `{"error":"Not found"} [404]`; compose healthcheck hits `/api/health`. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified). Human items below cover visual and real-restart checks that code reading and mocked tests cannot prove.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `backend/app/main.py` | App factory, lifespan order, routers, JSON 404, static mount last | VERIFIED | Lifespan: `db.init` -> `tracked_tickers` -> `source.start` -> initial `recorder.record()` -> snapshot loop task, all before `yield`; cleanup cancels the task, then stops the source. `install_api_not_found` is registered after every `/api` router and before the `/` mount. |
| `backend/app/db/{__init__,schema.sql,seed}.py` | Idempotent schema and seed, stdlib sqlite3 | VERIFIED | All six tables `CREATE TABLE IF NOT EXISTS`; `INSERT OR IGNORE`; `BEGIN IMMEDIATE` transactions with safe rollback (WR-05). |
| `backend/app/config.py` | `.env` loading, no secret logging, volume-safe default DB path | VERIFIED | `load_dotenv(override=False)`; blank values treated as unset; `Settings` holds no secrets; `default_db_path` resolves to `/app/db/finally.db` in the image layout (CR-01 fix). |
| `backend/app/watchlist.py`, `tracker.py`, `api/watchlist.py` | Add/remove with cap, reconcile of tracked tickers | VERIFIED | Cap 50 with duplicate-first check; mutation under the shared lock; reconcile on every add (WR-01); `TickerTracker` is the only non-market caller of `add_ticker`/`remove_ticker`. |
| `backend/app/snapshots.py` | Initial and 30s snapshots | VERIFIED | `SnapshotRecorder`, `run_snapshot_loop(interval=30)` wired in lifespan. (Phase 2 consumes it; Phase 1 only needs it started per OPS-01.) |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example` | Container packaging | VERIFIED | See Truth 1. |
| `scripts/*` | Four idempotent start/stop wrappers | VERIFIED | Both pairs present and equivalent in behavior. |
| `frontend/src/components/{Terminal,Header,Watchlist,ChartPanel}.tsx` | Terminal grid, dot, watchlist, chart | VERIFIED | Substantive and wired; heatmap, P&L, positions and chat slots are deliberate "coming in Phase 2/3" placeholders, in scope for later phases. |
| `frontend/src/{stream,store,domain,api}/*` | Stream, stores, pure helpers, client | VERIFIED | One `EventSource` in the app; stores shared by all panels. |
| `frontend/out/` (static export) | Built output served by FastAPI | VERIFIED | `index.html`, `404.html`, `_next/` present; served at `/` in my local run. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Terminal` | `startPriceStream` -> `/api/stream/prices` | effect on mount, cleanup on unmount | WIRED | Single call site; stream status drives the dot and the watchlist re-fetch. |
| `Terminal` | `useWatchlist.loadWatchlist` -> `/api/watchlist` | effect plus reopen subscription | WIRED | Server returns real prices from the cache. |
| `Watchlist` form / row x | `POST` / `DELETE /api/watchlist` | `useWatchlist.addTicker/removeTicker` | WIRED | Exercised live through the API contract. |
| `WatchlistService` | `TickerTracker.reconcile` -> `source.add_ticker/remove_ticker` | after commit, under lock | WIRED | New ticker priced immediately (201 with price). |
| `ChartPanel` | `/api/prices/{t}/history` and `usePrices` | seed on selection, subscribe for live | WIRED | Request-id guard against stale seeds. |
| `create_app` | market stream router, watchlist router, system router, static mount | `include_router`, `mount_static` | WIRED | Order verified (JSON 404 before the `/` mount). |
| `docker-compose` healthcheck | `/api/health` | python urllib | WIRED | Endpoint verified live. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `Watchlist` row price/Chg/spark | `ticks`, `spark` | SSE frames from `PriceCache` fed by the simulator | Yes, live frame shows changing prices and `open_price` | FLOWING |
| `Watchlist` entries | `entries` | `GET /api/watchlist` -> SQLite + cache | Yes, 10 seeded rows with prices | FLOWING |
| `ChartPanel` series | history points + live ticks | `/api/prices/{t}/history` ring buffer + SSE | Yes, history returned timestamped points | FLOWING |
| `ConnectionDot` | `status` | EventSource lifecycle | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend suite | `uv run --extra dev pytest -q` (once) | 258 passed, ruff clean | PASS |
| Frontend suite | `npx vitest run` (once) | 7 files, 117 tests passed | PASS |
| App boots and serves everything | local uvicorn on `:8765` with temp DB and `frontend/out` | health, watchlist, history, SSE, `/`, JSON 404 all as expected | PASS |
| Add/remove/cap/duplicate/malformed | curl against the live process | 201/200/400/422/204/404/400 as specified | PASS |
| Persistence | kill and restart on the same DB | 50 rows, 50 unique | PASS |
| Container build and run | not repeated (Docker daemon not running at verification time) | Orchestrator reports a successful run on the merged tree | SKIP (relied on orchestrator evidence) |

### Probe Execution

No `probe-*.sh` scripts are declared or exist for this phase. SKIPPED.

### Requirements Coverage

All 21 phase requirement IDs appear in PLAN frontmatter and in REQUIREMENTS.md, and ROADMAP maps exactly these 21 to Phase 1. None is orphaned. (Union across plans: 01-01 UX-01; 01-02 OPS-01..05, WL-01, WL-02, MD-01; 01-03 OPS-06..08; 01-04 WL-03..05, OPS-01, OPS-03; 01-05 MD-01..05, MD-07, UX-01; 01-06 MD-06, MD-07; 01-07 WL-03..05, MD-07.)

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OPS-01 | 01-02, 01-04 | Lifespan: schema/seed, source start with watchlist ∪ positions, initial snapshot, 30s task, before requests | SATISFIED | `main.py` lifespan order. |
| OPS-02 | 01-02 | Idempotent schema/seed with stdlib sqlite3 | SATISFIED | `db/__init__.py`, `seed.py`; restart check showed no duplicates. |
| OPS-03 | 01-02, 01-04 | `../.env` via python-dotenv, env precedence, no secret logging | SATISFIED | `Settings.from_env`; no secret fields. |
| OPS-04 | 01-02 | `/api/health` | SATISFIED | Live 200. |
| OPS-05 | 01-02 | Static export at `/`; JSON 404 for unknown `/api/*` | SATISFIED | Live. Info IN-04 (wrong method on a real `/api` route becomes 404, HEAD/OPTIONS not covered) is open and cosmetic. |
| OPS-06 | 01-03 | Multi-stage Dockerfile, Node 22 -> Python 3.12 + uv, lockfile, `DB_PATH`, one worker | SATISFIED | `Dockerfile` read; `uv sync --locked`. |
| OPS-07 | 01-03 | Compose port, env_file, `finally-data`, healthcheck, persistence | SATISFIED | `docker-compose.yml`; persistence per executor check and my DB restart check. |
| OPS-08 | 01-03 | Idempotent start/stop scripts for both platforms | SATISFIED | Four scripts read. |
| WL-01 | 01-02 | Default 10 tickers | SATISFIED | Live. |
| WL-02 | 01-02 | `GET /api/watchlist` in `added_at` order with price/open_price | SATISFIED | Live; `ORDER BY added_at, rowid`. |
| WL-03 | 01-04, 01-07 | Add: 201/200/400 | SATISFIED | Live. |
| WL-04 | 01-04, 01-07 | Remove: 204/404 | SATISFIED | Live. |
| WL-05 | 01-04, 01-07 | 50-ticker cap | SATISFIED | Live. |
| MD-01 | 01-02, 01-05 | One EventSource, one shared prices map | SATISFIED | Single `new EventSource` (priceStream.ts), single `usePrices` store. |
| MD-02 | 01-05 | Ticker, price, Chg % since open, `—` when unpriced | SATISFIED | `chgPercent`/`formatPct`. |
| MD-03 | 01-05 | Green/red flash ~500ms on change only | SATISFIED in code (visual to human) | Keyed span + 500ms keyframes. |
| MD-04 | 01-05 | Green/yellow/red dot, capped backoff recreate | SATISFIED in code (real restart to human) | `priceStream.ts` + `Header.tsx`. |
| MD-05 | 01-05 | Inline SVG sparkline, capped, since page load | SATISFIED | `Sparkline`, `SPARK_MAX=300`. (Clear on reset is Phase 2/3.) |
| MD-06 | 01-06 | Lightweight Charts main chart seeded from history | SATISFIED in code (render to human) | `ChartPanel.tsx`. |
| MD-07 | 01-05, 01-06, 01-07 | Click selects; first selected on load; removal reselects | SATISFIED | `nextSelection`, `setEntries`. (Reset reselect is Phase 2.) |
| UX-01 | 01-01, 01-05 | Dark Tailwind theme with tabular numerals | SATISFIED in code (look to human) | `globals.css` tokens, `tabular-nums`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `frontend/src/components/Terminal.tsx` | n/a | `ComingSoon` placeholder panels for heatmap, P&L, positions and chat | Info | Intentional and labelled; those panels belong to Phases 2 and 3 and are not part of the Phase 1 contract. |
| (all modified files) | n/a | `TBD`/`FIXME`/`XXX` debt markers | none | grep over `backend/app`, `frontend/src`, `scripts`, `Dockerfile`, `docker-compose.yml` found none. |

Open review items (IN-01..IN-11, info only, in `01-REVIEW-DISPOSITION.md`) are non-blocking. Notable but minor: IN-01 live ticks arriving during an in-flight history fetch are not charted (a sub-second gap at selection time); IN-02 a stale `loadWatchlist` response can overwrite a newer add or remove (a narrow race). `01-UI-REVIEW.md` scored 16/24 and is advisory.

### Human Verification Required

1. **Visual terminal and flash.** Run a start script and open `http://localhost:8000`. Expect a dark, accent-colored terminal, ten streaming tickers, green/red price flashes fading in about 500ms, non-jittering digits, sparklines filling in. Human because tests assert classes, not looks or timing.
2. **Main chart rendering.** Click several rows. Expect a populated Lightweight Charts area with local HH:MM:SS axis, live extension and an Open line. Human because the canvas is mocked in tests.
3. **x control and tablet layout.** Hover and focus behaviour of the remove x, and layout at tablet width.
4. **Connection dot across a real server restart.** `docker compose restart app` (do not use `down -v`): yellow, then red, then green by itself, with the watchlist re-fetched. This covers the WR-03 and WR-04 behavior changes end to end.
5. **macOS/Linux browser auto-open.** `open`/`xdg-open` path of `start_mac.sh` on a real desktop.

### Gaps Summary

No gaps. Every ROADMAP success criterion is backed by code I read and, where feasible, by live behavior I exercised against a real uvicorn process serving the actual static export (watchlist CRUD with all status codes, cap, malformed input, health, JSON 404, SSE, history, persistence across restart) plus fresh runs of the backend (258) and frontend (117) suites. The only reason the status is `human_needed` rather than `passed` is the five visual and real-restart checks above, which cannot be proven without a browser or a restarting container. I did not rebuild or run the container (Docker daemon was not running); that rests on the orchestrator's evidence, including the later CR-01 compose change, which I confirmed by reading `docker-compose.yml` (`DB_PATH` pinned) and `config.py` (volume-safe default).

---

_Verified: 2026-10-27T16:20:00Z_
_Verifier: Claude (gsd-verifier)_
