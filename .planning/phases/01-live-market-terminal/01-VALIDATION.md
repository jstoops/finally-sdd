---
phase: "01"
slug: "live-market-terminal"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-26"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9.x + pytest-asyncio (`asyncio_mode = "auto"`), httpx TestClient · Frontend: Vitest 5 + jsdom + Testing Library |
| **Config file** | `backend/pyproject.toml` (exists) · `frontend/vitest.config.mts`, `frontend/vitest.setup.ts` (Wave 0 installs) |
| **Quick run command** | `cd backend && uv run --extra dev pytest -q -x tests/api tests/test_db.py` · `cd frontend && npx vitest run` |
| **Full suite command** | `cd backend && uv run --extra dev pytest -q && uv run --extra dev ruff check app tests && uv run --extra dev ruff format --check app tests` · `cd frontend && npx vitest run && npm run lint && npx tsc --noEmit && npm run build` |
| **Estimated runtime** | ~60 seconds (excluding docker build) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched lane (backend `pytest -q -x <touched tests>` or `npx vitest run <dir>`)
- **After every plan wave:** Run the full backend suite (including the 139 market tests) plus the full frontend suite, lint, typecheck and `npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green, plus the packaging smoke and manual script checks
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled in by the planner/executor per task. Requirement → test map from RESEARCH.md:

Planner mapping (2026-10-26). Test files were consolidated to fit plan file budgets: lifespan, DB, health and static tests live in `backend/tests/test_main.py`; watchlist API tests in `backend/tests/test_watchlist.py` (not `tests/api/`).

| Req ID | Plan-Task | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|-----------|----------|-----------|-------------------|-------------|--------|
| (D-16 gate) | 01-01 T2 | 139 market tests on FastAPI >=0.135 / Starlette 1.x / Py 3.12 | regression | `uv run --directory backend --extra dev pytest -q tests/market` | ✅ exists | ✅ green |
| UX-01 | 01-01 T3, 01-05 T2 | theme tokens, flash keyframes, no pure black, tabular-nums | static + build | `npm --prefix frontend run build` + negative grep on `frontend/src` | ✅ exists | ✅ green |
| OPS-01 | 01-02 T1, 01-04 T2 | init → source.start(tracked) before requests; initial snapshot; 30s loop; shutdown order | integration | `uv run --directory backend --extra dev pytest -q tests/test_main.py tests/test_snapshots.py` | ✅ exists | ✅ green |
| OPS-02 | 01-02 T1 | idempotent init, seed once (A1), six tables | integration | `uv run --directory backend --extra dev pytest -q tests/test_main.py` | ✅ exists | ✅ green |
| OPS-03 | 01-02 T1, 01-04 T2 | env wins over `.env`; empty values unset; `.env` loads before factory | unit | `uv run --directory backend --extra dev pytest -q tests/test_config.py` | ✅ exists | ✅ green |
| OPS-04 | 01-02 T2 | `/api/health` → 200 `{"status":"ok"}` | API | `uv run --directory backend --extra dev pytest -q tests/test_main.py -k Health` | ✅ exists | ✅ green |
| OPS-05 | 01-02 T1/T2 | unknown `/api/*` → JSON 404 (5 methods); `/` → index.html when present; API-only without export | API | `uv run --directory backend --extra dev pytest -q tests/test_main.py -k "NotFound or Static or built_frontend"` | ✅ exists | ✅ green |
| OPS-06 | 01-03 T1 | image builds, 1 worker, DB at `/app/db/finally.db` | smoke | `docker compose build && docker compose up -d --wait --wait-timeout 90` + curl checks | ✅ exists | ✅ green |
| OPS-07 | 01-03 T1 | healthcheck healthy; marker row survives down/up; volume kept | smoke | docker exec insert → down → up → curl → cleanup (01-03 T1 verify) | ✅ exists | ✅ green |
| OPS-08 | 01-03 T2 | scripts idempotent (run twice), build when missing, keep volume | smoke + manual (macOS/Linux) | PowerShell and Git Bash runs ×2 (01-03 T2 verify) | ✅ exists | ✅ green |
| WL-01, WL-02 | 01-02 T1 | defaults in order; shape; null prices when unpriced | API | `uv run --directory backend --extra dev pytest -q tests/test_main.py` | ✅ exists | ✅ green |
| WL-03..05 (API) | 01-04 T1 | 201/200/400/422; 204/404/400; cap 50 with dup-before-cap; concurrency | API | `uv run --directory backend --extra dev pytest -q tests/test_watchlist.py tests/test_tracker.py` | ✅ exists | ✅ green |
| WL-03..05 (UI) | 01-07 T1/T2 | add form, client regex, inline errors, × remove | component | `npm --prefix frontend test -- src/api/ticker src/components/watchlist` | ✅ exists | ✅ green |
| MD-01, MD-04 | 01-02 T1, 01-05 T1 | one EventSource; status machine; backoff 1s/2s/5s; StrictMode | unit/component | `npm --prefix frontend test -- src/stream src/components` | ✅ exists | ✅ green |
| MD-02, MD-03, MD-05, MD-07 | 01-05 T2, 01-07 T2 | Chg %, flash, sparkline, selection rules | unit/component | `npm --prefix frontend test` | ✅ exists | ✅ green |
| MD-06 | 01-06 T1/T2 | history seed, stale guard, out-of-order drop, Open line, D-12 states | component | `npm --prefix frontend test -- src/domain/chart src/components/ChartPanel` | ✅ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `backend/tests/conftest.py` — `settings`, `make_app`, `client`, `recording_source` fixtures (01-04)
- [x] Backend tests consolidated per the planner mapping: `test_main.py`, `test_config.py`, `test_watchlist.py`, `test_tracker.py`, `test_snapshots.py`
- [x] Frontend Vitest stack; `vitest.config.mts`, `vitest.setup.ts`, `src/test/FakeEventSource.ts`; `"test": "vitest run"` (01-01, 01-05)
- [x] Backend dependency bump gate: 139 market tests green on FastAPI 0.162 / Starlette 1.10 / Py 3.12 (01-01)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Start/stop scripts idempotent on both OS families | OPS-08 | Needs Docker + host shell | Run start twice, stop twice; `docker volume inspect finally-data` still exists |
| Data survives stop/start | OPS-07 | Needs container lifecycle | Add a ticker, stop, start, ticker still listed |
| Visual terminal look and live flash | UX-01, MD-03 | Visual | Open http://localhost:8000, observe dark theme and fading flashes |
| Connection dot red when server down | MD-04 | Browser retry behavior | Stop container; observe yellow/red; start; observe green |
| macOS/Linux start script opens the browser | OPS-08 | Needs a real macOS/Linux desktop | `./scripts/start_mac.sh`; browser opens at http://localhost:8000 |
| Chart look: local time axis, dashed Open line, live extension | MD-06 | Canvas drawing is mocked in jsdom | Select a ticker; watch the area chart extend; Open line dashed at session open |
| × remove visible on hover and at tablet width; new ticker ticks live | WL-04, WL-05 | Visual / hover media query | Hover a row, resize to ~820px, add a ticker and watch it price |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-10-27 (validate-phase audit; all automated rows green, smoke rows run during execution)

## Validation Audit 2026-10-27

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
