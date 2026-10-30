---
phase: 03-ai-copilot-and-complete-terminal
plan: 02
subsystem: api
tags: [fastapi, chat, llm, pydantic, sqlite, prompt]

requires:
  - phase: 03-01
    provides: ChatService.handle, parse_reply, execute_actions, MockLLMClient, POST /api/chat, TestChatTracer
provides:
  - "Lenient reply parser: strip_fences, bad_lists, TradeItem/WatchlistItem strict item models"
  - "Executor rules: per-item validation, MAX_TRADES/MAX_WATCHLIST_CHANGES = 10, failure_reason, templated failure notes"
  - "prompt.py: SYSTEM_PROMPT, build_context, replay_content, build_messages"
  - "ChatService message gate (400), chat-only turn lock, 20-message prompt window, notes in stored content, history()"
  - "GET /api/chat/history returning the last 50 messages oldest first"
  - "FakeLLMClient test fixture (fake_llm) recording every messages list"
affects: [03-03, 03-04, 03-05]

actuals:
  tokens: 18200
  tasks: 2
  commits: 4
plan_head_before: 5177140f51f54d677fe0418e7810e9d9dfa612f6
plan_head_after: b40b81d89024da66c32fb24244eabc7a4de15fa4

tech-stack:
  added: []
  patterns:
    - "Two-stage reply handling: lenient envelope parse, then per-item StrictStr/StrictFloat validation before any service call"
    - "History replays content plus a plain [executed: ...] summary, never the raw actions JSON"
    - "Chat turns serialized by a chat-only asyncio.Lock; the shared state lock stays inside the services"

key-files:
  created:
    - backend/app/chat/prompt.py
    - backend/tests/test_chat_parsing.py
    - backend/tests/test_chat_actions.py
    - backend/tests/test_chat_mock.py
    - backend/tests/test_chat_prompt.py
  modified:
    - backend/app/chat/parsing.py
    - backend/app/chat/actions.py
    - backend/app/chat/service.py
    - backend/app/api/chat.py
    - backend/tests/conftest.py
    - backend/tests/test_chat_api.py

key-decisions:
  - "Failed action records echo only primitive raw fields (strings stripped and cut to 32 chars, finite non-bool numbers); everything else is null, so the JSON response never carries NaN"
  - "A trade note uses the specific 'Couldn't {side} {qty} {T}' form only when the quantity is finite and within MAX_QUANTITY, so format_qty can never overflow Decimal while building a note"
  - "The message is stored stripped; length is counted in code points on the stripped text"
  - "mock.py needed no change: every mock rule test passed against the tracer version"

patterns-established:
  - "Note template: '⚠️ Couldn't ...: {failure_reason(error)}.' with watchlist notes before trade notes"
  - "FakeLLMClient via the fake_llm fixture for any test that needs scripted LLM replies or an LLMError"

requirements-completed: [AI-01, AI-02, AI-03, AI-04, AI-05, AI-06, AI-07, AI-08, AI-09, AI-10, AI-11, TST-01]

