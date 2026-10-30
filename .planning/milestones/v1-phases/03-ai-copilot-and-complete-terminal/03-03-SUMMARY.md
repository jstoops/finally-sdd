---
phase: 03-ai-copilot-and-complete-terminal
plan: 03
subsystem: ui
tags: [react, zustand, nextjs, tailwind, chat, vitest]

requires:
  - phase: 03-01
    provides: frozen chat wire types, useChat (entries, pending, send), ChatPanel tracer, terminal chat tests
  - phase: 02
    provides: usePortfolio.refresh/reset with sequence guards, useWatchlist.loadWatchlist/nextSelection, usePrices spark/lastTs, stubApi/callsTo
provides:
  - "useChat final form: validateChatMessage + MAX_MESSAGE_CHARS (code points), loadHistory behind a sequence guard, clear (with clear epoch), loaded, collapsed, toggleCollapsed"
  - "ChatPanel final form: history reload on mount, loading row, single in-flight request, IME-safe Enter, prompt chips (PROMPTS), null-safe chip renderer, auto-scroll, collapse toggle"
  - "PF-10 reset: disabled while chat pending; clears chat, sparklines and selection; reloads watchlist"
  - "usePrices.clearSparklines, useWatchlist.clearSelection"
  - "Terminal data-chat attribute and collapsible xl column (360px / 2.75rem)"
  - "pnl-chart data-point-count hook; DEFAULT_API serves GET /api/chat/history"
affects: [03-05]

actuals:
  tokens: 17000
  tasks: 3
  commits: 6
plan_head_before: 5177140f51f54d677fe0418e7810e9d9dfa612f6
plan_head_after: 636d54a704727dcf6ee7936fe9c23f004274a2a8

tech-stack:
  added: []
  patterns:
    - "Chat history guard: loadHistory takes a sequence number at start; send and clear bump it so a stale load never overwrites optimistic entries"
    - "Clear epoch: a chat reply arriving after clear() is dropped (defense in depth behind the disabled Reset)"
    - "Cross-store reset orchestration lives in Header (component), never in a store"
    - "Grid variants as complete literal Tailwind class strings selected by store state"

key-files:
  created:
    - frontend/src/store/chat.test.ts
    - frontend/src/components/ChatPanel.test.tsx
  modified:
    - frontend/src/store/chat.ts
    - frontend/src/components/ChatPanel.tsx
    - frontend/src/test/stubFetch.ts
    - frontend/src/components/Header.tsx
    - frontend/src/components/header.test.tsx
    - frontend/src/store/prices.ts
    - frontend/src/store/watchlist.ts
    - frontend/src/components/Terminal.tsx
    - frontend/src/components/terminal.test.tsx
    - frontend/src/components/PnlChart.tsx
    - frontend/src/components/PnlChart.test.tsx

key-decisions:
  - "send() sends and shows the trimmed text; inner line breaks are kept"
  - "A malformed GET /api/chat/history body shows 'Could not load the chat history.' as one error bubble (A-12 extended to shape failures)"
  - "A clear epoch, separate from the history sequence, drops a reply that lands after clear(); using the history sequence would have dropped replies whenever a history load started mid-send"
  - "Prompt chips do not clear a typed draft; only Enter/Send clear it, and only when the text passes the pre-check (an over-long draft is kept for editing)"
  - "Collapsed chat drops min-h-64 at md so it shrinks to its header row; at xl the h2 is sr-only and the toggle centers in the 2.75rem rail"
  - "Executed trade chip with no price renders '@ —' rather than '$—'"

patterns-established:
  - "Chat test helpers: deferred() route handler for in-flight requests, typeAndEnter() with act-wrapped keyDown"

requirements-completed: [AI-11, AI-12, AI-13, AI-14, AI-15, AI-16, PF-10, UX-02, TST-02, TST-04]

