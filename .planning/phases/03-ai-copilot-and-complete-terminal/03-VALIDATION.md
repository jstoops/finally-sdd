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
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Filled in from the PLAN.md files once planning completes. Requirement → test map: see `03-RESEARCH.md` § Validation Architecture.*

---

## Wave 0 Requirements

- [ ] `backend/tests/test_chat_parsing.py`, `test_chat_actions.py`, `test_chat_mock.py`, `test_chat_api.py`, `test_chat_prompt.py`, `test_chat_llm.py` (patched `completion`; never imports a real network path)
- [ ] `backend/tests/conftest.py`: a `FakeLLMClient` and a `chat_client` fixture (`make_app(llm_client=...)`, recording source, AAPL priced); a `trade_env`-based executor fixture
- [ ] `frontend/src/test/stubFetch.ts`: add `"GET /api/chat/history": { messages: [] }` to `DEFAULT_API`
- [ ] `frontend/src/components/ChatPanel.test.tsx`, a chat store test; extend `header.test.tsx` and `terminal.test.tsx` for PF-10
- [ ] `test/` project: `package.json` (exact `@playwright/test@1.64.1`), lockfile, `playwright.config.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.test.yml`, `e2e/*.spec.ts`
- [ ] Framework installs, each after a human-verify checkpoint: `uv add "litellm==1.106.2" "pydantic>=2.12"` in `backend/`; `npm install --save-exact --save-dev @playwright/test@1.64.1` in `test/`

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
