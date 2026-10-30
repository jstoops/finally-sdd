---
phase: 03-ai-copilot-and-complete-terminal
plan: 01
subsystem: api, ui
tags: [fastapi, chat, llm-mock, zustand, react, sqlite]

requires:
  - phase: 02
    provides: TradeService.execute and WatchlistService.add/remove (shared trade rules, lock, tracker), chat_messages table, usePortfolio.refresh and useWatchlist.loadWatchlist
provides:
  - "Settings.llm_mock (LLM_MOCK=true, any case) and create_app(llm_client=...) test seam"
  - "ChatUnavailableError (503) and LLMFailedError (502) in the error envelope"
  - "backend/app/chat package: LLMClient protocol + LLMError, MockLLMClient (PLAN section 9 rules), parse_reply, execute_actions, ChatService"
  - "POST /api/chat returning the stored assistant row {id, role, content, actions, created_at}"
  - "Frozen chat wire types in frontend/src/api/types.ts"
  - "useChat store (entries, pending, send) and ChatPanel mounted in the terminal chat slot"
affects: [03-02, 03-03, 03-04, 03-05]

actuals:
  tokens: 11700
  tasks: 1
  commits: 2
plan_head_before: 45197b0b0988639f8c2b1f052dcdf4622ffb22d6
plan_head_after: 24d9f9293b674e22512aece3e8faacacda439492

tech-stack:
  added: []
  patterns:
    - "LLM clients return raw reply text; mock, real and fake replies share one parse/execute/store path"
    - "Chat executor calls the existing services per action and records executed/failed independently; it never takes the shared lock"
    - "Chat component bridges stores: a reply with non-null actions triggers usePortfolio.refresh() and useWatchlist.loadWatchlist()"

key-files:
  created:
    - backend/app/chat/__init__.py
    - backend/app/chat/llm.py
    - backend/app/chat/mock.py
    - backend/app/chat/parsing.py
    - backend/app/chat/actions.py
    - backend/app/chat/service.py
    - backend/app/api/chat.py
    - backend/tests/test_chat_api.py
    - frontend/src/store/chat.ts
    - frontend/src/components/ChatPanel.tsx
  modified:
    - backend/app/config.py
    - backend/app/errors.py
    - backend/app/main.py
    - backend/app/api/__init__.py
    - frontend/src/api/types.ts
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx

key-decisions:
  - "LLM client is chosen once in create_app: explicit llm_client override, else MockLLMClient when settings.llm_mock, else None (503, stores nothing)"
  - "Tracer sends the LLM only the user message; 03-02 adds the system prompt, portfolio context and history behind the same complete(messages) call"
  - "parse_reply raises (502) for a non-list trades/watchlist_changes value in the tracer; 03-02 turns that into a failed action"
  - "Non-dict action items are treated as empty and fail through the service rules or the broad handler until 03-02 adds per-item validation"

patterns-established:
  - "Chat errors: ChatService alone raises ChatUnavailableError/LLMFailedError; the executor catches every DomainError from services as a failed action"
  - "Stored chat row and POST response are the same dict (actions kept as the dict, JSON text in SQLite)"

requirements-completed: [AI-01, AI-05, AI-10, AI-13, AI-15]

coverage:
  - id: D1
    description: "POST /api/chat in LLM_MOCK mode: 'buy' executes 1 AAPL through TradeService, returns and stores the PLAN section 8 assistant row; user row stored first with NULL actions"
    requirement: AI-01
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestChatTracer::test_buy_executes_trade_and_returns_stored_reply"
        status: pass
    human_judgment: false
  - id: D2
    description: "Mock rules through the shared path: greeting gives null actions; a failing sell is recorded as failed with the service error and still returns 200"
    requirement: AI-10
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestChatTracer::test_greeting_has_null_actions"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestChatTracer::test_failed_sell_is_recorded_and_still_200"
        status: pass
    human_judgment: false
  - id: D3
    description: "Actions run through WatchlistService/TradeService with independent executed/failed records (AI-05)"
    requirement: AI-05
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestChatTracer"
        status: pass
    human_judgment: false
  - id: D4
    description: "Non-string message is 422; an unconfigured app returns 503 with the PLAN section 5 text and stores nothing"
    requirement: AI-01
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestChatTracer::test_unconfigured_app_returns_503_and_stores_nothing"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestChatTracer::test_non_string_message_is_422"
        status: pass
    human_judgment: false
  - id: D5
    description: "Chat panel: Send posts {message}, shows the reply and an executed chip 'BUY 1 AAPL @ $190.52', failed chips are text-down, content renders literally"
    requirement: AI-13
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#sends a chat message and refetches after actions"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#renders a failed action distinctly and assistant text literally"
        status: pass
    human_judgment: false
  - id: D6
    description: "A reply with actions refetches /api/portfolio, /api/trades, /api/portfolio/history and /api/watchlist; a null-actions reply refetches nothing"
    requirement: AI-15
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#sends a chat message and refetches after actions"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#a reply without actions triggers no refetch"
        status: pass
    human_judgment: false
  - id: D7
    description: "Chat panel look and feel in the real terminal (bubbles, chips, purple Send) at desktop width"
    verification: []
    human_judgment: true
    rationale: "Visual styling is not asserted by tests; plan 03-03 completes the panel UX and is the natural point for visual UAT"

duration: 6min
completed: 2026-10-29
status: complete
---

