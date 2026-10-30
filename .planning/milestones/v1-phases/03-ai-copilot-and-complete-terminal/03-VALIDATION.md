---
phase: "03"
slug: "ai-copilot-and-complete-terminal"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-29"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Backend: pytest 9 + pytest-asyncio (`asyncio_mode = "auto"`), Starlette `TestClient`. Frontend: Vitest + Testing Library + jsdom (`FakeEventSource`, `stubApi`). E2E: @playwright/test 1.64.1 in Docker (`test/docker-compose.test.yml`) |
| **Config file** | `backend/pyproject.toml` `[tool.pytest.ini_options]`; `frontend/vitest.config.mts`, `frontend/vitest.setup.ts`; `test/playwright.config.ts` (new, Wave 0) |
| **Quick run command** | `uv run --directory backend --extra dev pytest -q -x tests/test_chat_api.py tests/test_chat_actions.py tests/test_chat_parsing.py tests/test_chat_mock.py` · `npm --prefix frontend test -- src/components/ChatPanel.test.tsx src/store` |
| **Full suite command** | `uv run --directory backend --extra dev pytest -q && uv run --directory backend --extra dev ruff check app tests && uv run --directory backend --extra dev ruff format --check app tests && npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend run build` |
| **E2E command (phase gate)** | `docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright; docker compose -f test/docker-compose.test.yml down -v` |
| **Estimated runtime** | ~60 seconds for the full suite (excluding docker build); the E2E compose run takes minutes |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched area (backend test file filter or frontend file filter)
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green, including `npm --prefix frontend run build`, plus a green E2E compose run under `LLM_MOCK=true` and the human-verified real-LLM spike
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | AI-01, AI-05, AI-10, AI-13, AI-15 | T-03-01, T-03-02, T-03-03, T-03-04, T-03-SC | Every AI action goes through TradeService/WatchlistService; chat text rendered as text nodes; fixed 502/503 texts; parameterized chat SQL | integration + component (tracer) | `uv run --directory backend --extra dev pytest -q tests/test_chat_api.py -k Tracer` · `npm --prefix frontend test -- src/components/terminal.test.tsx` | ❌ W0 (created by the task) | ⬜ pending |
| 03-02-01 | 02 | 2 | AI-04, AI-05, AI-06, AI-07, AI-08, AI-10 | T-03-05, T-03-SC | Per-item StrictStr/StrictFloat validation before any service call; 10 + 10 caps; no direct table writes from chat code | unit/async | `uv run --directory backend --extra dev pytest -q tests/test_chat_parsing.py tests/test_chat_actions.py tests/test_chat_mock.py` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | AI-01, AI-02, AI-03, AI-09, AI-11, TST-01 | T-03-06, T-03-07, T-03-09, T-03-10 | 2,000 code-point cap before storing; history replays text, never action JSON; fixed 502 text; chat-only turn lock | unit + integration | `uv run --directory backend --extra dev pytest -q tests/test_chat_api.py tests/test_chat_prompt.py` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | AI-11, AI-12, AI-13, AI-14, AI-15, AI-16, TST-02 | T-03-11, T-03-13 | Text nodes only (no raw-HTML sink); one request in flight; code-point pre-check | unit + component | `npm --prefix frontend test -- src/components/ChatPanel.test.tsx src/store/chat.test.ts` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | PF-10 | T-03-12 | Reset disabled while a chat request is in flight | component | `npm --prefix frontend test -- src/components/header.test.tsx -t reset` | ✅ (extend) | ⬜ pending |
| 03-03-03 | 03 | 2 | UX-02, TST-04 | T-03-SC | No frontend dependency change | component | `npm --prefix frontend test -- src/components/terminal.test.tsx src/components/PnlChart.test.tsx` | ✅ (extend) | ⬜ pending |
| 03-04-01 | 04 | 2 | (legitimacy gate) | T-03-SC | Blocking human approval of litellm 1.106.2, @playwright/test 1.64.1 and the v1.64.1-noble image before any install | checkpoint (blocking-human) | — (human reply "approved") | n/a | ⬜ pending |
| 03-04-02 | 04 | 2 | AI-01 | T-03-14, T-03-15, T-03-16, T-03-17, T-03-18, T-03-SC | Exact pin, lockfile free of 1.82.7/1.82.8; completion off the loop; LLMError carries only the type name | unit + human spike | `uv run --directory backend --extra dev pytest -q tests/test_chat_llm.py` · human: `uv run --directory backend python chat_llm_spike.py` | ❌ W0 | ⬜ pending |
| 03-04-03 | 04 | 2 | AI-01, AI-09 | T-03-14, T-03-18, T-03-19 | Key `repr=False`; mock before key; 503 stores nothing; litellm never imported in mock or unconfigured mode | unit + integration | `uv run --directory backend --extra dev pytest -q tests/test_chat_config.py` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 3 | TST-03, UX-02 | T-03-20, T-03-21, T-03-SC | Own compose project, tmpfs DB, no named volume, no env file, BASE_URL required | E2E | `docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright` then `down -v` | ❌ W0 | ⬜ pending |
| 03-05-02 | 05 | 3 | TST-03, TST-04 | T-03-20 | Every spec resets in beforeEach; hooks-only selectors | E2E | same E2E command | ❌ W0 | ⬜ pending |
| 03-05-03 | 05 | 3 | TST-01, TST-02 | — | N/A (phase gate) | suite + E2E + human checks | full suite command · E2E command · `uv run --directory backend --extra dev pytest -q tests/test_reset.py -k chat_history` | ✅ (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Filled in from the PLAN.md files once planning completes. Requirement → test map: see `03-RESEARCH.md` § Validation Architecture. Human checks are collected at end of phase (`workflow.human_verify_mode = end-of-phase`): the real-LLM spike (03-04-02), tablet layout and live copilot UAT (03-05-03).*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_chat_parsing.py`, `test_chat_actions.py`, `test_chat_mock.py`, `test_chat_api.py`, `test_chat_prompt.py`, `test_chat_llm.py` (patched `completion`; never imports a real network path)
- [ ] `backend/tests/conftest.py`: a `FakeLLMClient` and a `chat_client` fixture (`make_app(llm_client=...)`, recording source, AAPL priced); a `trade_env`-based executor fixture
- [ ] `frontend/src/test/stubFetch.ts`: add `"GET /api/chat/history": { messages: [] }` to `DEFAULT_API`
- [ ] `frontend/src/components/ChatPanel.test.tsx`, a chat store test; extend `header.test.tsx` and `terminal.test.tsx` for PF-10
- [ ] `test/` project: `package.json` (exact `@playwright/test@1.64.1`), lockfile, `playwright.config.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.test.yml`, `e2e/*.spec.ts`
- [ ] Framework installs, after the one consolidated blocking legitimacy gate in 03-04 Task 1: `uv add "litellm==1.106.2" "pydantic>=2.12"` in `backend/` (03-04 Task 2); `npm --prefix test install --save-exact --save-dev @playwright/test@1.64.1` (03-05 Task 1, precondition cites the 03-04 approval)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real LLM round trip: OpenRouter accepts the structured-output schema and routes to Cerebras; "Analyze my portfolio" cites the actual cash, positions and P&L; "Buy 5 NVDA" executes and shows its chip | AI-01, AI-02, AI-03 | Needs the user's `OPENROUTER_API_KEY` and a live provider; model output is not deterministic | Set `OPENROUTER_API_KEY` in `.env` with `LLM_MOCK` unset, `docker compose up -d --build`, ask "Analyze my portfolio" and compare the figures with the header and positions table, then send "Buy 5 NVDA" and confirm the executed chip and that positions, heatmap, cash and P&L chart update within about a second |
| Full terminal layout stays usable on a tablet | UX-02 | Visual and interaction judgement at tablet widths | Open the app at about 1024×768 and 768×1024 (browser device mode), confirm every panel is reachable and usable, and that the chat panel collapses and expands |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