coverage:
  - id: D1
    description: "Lenient parse: fenced/padded JSON equals bare JSON, missing/null lists are [], extra keys ignored; blank, non-JSON, non-object and missing/blank/non-string message raise ReplyParseError; non-list lists are flagged in bad_lists"
    requirement: AI-04
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_parsing.py"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestLLMFailures"
        status: pass
    human_judgment: false
  - id: D2
    description: "Executor: per-item validation, 10 + 10 caps (11th never reaches a service), idempotent adds, remove of unwatched fails, watchlist before trades, input order kept, boundaries (exact cash, 0.00004, 1.23455), add-then-buy, no-deadlock with a concurrent manual trade"
    requirement: AI-05
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_actions.py"
        status: pass
    human_judgment: false
  - id: D3
    description: "Templated failure notes, including the exact PLAN section 9 example, appended after one blank line in the stored and returned content"
    requirement: AI-08
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_actions.py#TestNotes"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestHistory::test_history_sell_entry_equals_post_response"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mock rules: word boundaries, uppercase capture, first rule wins, purity and statelessness"
    requirement: AI-10
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_mock.py"
        status: pass
    human_judgment: false
  - id: D5
    description: "Message gate: empty/whitespace and over-2,000-code-point messages are 400 with nothing stored; malformed bodies are 422; LLMError and unreadable replies are 502 with only the user row stored and no raw reply in the body"
    requirement: AI-09
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestValidation"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestLLMFailures"
        status: pass
    human_judgment: false
  - id: D6
    description: "Prompt: SYSTEM_PROMPT phrases, two system messages, context copied from PortfolioService.view(), chg_percent boundaries, 20-of-25 window oldest first, executed-action replay text with no action JSON, chat-only turn lock"
    requirement: AI-02
    verification:
      - kind: unit
        ref: "backend/tests/test_chat_prompt.py"
        status: pass
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestTurnLock"
        status: pass
    human_judgment: false
  - id: D7
    description: "GET /api/chat/history: empty list at first, last 50 of 52 oldest first, entries identical to the POST response, Unicode round trip"
    requirement: AI-11
    verification:
      - kind: integration
        ref: "backend/tests/test_chat_api.py#TestHistory"
        status: pass
    human_judgment: false
  - id: D8
    description: "Quality of real-model replies under SYSTEM_PROMPT (concise, plain text, correct share conversion, acts only on the latest request)"
    verification: []
    human_judgment: true
    rationale: "Only the prompt text is asserted; model behavior needs the real client from 03-04 and a human judging replies"

duration: 4h17m wall clock (includes a session usage-limit pause; active work about 30 min)
completed: 2026-10-30
status: complete
---

# Phase 3 Plan 02: Chat Rules, Prompt and History Summary

**Every chat reply is now safe and honest: a lenient fence-tolerant parser, per-item StrictStr/StrictFloat validation with 10 + 10 caps and a templated "⚠️ Couldn't ..." note per failed action, a 400 message gate, the real FinAlly prompt built from the live portfolio and the last 20 messages under a chat-only lock, and GET /api/chat/history serving the last 50 messages exactly as first returned**

## Performance

- **Duration:** 4h17m wall clock, including a session usage-limit pause between Task 2 RED and GREEN; active work about 30 min
- **Started:** 2026-10-29T22:26:35Z
- **Completed:** 2026-10-30T02:43:16Z
- **Tasks:** 2 (TDD, 4 commits)
- **Files modified:** 11

## Accomplishments
- `parsing.py`: `strip_fences`, `parse_reply(raw: str | None)` with `bad_lists`, and the parse-only `TradeItem` / `WatchlistItem` models (extra keys ignored)
- `actions.py`: caps by position, per-item validation, G-20 idempotent adds, independent execution in input order (watchlist first), `failure_reason`, and the note builder covering specific and generic forms
- `prompt.py` (new): `SYSTEM_PROMPT` with every AI-03 phrase, `build_context`, `replay_content` (`[executed: add PYPL; buy 5 NVDA @ $875.20]`), `build_messages`
- `service.py`: 400 gate before the 503 check and before any write, `_turn_lock`, history loaded before the user row, notes appended to stored content, `history()`; `GET /api/chat/history`
- Backend suite: 530 passed, 1 skipped (`test_main.py` without the static build); ruff check and format clean

## Task Commits

1. **Task 1 RED: parsing, action rule and mock tests** - `15d3687` (test)
2. **Task 1 GREEN: lenient parse, per-item validation, caps and failure notes** - `d66b853` (feat)
3. **Task 2 RED: prompt, message gate, history and turn-lock tests** - `65e8d32` (test)
4. **Task 2 GREEN: FinAlly prompt, message gate, chat lock, notes and history** - `b40b81d` (feat)

No REFACTOR commits were needed.

