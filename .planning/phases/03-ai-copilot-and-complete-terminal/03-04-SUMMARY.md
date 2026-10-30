---
phase: 03-ai-copilot-and-complete-terminal
plan: 04
subsystem: api, llm, infra
tags: [litellm, openrouter, cerebras, pydantic, structured-outputs, fastapi, docker]

requires:
  - phase: 03-01
    provides: "LLMClient seam returning raw text, LLMError, MockLLMClient, ChatService 502/503 mapping, create_app(llm_client=...), Settings.llm_mock"
provides:
  - "Package and image legitimacy approval for all of Phase 3 (litellm 1.106.2, pydantic>=2.12, @playwright/test 1.64.1, mcr.microsoft.com/playwright:v1.64.1-noble)"
  - "litellm==1.106.2 and pydantic>=2.12 declared in backend/pyproject.toml and locked in backend/uv.lock"
  - "Strict LLMReply / LLMTrade / LLMWatchlistChange schema sent to the model"
  - "OpenRouterLLMClient: lazy litellm import in warm(), completion in asyncio.to_thread, Cerebras-only routing, injectable completion"
  - "create_llm_client(settings): mock, then OpenRouter, else None"
  - "Settings.openrouter_api_key with repr=False"
  - "Lifespan warm-up of the real client; Dockerfile ENV LITELLM_LOCAL_MODEL_COST_MAP=True"
  - "backend/chat_llm_spike.py, the human-run live call"
affects: [03-02, 03-05]

actuals:
  tokens: 113800  # chars/4 over the realized diff, including 422k chars of uv.lock; hand-written files alone are about 8,200
  tasks: 3
  commits: 4
plan_head_before: 5177140f51f54d677fe0418e7810e9d9dfa612f6
plan_head_after: 3ebc02d00443fcde2560f5a2e0178b9cd9a5c17c

tech-stack:
  added: ["litellm 1.106.2 (plus 42 transitive packages; click 8.3.1 -> 8.5.0)", "pydantic >=2.12 (already locked at 2.12.5, now direct)"]
  patterns:
    - "Heavy SDKs are imported lazily inside a warm() method that runs in a worker thread, never at module level"
    - "Blocking LLM completion runs in asyncio.to_thread; the completion callable is a constructor seam so tests never import the SDK"
    - "Provider exceptions become LLMError carrying only the exception type name"
    - "Env-driven client factory mirrors app.market.factory: mock before key, else None"

key-files:
  created:
    - backend/app/chat/factory.py
    - backend/chat_llm_spike.py
    - backend/tests/test_chat_llm.py
    - backend/tests/test_chat_config.py
  modified:
    - backend/pyproject.toml
    - backend/uv.lock
    - backend/app/chat/llm.py
    - backend/app/chat/__init__.py
    - backend/app/config.py
    - backend/app/main.py
    - Dockerfile

key-decisions:
  - "Phase 3 legitimacy gate approved by the user on 2026-10-29 for exactly: PyPI litellm==1.106.2 (BerriAI/litellm), PyPI pydantic>=2.12 (2.12.5 locked), npm @playwright/test 1.64.1 (microsoft/playwright), image mcr.microsoft.com/playwright:v1.64.1-noble"
  - "EXTRA_BODY extends the skill's provider.order with require_parameters: True and allow_fallbacks: False, so a Cerebras outage is a clean 502 instead of a schema-ignoring fallback (A-16; to be confirmed by the spike)"
  - "Client selection keeps 03-01's explicit 'is not None' override check rather than 'or', so a falsy client object can never be skipped"
  - "The real-call spike is an end-of-phase human check (human_verify_mode end-of-phase, A-20); no automated test reaches OpenRouter"

patterns-established:
  - "Lazy heavy import: warm() sets LITELLM_LOCAL_MODEL_COST_MAP before importing litellm and is called via asyncio.to_thread from lifespan"
  - "Secret settings use field(repr=False); logs carry mode names and exception type names only"

requirements-completed: [AI-01, AI-09]

