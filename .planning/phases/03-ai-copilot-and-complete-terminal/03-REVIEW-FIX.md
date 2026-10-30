---
phase: 03-ai-copilot-and-complete-terminal
fixed_at: 2026-10-29T00:00:00Z
review_path: .planning/phases/03-ai-copilot-and-complete-terminal/03-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 03: Code Review Fix Report

**Fixed at:** 2026-10-29
**Source review:** .planning/phases/03-ai-copilot-and-complete-terminal/03-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (CR-01, WR-01, WR-02, WR-03, WR-04; the Info findings were out of scope)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Reset does not serialize with an in-flight chat turn

**Files modified:** `backend/app/chat/service.py`, `backend/app/api/portfolio.py`, `backend/app/main.py`, `backend/tests/test_chat_api.py`, `frontend/src/store/portfolio.ts`, `frontend/src/components/Header.tsx`, `frontend/src/components/header.test.tsx`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/ChatPanel.test.tsx`
**Commit:** 836898b
**Status:** fixed: requires human verification (concurrency logic)
**Applied fix:**
- `ChatService` exposes `turn_lock`.
- `create_portfolio_router` takes it as a required `chat_turn_lock` argument.
- `POST /api/reset` now runs `async with chat_turn_lock: await portfolio.reset()`. The lock order is turn lock, then state lock, the same order a chat turn uses, so there is no deadlock. The PLAN §8 contract is unchanged: any POST still returns 200 `{"status": "ok"}`.
- On the frontend, the portfolio store has a shared `resetting` flag (true for the POST plus the refresh). The Header uses it instead of local state. While it is true, ChatPanel disables Send, ignores Enter (the draft is kept) and hides the starter prompts.
- The false Header comment ("a reply can never land in the fresh account") is rewritten. The new comment says the client guards cover only this tab, and the server serializes reset with chat turns.
- New backend test `TestResetDuringTurn`: it gates the LLM from another thread, POSTs `/api/reset` mid-turn, and asserts that:
  - the reset waits for the turn
  - both requests return 200
  - the final account has $10,000 cash, no positions, no trades and no chat rows

  The test fails without the fix: the trade landed in the reset account.
- New frontend tests:
  - Send is disabled and the prompts are hidden while `resetting`.
  - The `resetting` flag is set and cleared, including after a failed reset.

### WR-01: Chat is cleared only after the post-reset refresh

**Files modified:** `frontend/src/store/portfolio.ts`, `frontend/src/components/Header.tsx`, `frontend/src/components/header.test.tsx`
**Commit:** a85d3ff
**Applied fix:**
- `usePortfolio.reset(onCommitted?)` calls `onCommitted` right after `POST /api/reset` succeeds and before `refresh()`.
- The Header passes a callback that clears the chat, the sparklines and the selection and starts the watchlist reload. Combined with the CR-01 `resetting` gate, no message can be sent into the window.
- New test: with `GET /api/portfolio` held open, the chat and sparklines are already empty while `resetting` is still true. It fails without the fix.

### WR-02: A send before the history load returns discards the stored conversation

**Files modified:** `frontend/src/store/chat.ts`, `frontend/src/store/chat.test.ts`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/ChatPanel.test.tsx`, `frontend/src/components/terminal.test.tsx`, `frontend/src/components/header.test.tsx`, `test/e2e/helpers.ts`
**Commit:** 2f997c5
**Status:** fixed: requires human verification (UI state logic)
**Applied fix:**
- New chat-store flag `settled`. It becomes true when the newest history load is applied or fails, and on `clear()`, so a failed load or a reset never blocks the chat forever.
- Until `settled` is true, ChatPanel disables Send, ignores Enter (the draft is kept) and hides the starter prompts.
- I used this block-until-settled option, not the merge alternative. Merging could duplicate the user message when the server stores it before it answers the history GET.
- The existing ChatPanel test "keeps the optimistic message and the reply when a stale history load resolves late" asserted the defective behavior. It was replaced by a test that asserts sends are blocked until the load settles and the stored history is then kept. A second new test checks that the prompts appear once an empty history settles.
- Store tests cover `settled` after success, failure, an invalid body, and a clear.
- The test `beforeEach` blocks reset `settled: false`.
- The E2E `sendChat` helper now waits for `chat-send` to be enabled before it presses Enter. Otherwise an early Enter would now be ignored silently.

