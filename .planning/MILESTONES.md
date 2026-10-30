# Milestones

## v1 MVP (Shipped: 2026-10-30)

**Delivered:** Every PLAN.md feature in one container: a live market terminal, manual trading with a live portfolio, and an AI copilot that trades and edits the watchlist, with backend, frontend and Playwright E2E test suites.

**Phases completed:** 3 phases (1–3), 19 plans, 43 tasks
**Timeline:** 2026-10-26 → 2026-10-30 (5 days), 200 commits (`356157f..0dd2305`), 37 `feat` commits
**Code changed:** 127 files, +15,733 / −14 lines (excluding `.planning/` and lockfiles)
**Code size:** backend `app/` ~3,300 Python LOC (tests ~5,400); frontend `src/` ~8,000 TypeScript LOC; E2E ~460 LOC
**Tests at close:** backend 577, frontend 347, Playwright E2E 17, all green
**Audit:** `milestones/v1-MILESTONE-AUDIT.md`: tech_debt, 64/64 requirements, 10/10 integration, 7/7 flows
**Closeout type:** override_closeout

**Key accomplishments:**
- **One-command container:** a multi-stage Docker image (Node 22 static export, then Python 3.12 + uv with one uvicorn worker) runs under compose on port 8000 with SQLite in the `finally-data` volume, plus idempotent bash and PowerShell start/stop scripts.
- **Live market terminal:** a reconnecting SSE store drives a status dot, flashing watchlist rows with Chg % and SVG sparklines, and a Lightweight Charts main chart seeded from the 5-minute history. Watchlist add/remove reconciles tracked tickers (watchlist ∪ positions).
- **Correct-to-the-cent trading:** a single `TradeService` fills each trade in one BEGIN IMMEDIATE transaction (cash, position, trade row and snapshot) under a shared state lock, using half-up Decimal math and strict input gates. 85+ rule tests include a 20-way parallel-buy race.
- **Live portfolio:** the header total and P&L, positions table, squarified heatmap, P&L BaselineSeries, trade history and reset are all recomputed client-side from SSE prices without polling `/api/portfolio`.
- **AI copilot:** `POST /api/chat` goes through LiteLLM → OpenRouter (Cerebras, strict structured output) or `LLM_MOCK`. A lenient parser validates each item; actions run independently through the same services, failures get templated ⚠️ notes, and the chat panel shows action chips.
- **Proven end to end:** Playwright runs in its own container against the real image in mock mode, covering all seven PLAN §12 scenarios plus the desktop and tablet layouts.

### Known verification overrides

Known verification overrides: 2 newly acknowledged, 0 carried forward
- Phase 1 `01-VERIFICATION.md` is stale. It passed, but later phases changed files it covers (`main.py`, `config.py`, `tracker.py`, `watchlist.py`, `Dockerfile`, …).
- Phase 2 `02-VERIFICATION.md` is stale for the same reason (`api/portfolio.py`, `main.py`, `Header.tsx`, `PnlChart.tsx`, `Terminal.tsx`, …).
- Accepted because the v1 milestone audit ran after Phase 3 and re-checked all requirements, integration and E2E flows.

### Tech debt carried forward

- Phase 1 IN-02: `loadWatchlist` has no sequence guard, so a slow GET can overwrite a newer add/remove.
- Phase 1 IN-04: a wrong HTTP method on a real `/api` route returns 404 instead of 405.
- Phase 2 WR-04: `PositionsTable`/`Heatmap` ignore `loaded`/`loadError`, so a failed portfolio load shows the empty state.
- Phase 2 WR-01: quantity rounds half-up to 4 dp, so a 0.00005-share buy fills 0.0001.
- Phase 2 IN-01: the post-commit `view_sync` is unguarded, so if it raises the caller gets a 500 for a fill that committed.
- No concurrency test for read isolation of `GET /api/portfolio` and `/history`.
- At 768px the watchlist column clips ticker symbols to one letter.
- Phase 3 nyquist not validated (`03-VALIDATION.md` still in draft); 03-REVIEW IN-01..IN-07 are info-level.
- Packaging: start scripts reuse a stale `finally:latest` image without `--build`, and the old `finally_finally-data` volume name doesn't match `finally-data`.
- Backlog 999.1: `start_mac.sh` browser launch not yet verified on macOS/Linux.

**Archives:** `milestones/v1-ROADMAP.md`, `milestones/v1-REQUIREMENTS.md`, `milestones/v1-phases/`, `milestones/v1-quick/`

---