coverage:
  - id: D1
    description: "Legitimacy gate: the user approved litellm 1.106.2, pydantic>=2.12, @playwright/test 1.64.1 and mcr.microsoft.com/playwright:v1.64.1-noble before any install"
    verification: []
    human_judgment: true
    rationale: "Package legitimacy is a human trust decision; recorded here from the user's 'approved' reply on 2026-10-29"
  - id: D2
    description: "litellm pinned at 1.106.2 in pyproject.toml and uv.lock, no 1.82.7/1.82.8 entry, lockfile current, full suite green after the click bump"
    requirement: AI-01
    verification:
      - kind: other
        ref: "grep -A1 'name = \"litellm\"' backend/uv.lock (1.106.2, no 1.82.[78]) && grep '\"litellm==1.106.2\"' backend/pyproject.toml && uv lock --directory backend --check"
        status: pass
      - kind: unit
        ref: "uv run --directory backend --extra dev pytest -q (426 passed, 1 skipped)"
        status: pass
    human_judgment: false
  - id: D3
    description: "OpenRouterLLMClient sends model, messages, response_format LLMReply, reasoning_effort low, EXTRA_BODY, api_key and timeout on a worker thread; None content gives ''; provider errors become LLMError with no detail or key"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_llm.py#TestOpenRouterClient"
        status: pass
    human_judgment: false
  - id: D4
    description: "A client returning None content answers 502 LLM_BAD_REPLY with only the user row stored; a provider error answers 502 LLM_CALL_FAILED without the key"
    requirement: AI-01
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_llm.py#TestChatEndpointWithClient"
        status: pass
    human_judgment: false
  - id: D5
    description: "LLMReply schema is strict-mode safe: every object closed and fully required, no rejected keyword, under 5,000 characters"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_llm.py#TestSchema"
        status: pass
    human_judgment: false
  - id: D6
    description: "A blocked completion does not block the event loop, and two concurrent complete() calls both run off the loop thread"
    requirement: AI-01
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_llm.py#TestLoop"
        status: pass
    human_judgment: false
  - id: D7
    description: "Settings and selection: LLM_MOCK and OPENROUTER_API_KEY parsing, key hidden from repr, mock before key, OpenRouter with a key, None without"
    requirement: AI-09
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_config.py#TestSettingsFromEnv"
        status: pass
      - kind: unit
        ref: "backend/tests/test_chat_config.py#TestCreateLLMClient"
        status: pass
    human_judgment: false
  - id: D8
    description: "No key and no mock: app starts, /api/health 200, POST /api/chat 503 with the PLAN text and nothing stored, also for two concurrent posts; mock without key answers 200"
    requirement: AI-09
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_config.py#TestUnconfigured"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_config.py#TestMockMode"
        status: pass
    human_judgment: false
  - id: D9
    description: "litellm is never imported in mock or unconfigured mode (fresh interpreter); lifespan warms the real client once, a warm failure is logged and the app serves; the key is never logged"
    requirement: AI-09
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_config.py#TestNoLitellmImport"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_config.py#TestWarmUp"
        status: pass
    human_judgment: false
  - id: D10
    description: "Live spike: with a real key, chat_llm_spike.py gets a strict structured reply from OpenRouter -> Cerebras (buy AAPL, add PYPL); closes the STATE.md Phase 3 blocker"
    requirement: AI-01
    verification:
      - kind: manual_procedural
        ref: "uv run --directory backend python chat_llm_spike.py (with OPENROUTER_API_KEY in the repo-root .env)"
        status: unknown
    human_judgment: true
    rationale: "Needs the user's real OpenRouter key and a paid call, which no automated test or agent may make; the plan collects it as an end-of-phase human check"

duration: 7min
completed: 2026-10-29
status: complete
---

# Phase 3 Plan 04: Real LLM Client Summary

**`OpenRouterLLMClient` per the cerebras-inference skill (litellm 1.106.2, lazy import and completion in a worker thread, strict `LLMReply` schema, Cerebras-only routing), chosen by `create_llm_client` after the mock when `OPENROUTER_API_KEY` is set, with a lifespan warm-up, a 503 when unconfigured, and a human-run live spike script**

## Package Legitimacy Approval (Task 1, read by plan 03-05's precondition)

- **Approved by:** the user, reply "approved" to the Task 1 `checkpoint:human-verify` (`gate="blocking-human"`)
- **Date:** 2026-10-29
- **Approved exactly as presented, nothing removed:**

