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

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| OPS-01 | lifespan: schema, source started with tracked set, initial snapshot, task running; shutdown stops source | integration | `pytest tests/test_lifespan.py -x` | ❌ W0 | ⬜ pending |
| OPS-02 | init idempotent; seed-once; 6 tables | unit | `pytest tests/test_db.py -x` | ❌ W0 | ⬜ pending |
| OPS-03 | env wins over `.env`; empty `DB_PATH` → default; secrets hidden | unit | `pytest tests/test_config.py -x` | ❌ W0 | ⬜ pending |
| OPS-04 | `/api/health` → 200 `{"status":"ok"}` | API | `pytest tests/api/test_system.py -x` | ❌ W0 | ⬜ pending |
| OPS-05 | unknown `/api/*` → JSON 404; `/` → index.html when present | API | `pytest tests/api/test_static.py -x` | ❌ W0 | ⬜ pending |
| OPS-06 | image builds, 1 worker, DB at `/app/db/finally.db` | smoke | packaging smoke | manual-assisted | ⬜ pending |
| OPS-07 | healthcheck healthy; data survives down/up | smoke | `docker compose up -d --wait` + curl add/down/up/curl | manual-assisted | ⬜ pending |
| OPS-08 | scripts idempotent, build on missing image, keep volume | manual | run each script twice | manual | ⬜ pending |
| WL-01..05 | watchlist defaults, shape, add/remove codes, cap 50 | API | `pytest tests/api/test_watchlist.py -x` | ❌ W0 | ⬜ pending |
| MD-01..07 | stream store, Chg %, flash, connection state, sparkline, chart, selection | unit/component | `npx vitest run` | ❌ W0 | ⬜ pending |
| UX-01 | palette tokens; no pure black | static | `grep -rniE "#000\b\|#000000\|\bbg-black\b" frontend/src` → no hits | manual-assisted | ⬜ pending |

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