coverage:
  - id: D1
    description: "Chat history reloads on mount (once) and renders stored messages and chips identically to live ones; stale loads after a send or clear are discarded"
    requirement: AI-11
    verification:
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#history"
        status: pass
      - kind: unit
        ref: "frontend/src/store/chat.test.ts#useChat loadHistory"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#loads chat history once on mount"
        status: pass
    human_judgment: false
  - id: D2
    description: "Enter sends, Shift+Enter newline, IME Enter ignored, loading row, Send disabled and no second POST while pending, empty/over-long pre-check bubbles, auto-scroll"
    requirement: AI-12
    verification:
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#loading"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#input"
        status: pass
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#scroll"
        status: pass
    human_judgment: false
  - id: D3
    description: "Action chips: executed and failed (border-down text-down, ⚠, error, title), null fields as —, same-ticker separate, watchlist first, formatQty/formatPrice precision, no row for null/empty actions"
    requirement: AI-13
    verification:
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#chip"
        status: pass
    human_judgment: false
  - id: D4
    description: "400, 502, 503 and network failures render as chat-system error bubbles (role alert) with the server text; the user message stays"
    requirement: AI-14
    verification:
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#bubble"
        status: pass
    human_judgment: false
  - id: D5
    description: "Replies with non-null actions refresh portfolio, trades, P&L history and watchlist exactly once each; null actions refresh nothing"
    requirement: AI-15
    verification:
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#refetch"
        status: pass
    human_judgment: false
  - id: D6
    description: "Prompt chips only in an empty, idle chat; click posts the exact label"
    requirement: AI-16
    verification:
      - kind: unit
        ref: "frontend/src/components/ChatPanel.test.tsx#prompt"
        status: pass
    human_judgment: false
  - id: D7
    description: "Reset disabled while chat pending (no confirm); confirmed reset clears chat, sparklines and selection (GOOGL to AAPL) and refetches four endpoints; failed reset clears nothing"
    requirement: PF-10
    verification:
      - kind: unit
        ref: "frontend/src/components/header.test.tsx#Header reset PF-10"
        status: pass
    human_judgment: false
  - id: D8
    description: "All panels and header readouts render together; chat column collapses/expands via chat-toggle with data-chat and the 2.75rem xl column"
    requirement: UX-02
    verification:
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#collapses and expands the chat column"
        status: pass
      - kind: unit
        ref: "frontend/src/components/terminal.test.tsx#renders every panel and the header readouts at the same time (UX-02)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Chat test hooks and pnl-chart data-point-count exist for the E2E suite"
    requirement: TST-04
    verification:
      - kind: unit
        ref: "frontend/src/components/PnlChart.test.tsx#exposes the snapshot count as data-point-count (TST-04)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Chat panel look at 1440x900 (rail width, collapsed toggle placement, prompt chips, loading row) and the tablet layout"
    verification: []
    human_judgment: true
    rationale: "Visual layout and styling are not asserted by jsdom tests; plan 03-05 covers the 1440x900 layout spec and the tablet human check"

duration: 4h 18m wall clock (includes a session usage-limit pause; about 40 min active)
completed: 2026-10-30
status: complete
---

# Phase 3 Plan 03: Complete Chat Panel and Terminal Summary

**The chat panel is finished. It reloads history behind a sequence guard, sends on Enter (ignoring IME composition), shows a loading row and allows one request at a time, rejects empty or too-long messages with the server's code-point rule, renders null-safe executed and failed chips, shows error bubbles for 400/502/503 and network failures, offers starter prompts, auto-scrolls and collapses. Reset is blocked while a reply is pending and afterwards clears the chat, sparklines and chart selection. The terminal shows every panel at once, has a collapsible chat column and exposes `pnl-chart` `data-point-count`.**

## Performance