| # | Registry | Package or image | Approved version | Publisher / repo | Installed by |
|---|----------|------------------|------------------|------------------|--------------|
| 1 | PyPI | `litellm` | `==1.106.2` (exact pin) | BerriAI/litellm | 03-04 Task 2 (done) |
| 2 | PyPI | `pydantic` | `>=2.12` (2.12.5 already locked; now a direct dependency) | pydantic | 03-04 Task 2 (done) |
| 3 | npm | `@playwright/test` | `1.64.1` (exact pin) | microsoft/playwright | 03-05 |
| 4 | Container image | `mcr.microsoft.com/playwright` | `v1.64.1-noble` | Microsoft (MCR) | 03-05 |

No other package or image is approved for Phase 3. `backend/uv.lock` contains litellm 1.106.2 only, with no 1.82.7 or 1.82.8 entry.

## Performance

- **Duration:** 7 min (this continuation; the earlier executor stopped at the Task 1 gate)
- **Started:** 2026-10-30T02:41:42Z
- **Completed:** 2026-10-30T02:48:24Z
- **Tasks:** 3 of 3 (Task 1 gate approved, Tasks 2 and 3 implemented)
- **Files modified:** 11

## Accomplishments
- litellm 1.106.2 and pydantic declared and locked (40 to 82 packages, click 8.3.1 to 8.5.0); the full backend suite stays green after the bump
- `LLMReply` strict schema; checked separately that litellm's own `type_to_response_format_param(LLMReply)` output is strict-mode safe (1,304 characters, `strict: true`, closed objects, all required)
- `OpenRouterLLMClient`: lazy import in `warm()` with `LITELLM_LOCAL_MODEL_COST_MAP` set first, completion in `asyncio.to_thread`, `''` on `None` content, `LLMError(type name)` on any failure
- `create_llm_client`, the `openrouter_api_key` setting (hidden from repr), the chat-mode log line, the lifespan warm-up and the Dockerfile ENV
- `backend/chat_llm_spike.py`: exits 2 without a key (verified), 0 on a valid structured reply, 1 on failure, with the key redacted

## Task Commits

1. **Task 1: Package and image legitimacy gate** - no commit (approval only, recorded above)
2. **Task 2: OpenRouter client, strict schema, spike** - `b2772d9` (test, RED), `3eb63b4` (feat, GREEN)
3. **Task 3: Real-mode wiring** - `4f79f58` (test, RED), `3ebc02d` (feat, GREEN)

## Files Created/Modified
- `backend/pyproject.toml`, `backend/uv.lock` - litellm pin, pydantic direct dependency
- `backend/app/chat/llm.py` - `MODEL`, `EXTRA_BODY`, `LLM_TIMEOUT`, the three schema models, `OpenRouterLLMClient`
- `backend/app/chat/factory.py` - `create_llm_client`
- `backend/app/chat/__init__.py` - exports `LLMReply`, `OpenRouterLLMClient`, `create_llm_client`
- `backend/app/config.py` - `openrouter_api_key` with `repr=False`, docstring updated
- `backend/app/main.py` - factory selection, `_chat_mode` log, lifespan warm-up
- `Dockerfile` - `LITELLM_LOCAL_MODEL_COST_MAP=True` in the runtime ENV
- `backend/chat_llm_spike.py` - human-run live check
- `backend/tests/test_chat_llm.py` - 15 tests (client, 502 paths, schema, event loop)
- `backend/tests/test_chat_config.py` - 19 tests (settings, factory, 503, no litellm import, warm-up, no key in logs)

