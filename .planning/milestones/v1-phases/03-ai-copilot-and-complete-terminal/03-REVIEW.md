---
phase: 03-ai-copilot-and-complete-terminal
reviewed: 2026-10-29T00:00:00Z
depth: standard
files_reviewed: 51
files_reviewed_list:
  - backend/app/api/__init__.py
  - backend/app/api/chat.py
  - backend/app/chat/__init__.py
  - backend/app/chat/actions.py
  - backend/app/chat/factory.py
  - backend/app/chat/llm.py
  - backend/app/chat/mock.py
  - backend/app/chat/parsing.py
  - backend/app/chat/prompt.py
  - backend/app/chat/service.py
  - backend/app/config.py
  - backend/app/errors.py
  - backend/app/main.py
  - backend/chat_llm_spike.py
  - backend/pyproject.toml
  - backend/tests/conftest.py
  - backend/tests/test_chat_actions.py
  - backend/tests/test_chat_api.py
  - backend/tests/test_chat_config.py
  - backend/tests/test_chat_llm.py
  - backend/tests/test_chat_mock.py
  - backend/tests/test_chat_parsing.py
  - backend/tests/test_chat_prompt.py
  - backend/tests/test_reset.py
  - Dockerfile
  - frontend/src/api/types.ts
  - frontend/src/components/ChatPanel.test.tsx
  - frontend/src/components/ChatPanel.tsx
  - frontend/src/components/header.test.tsx
  - frontend/src/components/Header.tsx
  - frontend/src/components/PnlChart.test.tsx
  - frontend/src/components/PnlChart.tsx
  - frontend/src/components/terminal.test.tsx
  - frontend/src/components/Terminal.tsx
  - frontend/src/store/chat.test.ts
  - frontend/src/store/chat.ts
  - frontend/src/store/prices.ts
  - frontend/src/store/watchlist.ts
  - frontend/src/test/stubFetch.ts
  - test/.dockerignore
  - test/docker-compose.test.yml
  - test/Dockerfile
  - test/e2e/chat.spec.ts
  - test/e2e/fresh-start.spec.ts
  - test/e2e/helpers.ts
  - test/e2e/portfolio.spec.ts
  - test/e2e/reset.spec.ts
  - test/e2e/trading.spec.ts
  - test/e2e/watchlist.spec.ts
  - test/package.json
  - test/playwright.config.ts
findings:
  critical: 1
  warning: 4
  info: 7
  total: 12
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-10-29
**Depth:** standard
**Files Reviewed:** 51
**Status:** issues_found

## Summary

I reviewed the chat backend (router, service, parser, executor, prompt builder, mock and OpenRouter clients, factory, config and error wiring), the frontend chat store, ChatPanel, the Header reset changes, the Terminal layout, and the Playwright E2E infrastructure. I also traced the services the chat executor calls (`TradeService`, `WatchlistService`, `PortfolioService.reset`) and the frontend `apiFetch` and portfolio store, to check behavior across those boundaries.

The per-action parsing and execution are careful. Items are validated one at a time, NaN and bool are rejected, failure notes are templated, the API key never reaches a log or `repr`, and content renders as plain text, so there is no XSS. The main defect is concurrency between a chat turn and a reset. The server does not serialize the two. The frontend guard only works in one direction, so the code comment "a reply can never land in the fresh account" is false. Smaller defects:
- a race in which a quick first send throws away the stored chat history
- a fence stripper that deletes JSON written on the fence line
- failures after the actions have run, which leave the UI stale

Test files were checked for reliability: no skipped or `.only` tests, and the timing-based tests are bounded.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Reset does not serialize with an in-flight chat turn, so pre-reset LLM actions execute on the freshly reset account

**File:** `backend/app/chat/service.py:79-101`, `backend/app/portfolio.py:107-117`, `frontend/src/components/Header.tsx:72-104`
**Issue:** `ChatService.handle` serializes turns with its own `_turn_lock`. It takes the shared state lock only inside each service call. `PortfolioService.reset` takes only the state lock. A reset can therefore commit between the moment a turn stores the user message and builds the context (line 82-86) and the moment it runs the actions and stores the assistant row (lines 97-101). The LLM call runs between those two points and takes 1-30 s. When that happens:
- `reset` deletes the turn's user message (`RESET_TABLES` includes `chat_messages`).
- The reply's trades and watchlist changes, which the model chose from the pre-reset portfolio context, then run against the new $10,000 account.
- An orphan assistant message is inserted into the "cleared" chat history.