## TDD Notes
- `workflow.tdd_mode` is false, so the formal RED-evidence classifier was not required. Both RED runs failed at collection with ImportError for the symbols the plan adds (`TradeItem`, `MAX_TRADES`, `app.chat.prompt`). That shows the features were missing, but it is a collection failure rather than an assertion failure.
- `test_chat_mock.py` passed in RED (25 tests) against the tracer mock. Under the plan's "change only what the tests prove wrong", `mock.py` was left unchanged.

## Files Created/Modified
- `backend/app/chat/parsing.py` - fence stripping, lenient envelope, item models
- `backend/app/chat/actions.py` - caps, validation, execution, notes
- `backend/app/chat/prompt.py` - system prompt, context, replay, message list
- `backend/app/chat/service.py` - gate, lock, prompt assembly, notes, history
- `backend/app/api/chat.py` - `GET /api/chat/history`
- `backend/tests/conftest.py` - `FakeLLMClient` and `fake_llm` fixture
- `backend/tests/test_chat_parsing.py`, `test_chat_actions.py`, `test_chat_mock.py`, `test_chat_prompt.py` - new suites
- `backend/tests/test_chat_api.py` - `TestValidation`, `TestLLMFailures`, `TestHistory`, `TestTurnLock` added; `TestChatTracer` kept

## Decisions Made
- Failed records take raw fields only when they are primitives: strings are stripped, cut to 32 chars and case-normalized, and numbers must be finite and non-bool. A NaN or bool quantity is recorded as null.
- A trade note uses the specific form only when the quantity is finite and within `MAX_QUANTITY`. Otherwise `format_qty` could hit Decimal's 28-digit limit on an absurd value, so the generic form is used.
- A bad list adds one failed record at the head of its list (ticker/action/side/quantity null), so its note comes first within its group.
- `FakeLLMClient` is exposed through a `fake_llm` fixture because conftest says tests never import it directly.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Note builder guarded against huge quantities**
- **Found during:** Task 1 GREEN (actions.py)
- **Issue:** A model could send a quantity like 1e30. The service rejects it, but building the "Couldn't buy 1e30 ..." note with `format_qty` would raise `decimal.InvalidOperation` and turn the whole reply into a 500.
- **Fix:** The specific note form needs `abs(qty) <= MAX_QUANTITY`; anything else uses the generic form. `_number` also returns None for ints beyond float range.
- **Files modified:** backend/app/chat/actions.py
- **Verification:** full backend suite green
- **Committed in:** d66b853

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Robustness on the malformed-reply path only; no scope creep.

## Issues Encountered
- A session usage limit interrupted the run after the Task 2 RED files were written. On resume, the branch and namespace checks were re-run, and the work continued from the uncommitted RED files without redoing anything.
- `ruff check` reported an I001 import-order error on `test_chat_prompt.py` while `app.chat.prompt` did not exist yet (ruff classed it as third-party). It cleared once the module was added, with no change to the file.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 03-03 can load `GET /api/chat/history` (`{"messages": [...]}`) and reuse the error texts "Message cannot be empty." and "Message is too long (max 2,000 characters)." for its client pre-check.
- 03-04's real client plugs into the same `complete(messages)` seam. It now receives `[SYSTEM_PROMPT, context, history..., user]`, and its replies go through `parse_reply`, which already tolerates fences and missing lists.

## Self-Check: PASSED
- Created files exist: backend/app/chat/prompt.py and the four new test files.
- Commits 15d3687, d66b853, 65e8d32 and b40b81d are on this branch (4 commits since 5177140).
- All verify commands exit 0: Task 1 suites (86 with test_chat_api at that point) and the cap/idempotent/note selector (13 passed); the no-direct-SQL-write grep; the Task 2 suites (62 passed); the 400/422/502/history selector (25 passed); the system selector (15 passed); the full backend suite (530 passed, 1 skipped); ruff check and format clean; and the build_messages/history-route/no-state_lock grep.

---
*Phase: 03-ai-copilot-and-complete-terminal*
*Completed: 2026-10-30*