## Decisions Made
- `EXTRA_BODY = {"provider": {"order": ["cerebras"], "require_parameters": True, "allow_fallbacks": False}}` as planned (A-16). The spike confirms or adjusts it.
- Confirmed against the installed litellm 1.106.2 that `completion` names `api_key`, `timeout`, `response_format` and `reasoning_effort` as parameters (A-17); `extra_body` goes through `**kwargs`, as in the skill snippet.
- `main.py` uses `llm_client if llm_client is not None else create_llm_client(settings)` instead of the plan's `llm_client or ...`, to keep the 03-01 decision that a falsy client is never skipped. The plan's grep (`create_llm_client(settings)`) still matches.
- `OpenRouterLLMClient.__repr__` shows only the model, as an extra guard against the key leaking through a logged object.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `Settings.openrouter_api_key` added in Task 2 instead of Task 3**
- **Found during:** Task 2 (spike script)
- **Issue:** The spike must read the key from `Settings.from_env()` and exit 2 without one (a Task 2 acceptance criterion), but the field was scheduled for Task 3.
- **Fix:** Added the field (`repr=False`, read from `_env("OPENROUTER_API_KEY")`) and the docstring change in the Task 2 commit. Task 3's tests cover it.
- **Files modified:** backend/app/config.py
- **Verification:** the spike exits 2 with an empty key; `TestSettingsFromEnv` passes
- **Committed in:** 3eb63b4

**2. [Rule 1 - Bug] Import-order lint error in the Task 3 RED commit**
- **Found during:** Task 3 RED commit
- **Issue:** `ruff check` flagged I001 in `test_chat_config.py`. The commit command did not stop on the lint failure, so the RED commit carries it.
- **Fix:** Fixed with `ruff check --fix` / `ruff format` in the Task 3 GREEN commit; ruff is clean at HEAD.
- **Files modified:** backend/tests/test_chat_config.py
- **Committed in:** 3ebc02d

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Task ordering and lint only; no scope change.

## TDD Notes
- `workflow.tdd_mode` is false, so the strict RED-evidence gate does not apply. Both RED runs failed at collection (`ImportError` for `LLMReply`, `ModuleNotFoundError` for `app.chat.factory`), because the tests import symbols that did not exist yet, not on an assertion. The test commits come before each feature commit; GREEN passed 15/15 and 19/19.

## Issues Encountered
- The worktree's git dir is under the main repo's `.git/worktrees/`, and the sandbox did not allow writing the plan-ledger file there. The base `5177140` from the dispatch is recorded as `plan_head_before`, and `commits: 4` was measured with `git rev-list --count 5177140..HEAD`.
- `.planning/WINDOWS.md` does not exist, so the pending spike check is not in a ledger. It is coverage item D10 here.

## Pending Human Check (end of phase)
With `OPENROUTER_API_KEY` in the repo-root `.env`, run `uv run --directory backend python chat_llm_spike.py`. Expect exit 0, the raw JSON printed, and a parsed reply whose trades include a buy of AAPL and whose watchlist changes include an add of PYPL. If it exits 1 with a provider or schema error, adjust only `EXTRA_BODY` or the `LLMReply` models in `backend/app/chat/llm.py`. This closes the STATE.md Phase 3 blocker ("Cerebras strict-schema acceptance and OpenRouter provider fallback are unverified"). It was not run here: it needs the real key and makes a paid call.

## User Setup Required
To use real chat, put `OPENROUTER_API_KEY` in the repo-root `.env` (from openrouter.ai/settings/keys). Mock mode, the tests and E2E do not need it.

## Next Phase Readiness
- 03-05 may install `@playwright/test` 1.64.1 and use `mcr.microsoft.com/playwright:v1.64.1-noble`. Both are approved above.
- 03-02 changes `service.py`, `parsing.py` and the prompt behind the same `LLMClient.complete(messages)` seam. Nothing here depends on those changes.
- Only blocker: the live spike human check above.

## Self-Check: PASSED
- Created files exist: backend/app/chat/factory.py, backend/chat_llm_spike.py, backend/tests/test_chat_llm.py, backend/tests/test_chat_config.py
- Commits b2772d9, 3eb63b4, 4f79f58 and 3ebc02d are ancestors of HEAD
- Verify commands all exit 0: test_chat_llm.py 15 passed; lockfile grep and `uv lock --check`; full backend suite 426 passed, 1 skipped; `ruff check app tests` clean; `ruff format --check app tests chat_llm_spike.py` clean; test_chat_config.py 19 passed; Dockerfile, config and main greps pass
- litellm is imported only at backend/app/chat/llm.py inside `warm()`

---
*Phase: 03-ai-copilot-and-complete-terminal*
*Completed: 2026-10-29*