The frontend guard does not prevent this:
- It only disables Reset while *this tab's* chat is pending. It does not cover a second tab, a direct `POST /api/reset`, or the reverse order.
- Chat Send is not disabled while a reset is in flight.
- After reset, `useChat.clear()` bumps `clears`, so the stale reply is dropped from the chat UI. `ChatPanel.submit` still refreshes the portfolio (`reply?.actions`). The user sees positions appear on the "fresh" account with no visible chat explaining them.

This breaks the PLAN §8 reset contract and the core value that "every number stays correct". The Header comment (lines 72-74) states the opposite.
**Fix:** Serialize reset with chat turns on the server. Use the same lock order as a chat turn (turn lock first, then the state lock), so the change cannot deadlock:
```python
# chat/service.py
@property
def turn_lock(self) -> asyncio.Lock:
    return self._turn_lock

# api/portfolio.py (reset route) -- pass chat_service.turn_lock into the router factory
@router.post("/api/reset")
async def reset() -> dict:
    async with chat_turn_lock:      # waits for any in-flight turn to finish
        await portfolio.reset()     # takes the state lock inside
    return {"status": "ok"}
```
Also disable chat Send while a reset is in flight (see WR-01). Add a test that gates the LLM client, POSTs `/api/reset` mid-turn, and asserts that no trade lands in the reset account.

## Warnings

### WR-01: Chat is cleared only after the post-reset refresh, so a message sent during the reset is wiped from the UI

**File:** `frontend/src/components/Header.tsx:89-97`, `frontend/src/store/portfolio.ts:199-207`
**Issue:** `usePortfolio.reset()` awaits `POST /api/reset` and then awaits `refresh()` (three GETs). Only after that does Header call `useChat.getState().clear()`. During that whole window the chat input and Send stay enabled. A message sent then is shown optimistically and stored by the server. `clear()` then erases it from the panel and bumps `clears`, so its reply is silently dropped too. Both messages come back on the next page load, so the UI and the server disagree.
**Fix:** Clear the chat as soon as the `POST /api/reset` succeeds, before `refresh()`. Also expose a `resetting` flag and disable chat Send and the starter prompts while it is true:
```ts
const err = await usePortfolio.getState().reset({ onCommitted: () => useChat.getState().clear() });
```
Alternatively, split `reset()` into `postReset()` + `refresh()` and call `clear()` between them.

### WR-02: A send before the history load returns permanently discards the stored conversation

**File:** `frontend/src/store/chat.ts:102-120, 138`, `frontend/src/components/ChatPanel.tsx:179`
**Issue:** `send` calls `bump()`, and `loadHistory` drops its response when `seq !== sequence`. Nothing reloads history afterwards, so `loaded` stays false for the rest of the session. Meanwhile `showPrompts = entries.length === 0 && !pending` is true from mount until the history arrives, so the starter-prompt chips are exactly what a user sees and can click before the load finishes. A click on "Buy 5 NVDA" during that window hides the whole earlier conversation until a page reload. The `loaded` flag the store maintains is never read by any component.
**Fix:** Hide the prompts and block sends until the first history load settles. On a send/load race, merge the results instead of discarding them:
```tsx
const loaded = useChat((s) => s.loaded);
const showPrompts = loaded && entries.length === 0 && !pending;
```
In `loadHistory`, when `seq !== sequence` but `!loaded`, prepend `body.messages` to the current entries instead of returning.

### WR-03: `strip_fences` discards JSON that sits on the opening fence line

**File:** `backend/app/chat/parsing.py:63-72`
**Issue:** When the text starts with a fence, `text.partition("\n")` throws away everything up to the first newline, on the assumption that the first line is only "```" or "```json". A reply such as `` ```json {"message": "hi", ...}``` `` (single line), or `` ```{"message": ...}\n``` ``, loses its JSON entirely. The result is "Reply is not valid JSON" and a 502 for a reply that is actually valid. The user message is stored, but the turn fails. `chat_llm_spike.py:30-38` has its own, different `strip_fence` that handles this case. The two implementations have drifted apart.
**Fix:** Drop only a language tag, not the rest of the line:
```python
def strip_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith(_FENCE):
        text = text[len(_FENCE):]
        m = re.match(r"[A-Za-z0-9_-]*[ \t]*\n?", text)   # optional language tag
        text = text[m.end():] if m and not text.lstrip().startswith("{") else text
        text = text.rstrip()
        if text.endswith(_FENCE):
            text = text[: -len(_FENCE)]
        text = text.strip()
    return text
```
Then have the spike import `strip_fences` from `app.chat.parsing`. Add parser tests for single-line fences.