- **Duration:** 4h 18m wall clock (a session usage limit paused the run between Task 1 RED and GREEN; about 40 min active)
- **Started:** 2026-10-29T22:26:57Z
- **Completed:** 2026-10-30T02:45:06Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- `useChat` final form: `validateChatMessage`/`MAX_MESSAGE_CHARS` (trimmed, code points via `Array.from`, the server's exact texts), `loadHistory` behind a module-level sequence guard bumped by `send` and `clear`, a clear epoch that drops late replies, `loaded`, `collapsed`, `toggleCollapsed`. The store imports no other store.
- `ChatPanel` final form: history load on mount, `chat-loading` row (`role="status"`), Send disabled and the store guard while pending, Enter/Shift+Enter/IME handling, `PROMPTS` chips, one chip renderer shared by live and stored replies, `scrollTop = scrollHeight` auto-scroll, `chat-toggle` with `aria-expanded`/`aria-controls`. All text renders as React text nodes.
- PF-10: `ResetButton` is disabled with a "Wait for FinAlly to finish replying" title while chat is pending. After a successful reset it calls `clear()`, `clearSparklines()`, `clearSelection()`, then `loadWatchlist()`.
- UX-02/TST-04: Terminal `main` has `data-chat` and swaps complete grid class strings (360px or 2.75rem). `pnl-chart` has `data-point-count`. `DEFAULT_API` serves an empty chat history.

## Task Commits

1. **Task 1: Complete chat panel**: `11ec9bd` (test, RED), `ca23ec9` (feat, GREEN)
2. **Task 2: PF-10 reset**: `b6acc05` (test, RED), `1ef738b` (feat, GREEN)
3. **Task 3: Full terminal, collapsible chat, data-point-count**: `ab11d63` (test, RED), `636d54a` (feat, GREEN)

No refactor commits were needed.

## TDD Notes
- **Task 1 RED:** 44 of 52 new tests failed on missing `validateChatMessage`, `loadHistory`, `clear`, `toggleCollapsed`, `PROMPTS`, `chat-loading`, `chat-prompt` and `chat-toggle`. The 8 that passed exercise behavior 03-01 already shipped (basic send, ApiError bubble). GREEN: 52/52.
- **Task 2 RED:** 4 failed (Reset not disabled, chat not cleared, missing `clearSparklines` and `clearSelection`). The failed-reset test passed at RED by design, since nothing cleared state yet. GREEN: 15/15.
- **Task 3 RED:** 3 failed (no `data-chat`, no `data-point-count`). "Loads chat history once on mount" passed at RED because Task 1 delivered it. GREEN: 56/56.

## Files Created/Modified
- `frontend/src/store/chat.ts`: final `useChat`
- `frontend/src/store/chat.test.ts`: store tests (validation, send, history guard, clear, collapse)
- `frontend/src/components/ChatPanel.tsx`: final panel and `PROMPTS`
- `frontend/src/components/ChatPanel.test.tsx`: describe blocks history, loading, input, chip, bubble, prompt, refetch, scroll, collapse
- `frontend/src/test/stubFetch.ts`: `"GET /api/chat/history": { messages: [] }` default route
- `frontend/src/components/Header.tsx`: PF-10 reset
- `frontend/src/components/header.test.tsx`: PF-10 tests and store helper tests
- `frontend/src/store/prices.ts`: `clearSparklines`
- `frontend/src/store/watchlist.ts`: `clearSelection`
- `frontend/src/components/Terminal.tsx`: `data-chat` and the collapsible grid
- `frontend/src/components/terminal.test.tsx`: all-panels, collapse and history-once tests
- `frontend/src/components/PnlChart.tsx` / `PnlChart.test.tsx`: `data-point-count`

## Decisions Made
See `key-decisions` in the frontmatter. The main one is the clear epoch. It is kept separate from the history sequence because tying late-reply dropping to that sequence would discard a real reply whenever a history load started during a send.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Late chat reply after clear() is dropped**
- **Found during:** Task 1 (store design)
- **Issue:** Disabling Reset is the main guard, but nothing in the store stopped a reply that resolved after `clear()` from repopulating a reset chat.
- **Fix:** A module-level `clears` epoch. `send` appends its reply or error only if no clear happened since it started.
- **Files modified:** frontend/src/store/chat.ts
- **Verification:** full suite green. The UI path is covered by the disabled-Reset test.
- **Committed in:** ca23ec9

**2. [Rule 2 - Missing Critical] Collapsed chat drops its md min height**
- **Found during:** Task 3
- **Issue:** At md, `min-h-64` kept a tall empty box under the center column after collapsing, against A-13 ("collapsing leaves only the panel header").
- **Fix:** Terminal passes a chat class string without `min-h-64` when collapsed.
- **Files modified:** frontend/src/components/Terminal.tsx
- **Committed in:** 636d54a

**3. [Rule 2] Malformed history body handled**
- **Found during:** Task 1
- **Issue:** The plan named only a fetch failure as the error case for `loadHistory`.
- **Fix:** A body without a `messages` array shows one "Could not load the chat history." bubble and leaves `loaded` false.
- **Committed in:** ca23ec9

---

**Total deviations:** 3 auto-fixed (all Rule 2, robustness)
**Impact on plan:** No scope creep; all three are small guards on paths the plan already owned.

## Issues Encountered
- A session usage limit interrupted execution after the Task 1 RED commit. The run resumed from the uncommitted GREEN edits with 52 tests passing, and no work was lost.
- The worktree guard rejected compound git commands, so the commit ledger file was not written. Instead, `plan_head_before` is the verified base SHA (5177140) and `commits: 6` is measured with `git rev-list --count 5177140..HEAD`.
- `useWatchlist.loadWatchlist` has no response-sequence guard. Overlapping watchlist reloads (two chat replies) resolve last-write-wins. The portfolio refetches go through the Phase 2 guards. This is out of scope here and not a correctness issue for identical server responses.

## User Setup Required
None. No external service configuration required.

## Next Phase Readiness
- 03-05 E2E can rely on `panel-chat`, `chat-toggle`, `chat-list`, `chat-message[data-role]`, `chat-system[data-tone]`, `chat-action[data-kind][data-status]`, `chat-prompt`, `chat-loading`, `chat-input`, `chat-send`, `main[data-chat]` and `pnl-chart[data-point-count]`.
- The panel depends on 03-02's `GET /api/chat/history` (`{"messages": [...]}`). Until that merges, the live app shows a 404 error bubble on load.

## Verification Results
- `npm --prefix frontend test`: 18 files, 320 tests passed
- `npm --prefix frontend run lint`: clean. `typecheck`: clean. `build`: static export OK
- Task 1 `-t "history|chip|bubble|refetch|prompt"`: 24 passed, 11 skipped. The grep gate (history route, loading/prompt hooks, `Array.from`, no `dangerouslySetInnerHTML`) passes.
- Task 2 `-t reset`: 10 passed. The grep gate passes.
- Task 3 grep gate passes. `git diff --quiet c1ccc90 -- frontend/package.json frontend/package-lock.json` is clean.

## Self-Check: PASSED
- Created files exist: frontend/src/store/chat.test.ts, frontend/src/components/ChatPanel.test.tsx
- Commits 11ec9bd, ca23ec9, b6acc05, 1ef738b, ab11d63, 636d54a are on this branch (`git log`)

---
*Phase: 03-ai-copilot-and-complete-terminal*
*Completed: 2026-10-30*
