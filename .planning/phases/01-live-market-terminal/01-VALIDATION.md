---
phase: "01"
slug: "live-market-terminal"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| (D-16 gate) | 01-01 T2 | 139 market tests on FastAPI >=0.135 / Starlette 1.x / Py 3.12 | regression | `uv run --directory backend --extra dev pytest -q tests/market` | ✅ exists | ⬜ pending |
| UX-01 | 01-01 T3, 01-05 T2 | theme tokens, flash keyframes, no pure black, tabular-nums | static + build | `npm --prefix frontend run build` + negative grep on `frontend/src` | created in 01-01 | ⬜ pending |
| OPS-01 | 01-02 T1, 01-04 T2 | init → source.start(tracked) before requests; initial snapshot; 30s loop; shutdown order | integration | `uv run --directory backend --extra dev pytest -q tests/test_main.py tests/test_snapshots.py` | ❌ created in plan | ⬜ pending |
| OPS-02 | 01-02 T1 | idempotent init, seed once (A1), six tables | integration | `uv run --directory backend --extra dev pytest -q tests/test_main.py` | ❌ created in plan | ⬜ pending |
| OPS-03 | 01-02 T1, 01-04 T2 | env wins over `.env`; empty values unset; `.env` loads before factory | unit | `uv run --directory backend --extra dev pytest -q tests/test_config.py` | ❌ created in plan | ⬜ pending |
| OPS-04 | 01-02 T2 | `/api/health` → 200 `{"status":"ok"}` | API | `uv run --directory backend --extra dev pytest -q tests/test_main.py -k Health` | ❌ created in plan | ⬜ pending |
| OPS-05 | 01-02 T1/T2 | unknown `/api/*` → JSON 404 (5 methods); `/` → index.html when present; API-only without export | API | `uv run --directory backend --extra dev pytest -q tests/test_main.py -k "NotFound or Static or built_frontend"` | ❌ created in plan | ⬜ pending |
| OPS-06 | 01-03 T1 | image builds, 1 worker, DB at `/app/db/finally.db` | smoke | `docker compose build && docker compose up -d --wait --wait-timeout 90` + curl checks | ❌ created in plan | ⬜ pending |
| OPS-07 | 01-03 T1 | healthcheck healthy; marker row survives down/up; volume kept | smoke | docker exec insert → down → up → curl → cleanup (01-03 T1 verify) | ❌ created in plan | ⬜ pending |
| OPS-08 | 01-03 T2 | scripts idempotent (run twice), build when missing, keep volume | smoke + manual (macOS/Linux) | PowerShell and Git Bash runs ×2 (01-03 T2 verify) | ❌ created in plan | ⬜ pending |
| WL-01, WL-02 | 01-02 T1 | defaults in order; shape; null prices when unpriced | API | `uv run --directory backend --extra dev pytest -q tests/test_main.py` | ❌ created in plan | ⬜ pending |
| WL-03..05 (API) | 01-04 T1 | 201/200/400/422; 204/404/400; cap 50 with dup-before-cap; concurrency | API | `uv run --directory backend --extra dev pytest -q tests/test_watchlist.py tests/test_tracker.py` | ❌ created in plan | ⬜ pending |
| WL-03..05 (UI) | 01-07 T1/T2 | add form, client regex, inline errors, × remove | component | `npm --prefix frontend test -- src/api/ticker src/components/watchlist` | ❌ created in plan | ⬜ pending |
| MD-01, MD-04 | 01-02 T1, 01-05 T1 | one EventSource; status machine; backoff 1s/2s/5s; StrictMode | unit/component | `npm --prefix frontend test -- src/stream src/components` | ❌ created in plan | ⬜ pending |
| MD-02, MD-03, MD-05, MD-07 | 01-05 T2, 01-07 T2 | Chg %, flash, sparkline, selection rules | unit/component | `npm --prefix frontend test` | ❌ created in plan | ⬜ pending |
| MD-06 | 01-06 T1/T2 | history seed, stale guard, out-of-order drop, Open line, D-12 states | component | `npm --prefix frontend test -- src/domain/chart src/components/ChartPanel` | ❌ created in plan | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `backend/tests/conftest.py` — `settings(tmp_path)`, `client` fixture, fake `MarketDataSource`
- [ ] `backend/tests/test_config.py`, `test_db.py`, `test_lifespan.py`, `test_tracker.py`, `tests/api/test_watchlist.py`, `test_system.py`, `test_static.py`
- [ ] Frontend Vitest stack install; `vitest.config.mts`, `vitest.setup.ts`; `src/test/FakeEventSource.ts`; `"test": "vitest run"` script
- [ ] Backend dependency bump gate (139 market tests green) before any new backend file

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Start/stop scripts idempotent on both OS families | OPS-08 | Needs Docker + host shell | Run start twice, stop twice; `docker volume inspect finally-data` still exists |
| Data survives stop/start | OPS-07 | Needs container lifecycle | Add a ticker, stop, start, ticker still listed |
| Visual terminal look and live flash | UX-01, MD-03 | Visual | Open http://localhost:8000, observe dark theme and fading flashes |
| Connection dot red when server down | MD-04 | Browser retry behavior | Stop container; observe yellow/red; start; observe green |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