### WR-04: A failure after the actions run returns a bare 500, records nothing, and leaves the UI stale

**File:** `backend/app/chat/service.py:97-101`, `frontend/src/components/ChatPanel.tsx:160-164`
**Issue:** `execute_actions` commits real trades and watchlist changes. The assistant row is written afterwards (`_insert`, line 101). If that insert, or the context build at lines 84-86, raises (for example SQLite "database is locked" or a disk error), the exception is not a `DomainError`. The client gets a non-JSON 500 ("Request failed (500)"):
- The executed trades are not recorded in `chat_messages`.
- The response carries no `actions`.
- `ChatPanel.submit` sees `null` and does not refresh the portfolio or watchlist, so the header, positions and heatmap stay stale even though cash and positions changed on the server.
**Fix:** Wrap the post-execution store in a try/except that logs the error and still returns the in-memory row, or retries the insert. In the frontend, refresh the portfolio and watchlist after any 5xx from `/api/chat`, not only after a reply with `actions`:
```ts
const reply = await useChat.getState().send(message);
if (reply?.actions || reply === null) { /* refresh on failure too: actions may have run */ }
```

## Info

### IN-01: Mock rules use word boundaries, but PLAN §9 says "message contains"

**File:** `backend/app/chat/mock.py:13-14`
**Issue:** `\bbuy\b` and `\bsell\b` do not match "Buying 2 shares" or "buyback". PLAN §9 says the rule fires when the message *contains* `buy` (case-insensitive substring), so the mock differs from the spec.
**Fix:** Use `re.compile(r"buy", re.I)` and `re.compile(r"sell", re.I)`. Alternatively, document the word-boundary choice in PLAN.

### IN-02: An unbounded LLM-supplied ticker is echoed into the stored error and the failure note

**File:** `backend/app/chat/actions.py:119,134`, `backend/app/tickers.py:24-26`
**Issue:** `_MAX_TEXT` cuts the record's `ticker` field to 32 characters. The `error` comes from `normalize_ticker`, which embeds the full raw symbol (`Invalid ticker {symbol!r}`). That error is stored verbatim and appended to the message content, so a long or garbage ticker from the model bloats the stored row and the visible note.
**Fix:** Truncate `exc.message` (or the symbol inside `normalize_ticker`'s message) before recording it.

### IN-03: `os.environ.setdefault` is called from a worker thread

**File:** `backend/app/chat/llm.py:110`
**Issue:** `warm()` runs in `asyncio.to_thread` and mutates `os.environ`, which calls `setenv`, while other threads may read the environment. The Dockerfile already sets `LITELLM_LOCAL_MODEL_COST_MAP`, so the call only matters for local dev.
**Fix:** Set it once at app construction (`create_app`) on the event-loop thread, before any `to_thread` call.

### IN-04: The chat store's `loaded` state is written but never read

**File:** `frontend/src/store/chat.ts:79-80, 118`
**Issue:** No component or store reads this state; it is dead state. WR-02 proposes the use it was presumably meant for.
**Fix:** Use it to gate the prompts and sends (WR-02), or remove it.

### IN-05: An empty Enter appends a new error bubble every time

**File:** `frontend/src/store/chat.ts:124-128`, `frontend/src/components/ChatPanel.tsx:172-177`
**Issue:** Each Enter on an empty textarea appends another "Message cannot be empty." system entry to the conversation, so the transcript fills with noise.
**Fix:** Ignore empty submits silently (`if (!text.trim()) return;` in `onKeyDown` and `onSubmit`), or replace the previous validation entry instead of appending one.

### IN-06: E2E retries in CI can hide flaky scenarios

**File:** `test/playwright.config.ts:22`
**Issue:** `retries: process.env.CI ? 1 : 0`, and the compose file sets `CI=true`, so every E2E run retries. A test that is flaky against the real-time stream passes silently on retry.
**Fix:** Keep `retries: 0`, or fail the job when the report contains flaky tests (`--fail-on-flaky-tests`).

### IN-07: `fresh-start.spec.ts` does not assert that the reset succeeded

**File:** `test/e2e/fresh-start.spec.ts:14-17`
**Issue:** Unlike `freshApp`, this `beforeEach` ignores the `POST /api/reset` response. A failed reset shows up later as a confusing assertion failure instead of a clear setup error.
**Fix:** `expect((await request.post("/api/reset")).ok()).toBe(true);`, or reuse `freshApp`.

---

_Reviewed: 2026-10-29_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