# Phase 3 Plan 01: Chat Tracer Summary

**Mock-mode chat tracer end to end: POST /api/chat runs MockLLMClient raw JSON through parse_reply and execute_actions into the existing TradeService, stores both chat rows, and the new ChatPanel shows the reply with an action chip and refetches the portfolio and watchlist**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-29T22:15:59Z
- **Completed:** 2026-10-29T22:22:08Z
- **Tasks:** 1 (tracer, staged in 2 commits)
- **Files modified:** 17

## Accomplishments
- `backend/app/chat/` package: `LLMClient` seam returning raw text, `MockLLMClient` with the PLAN section 9 rules, `parse_reply`, `execute_actions` (watchlist first, then trades, each independent, via the existing services), and `ChatService` (503 before any write, user row stored before the LLM call, 502 on LLM or parse failure with the user row kept, assistant row stored and returned)
- `POST /api/chat` with a `StrictStr` body, wired before the `/api` JSON 404; `Settings.llm_mock` and `create_app(llm_client=...)`; new 503/502 domain errors
- Frozen chat wire types, `useChat` store, and `ChatPanel` (plain-text bubbles, executed/failed chips, purple Send) replacing the Phase 3 placeholder in the terminal

## Task Commits

1. **Task 1 Stage A: chat tracer server path** - `41d74d3` (feat)
2. **Task 1 Stage B: chat tracer panel path** - `24d9f92` (feat)

Stage C (tracer feedback gate) re-ran all six `<verify>` commands green with no fixes needed, so no `fix(03-01)` commit.

## Files Created/Modified
- `backend/app/config.py` - `llm_mock` setting from `LLM_MOCK`
- `backend/app/errors.py` - `ChatUnavailableError` (503), `LLMFailedError` (502), registered handlers
- `backend/app/chat/llm.py` - `LLMClient` protocol, `LLMError`
- `backend/app/chat/mock.py` - `GREETING`, `mock_reply`, `MockLLMClient`
- `backend/app/chat/parsing.py` - `ParsedReply`, `ReplyParseError`, `parse_reply`
- `backend/app/chat/actions.py` - `ActionOutcome`, `execute_actions`
- `backend/app/chat/service.py` - `ChatService`, `NOT_CONFIGURED`, `LLM_CALL_FAILED`, `LLM_BAD_REPLY`
- `backend/app/chat/__init__.py` - package exports
- `backend/app/api/chat.py`, `backend/app/api/__init__.py` - `ChatRequest`, `create_chat_router`
- `backend/app/main.py` - client selection, `ChatService` wiring, `app.state.chat_service`, router order
- `backend/tests/test_chat_api.py` - `TestChatTracer` (5 tests)
- `frontend/src/api/types.ts` - chat wire types
- `frontend/src/store/chat.ts` - `useChat`, `ChatEntry`
- `frontend/src/components/ChatPanel.tsx` - the panel
- `frontend/src/components/Terminal.tsx` - mounts `ChatPanel`, removes `ComingSoon`
- `frontend/src/components/terminal.test.tsx` - panel assertion updated, chat store reset, 4 chat tests

## Decisions Made
- Client selection uses explicit `is None` checks (override, then mock, then none) rather than `or`, so a falsy-but-valid client object can never be skipped.
- The panel clears the input as the request is sent (the optimistic user bubble keeps the text visible).
- Beyond the two required terminal tests, added a failed-chip/literal-markup test (T-03-02) and a 503 error-alert test, since both behaviors are must-have truths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Non-dict action items guarded in the executor**
- **Found during:** Task 1 Stage A (actions.py)
- **Issue:** `item.get(...)` outside the per-action try block would raise `AttributeError` for a non-object item (e.g. a string in `trades`), escaping as a 500 and skipping the remaining actions, contrary to AI-05 independence.
- **Fix:** Treat a non-dict item as `{}`; the service rules or the broad handler then record it as failed. Plan 03-02 replaces this with per-item validation.
- **Files modified:** backend/app/chat/actions.py
- **Verification:** full backend suite green
- **Committed in:** 41d74d3

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Robustness only on the malformed-reply path; no scope creep.

## Issues Encountered
- The plan's baseline note expected 388 backend tests; the worktree ran 392 passed + 1 skipped before the frontend build (the skip is `test_main.py` needing `frontend/out`) and 393 passed after the static build.

## User Setup Required
None - mock mode needs no API key.

## Next Phase Readiness
- 03-02 can add caps, failure notes, per-item validation, prompt/history and `GET /api/chat/history` behind the same `ChatService.handle` and `execute_actions` seams.
- 03-03 should add `"GET /api/chat/history": { messages: [] }` to `DEFAULT_API` in `stubFetch.ts` when the panel starts loading history (RESEARCH Pitfall 11).

## Self-Check: PASSED
- All 10 created files exist; commits 41d74d3 and 24d9f92 are ancestors of HEAD.
- Verify 1-6 all exit 0 (TestChatTracer 5 passed; terminal tests 46 passed; backend 393 passed, ruff clean; frontend 259 tests, lint, typecheck, build green; delegation/order greps pass; no raw-HTML sink, chip hook present, no dependency file changed since c1ccc90).
- Stage A commit touches no file under `frontend/`; Stage A subject precedes Stage B subject in `git log`.

---
*Phase: 03-ai-copilot-and-complete-terminal*
*Completed: 2026-10-29*
