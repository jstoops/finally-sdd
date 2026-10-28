---
phase: "02"
slug: "trading-and-live-portfolio"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-27"
---

# Phase 02 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9.0.2 + pytest-asyncio (`asyncio_mode = "auto"`), FastAPI `TestClient`. Frontend: Vitest + Testing Library + jsdom (`FakeEventSource`, ResizeObserver stub) |
| **Config file** | `backend/pyproject.toml` `[tool.pytest.ini_options]`; `frontend/vitest.config.mts`, `frontend/vitest.setup.ts` |
| **Quick run command** | `uv run --directory backend --extra dev pytest -q -x tests/test_trading.py tests/test_money.py` · `npm --prefix frontend test -- src/domain` |
| **Full suite command** | `uv run --directory backend --extra dev pytest -q && uv run --directory backend --extra dev ruff check app tests && uv run --directory backend --extra dev ruff format --check app tests && npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend run build` |
| **Estimated runtime** | ~60 seconds (excluding docker build) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched area (backend test file filter or frontend file filter)
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green, including `npm --prefix frontend run build`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | TRD-05, TRD-06, TRD-07, PF-01, PF-02 | T-02-03, T-02-05 | Fill price read from PriceCache under state_lock; snapshot written in-transaction (no lock re-entry) | integration + component (tracer) | `uv run --directory backend --extra dev pytest -q tests/test_portfolio_api.py -k Tracer` · `npm --prefix frontend test -- src/components/terminal.test.tsx` | ❌ W0 (created in task) | ⬜ pending |
| 02-01-02 | 01 | 1 | TRD-01..05, WL-06, PF-01, PF-02 | T-02-01, T-02-02, T-02-04 | NaN/Infinity/1e400 rejected in the service; 20 parallel buys never overspend | unit/async | `uv run --directory backend --extra dev pytest -q tests/test_money.py tests/test_valuation.py tests/test_trading.py tests/test_snapshots.py tests/test_watchlist.py tests/test_tracker.py` | ❌ W0 (created in task) | ⬜ pending |
| 02-02-01 | 02 | 2 | PF-04, PF-05, PF-06, MD-08 | T-02-09 | Raw selectors + useMemo (no render loop) | unit + component | `npm --prefix frontend test -- src/domain/portfolio.test.ts src/components/header.test.tsx src/components/PositionsTable.test.tsx src/components/terminal.test.tsx` | ❌ W0 (created in task) | ⬜ pending |
| 02-02-02 | 02 | 2 | PF-07, MD-08 | T-02-08, T-02-SC | Labels as text nodes; no treemap/chart package added | unit + component | `npm --prefix frontend test -- src/domain/treemap.test.ts src/domain/portfolio.test.ts src/components/Heatmap.test.tsx` | ❌ W0 (created in task) | ⬜ pending |
| 02-02-03 | 02 | 2 | MD-08 | — | N/A | unit + component | `npm --prefix frontend test -- src/domain/market.test.ts src/components/terminal.test.tsx` | ✅ (market.test.ts exists) | ⬜ pending |
| 02-03-01 | 03 | 2 | TRD-07, TRD-08, TRD-09 | T-02-11, T-02-12 | Confirmation built from the recorded fill; errors rendered as text | component | `npm --prefix frontend test -- src/components/TradeBar.test.tsx` | ❌ W0 (created in task) | ⬜ pending |
| 02-03-02 | 03 | 2 | TRD-10 | T-02-10 | GET /api/trades bounded by LIMIT 100 | integration + component | `uv run --directory backend --extra dev pytest -q tests/test_portfolio_api.py -k trades` · `npm --prefix frontend test -- src/components/TradeHistory.test.tsx src/components/TradeBar.test.tsx` | ❌ W0 (created in task) | ⬜ pending |
| 02-04-01 | 04 | 3 | PF-02, PF-03, PF-08 | T-02-15 | N/A (history accepted unbounded per PLAN §7) | integration + unit + component | `uv run --directory backend --extra dev pytest -q tests/test_portfolio_api.py -k History` · `npm --prefix frontend test -- src/domain/pnl.test.ts src/components/PnlChart.test.tsx src/components/terminal.test.tsx` | ❌ W0 (created in task) | ⬜ pending |
| 02-04-02 | 04 | 3 | PF-02, PF-09, WL-06 | T-02-13, T-02-14, T-02-16 | Reset requires a JSON content type (CSRF guard), takes state_lock, confirm in the handler | integration + component + container smoke | `uv run --directory backend --extra dev pytest -q tests/test_reset.py` · `npm --prefix frontend test -- src/components/header.test.tsx -t reset` · read-only `docker compose up -d --build --wait` smoke | ❌ W0 (created in task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Filled in from the PLAN.md files once planning completes. Requirement → test map: see `02-RESEARCH.md` § Validation Architecture.*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_money.py`, `test_valuation.py`, `test_trading.py`, `test_portfolio_api.py`, `test_reset.py`
- [ ] `backend/tests/conftest.py`: shared trade fixture (db + `PriceCache` + recording source + `TickerTracker` + shared `asyncio.Lock` + trade service) and a price-seeding helper
- [ ] `frontend/src/domain/portfolio.test.ts`, `treemap.test.ts`, `pnl.test.ts`
- [ ] `frontend/src/components/TradeBar.test.tsx`, `PositionsTable.test.tsx`, `Heatmap.test.tsx`, `PnlChart.test.tsx`, `TradeHistory.test.tsx`, `header.test.tsx`
- [ ] Update `frontend/src/components/terminal.test.tsx` (URL-routing fetch stub; replace the Phase 2 placeholder assertions)

*No framework installs are needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Heatmap and P&L chart visual density and colors | PF-07, PF-08 | Visual judgement of canvas/treemap rendering | Run the container, buy 3+ tickers, confirm tile sizing and green/red shading, and that the P&L chart reads sensibly with one point and with several |
| Rapid repeated Buy clicks keep cash exact to the cent | TRD-04, TRD-05 | Real-browser timing against a running container | `docker compose up -d --build`, click Buy quickly 10+ times, then compare header cash with `GET /api/portfolio` and the trade log |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