### WR-03: `strip_fences` discards JSON that sits on the opening fence line

**Files modified:** `backend/app/chat/parsing.py`, `backend/chat_llm_spike.py`, `backend/tests/test_chat_parsing.py`
**Commit:** 23dccf9
**Applied fix:**
- `strip_fences` now drops only the opening fence, optional spaces, and an optional language tag (`[A-Za-z0-9_+-]*`). It no longer drops the whole first line.
- The spike's drifted `strip_fence` copy was removed. It now imports `strip_fences` from `app.chat.parsing`.
- Nine new parser cases: a single-line fence with or without a tag, a tag glued to the payload, JSON on the opening fence line, a spaced uppercase tag, CRLF line endings, no closing fence, and a single-line fenced reply through `parse_reply`. Six of these fail against the old code.

### WR-04: A failure after the actions run returns a bare 500 and leaves the UI stale

**Files modified:** `backend/app/chat/service.py`, `backend/tests/test_chat_api.py`, `frontend/src/store/chat.ts`, `frontend/src/store/chat.test.ts`, `frontend/src/components/ChatPanel.tsx`, `frontend/src/components/ChatPanel.test.tsx`
**Commit:** 9616a29
**Status:** fixed: requires human verification (error-path logic)
**Applied fix:**
- Backend:
  - The assistant row is built first (`_new_row`) and written with `_write` inside a try/except. If the write fails, the service logs `Chat: actions ran but the assistant message was not stored` and still returns the row, with the executed actions, as a 200.
  - `_insert` keeps its behavior for the user row.
  - New test: a fake `_write` fails only for the assistant row. The test asserts that the executed trade is returned and that the position exists.
  - Caveat: this test does not run against the pre-fix code, because `_write` did not exist then.
- Frontend:
  - `useChat.send` now resolves a `SendResult`: `skipped`, `reply`, or `failed` with `mayHaveActed`. `mayHaveActed` is true for a 5xx or a network error.
  - ChatPanel refreshes the portfolio and the watchlist after a reply with actions, and also after a failure that may have run actions.
  - Store and panel tests updated. New tests cover the 400, 500 and network cases and check that a 500 triggers a refresh and a 400 does not.

## Verification

- Gates ran before each commit in the isolated worktree (`.claude/worktrees/rf-03-...`, with its own `npm ci` and `uv sync`). The final run was in the **main checkout** after the fast-forward, on `finally-gsd` at 9616a29:
  - backend `uv run --directory backend --extra dev pytest -q`: 577 passed
  - `ruff check .`: passed
  - `ruff format --check .`: 65 files already formatted
  - frontend `npx vitest run`: 18 files, 328 tests passed
  - `npm run lint`: clean
  - `npm run typecheck` (`next typegen && tsc --noEmit`): clean
- In the fresh worktree, a bare `npx tsc --noEmit` first failed on `src/app/layout.tsx` (`LayoutProps`), a file this run did not touch. The cause was missing Next-generated route types. Running `next typegen` (the project's `typecheck` script) fixed it, so it was an environment issue, not a code defect.
- Playwright E2E was not run. `test/e2e/helpers.ts` changed (WR-02), so run the E2E suite before the phase is signed off.
- Cleanup: the fast-forward to `finally-gsd` succeeded. The worktree was removed, the temp branch `gsd-reviewfix/03-1876` was deleted, and the recovery sentinel was removed.

---

_Fixed: 2026-10-29_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
