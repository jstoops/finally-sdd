---
phase: 03-ai-copilot-and-complete-terminal
plan: 05
subsystem: testing
tags: [playwright, e2e, docker-compose, pytest, vitest]

requires:
  - phase: 03-02
    provides: chat API (POST /api/chat, GET /api/chat/history), MockLLMClient, reset clearing chat_messages
  - phase: 03-03
    provides: chat panel and full-terminal layout with data-testid / data-* hooks
  - phase: 03-04
    provides: legitimacy approval for @playwright/test 1.64.1 and mcr.microsoft.com/playwright:v1.64.1-noble
provides:
  - "test/ npm project (finally-e2e) pinning @playwright/test 1.64.1 with lockfile"
  - "test/Dockerfile runner image FROM mcr.microsoft.com/playwright:v1.64.1-noble"
  - "test/docker-compose.test.yml: isolated finally-test project (tmpfs DB, no host port, no keys, LLM_MOCK=true)"
  - "12 Playwright tests in 6 spec files covering all seven PLAN section 12 scenarios plus the 1440x900 layout"
  - "test_chat_history_is_empty_after_reset route test"
affects: [verify-work, ship]

actuals:
  tokens: 5400
  tasks: 3
  commits: 3
plan_head_before: f92716dc8dfa172645d6369a34477d5470b9fcd1
plan_head_after: bd5091a

tech-stack:
  added: ["@playwright/test 1.64.1 (test/ only)", "mcr.microsoft.com/playwright:v1.64.1-noble"]
  patterns:
    - "E2E against the production image in its own compose project with a tmpfs database"
    - "freshApp beforeEach: POST /api/reset, load, wait for connection-dot data-status open"
    - "Relational assertions via expect.poll; paired reads in one page.evaluate"

key-files:
  created:
    - test/package.json
    - test/package-lock.json
    - test/playwright.config.ts
    - test/Dockerfile
    - test/.dockerignore
    - test/docker-compose.test.yml
    - test/e2e/helpers.ts
    - test/e2e/fresh-start.spec.ts
    - test/e2e/watchlist.spec.ts
    - test/e2e/trading.spec.ts
    - test/e2e/portfolio.spec.ts
    - test/e2e/chat.spec.ts
    - test/e2e/reset.spec.ts
  modified:
    - backend/tests/test_reset.py

key-decisions:
  - "The browser reaches the app at http://finally-app:8000 (a network alias), not http://app:8000: 'app' is an HSTS-preloaded TLD, so Chromium upgrades http://app to https and fails with ERR_SSL_PROTOCOL_ERROR"
  - "Added a 12th E2E test (rejected sell shows the 400 inline, PLAN section 10) rather than padding; fresh-start also asserts the empty states"
  - "No new unit tests were needed for the TST-01/TST-02 mapping: every area already has named passing tests"

patterns-established:
  - "E2E stack: docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright, then down -v"
  - "playwright.config.ts throws without BASE_URL so the resetting suite can never be pointed at real data by default"

requirements-completed: [TST-01, TST-02, TST-03, TST-04, UX-02]

coverage:
  - id: D1
    description: "Isolated E2E harness: own compose project, tmpfs DB, no keys, LLM_MOCK=true, Playwright 1.64.1 image, BASE_URL required"
    requirement: TST-03
    verification:
      - kind: other
        ref: "grep pins in test/package.json, test/Dockerfile; grep name: finally-test and tmpfs, no finally-data/env_file in test/docker-compose.test.yml"
        status: pass
      - kind: other
        ref: "unset BASE_URL; node test/node_modules/@playwright/test/cli.js test --config test/playwright.config.ts --list (error names BASE_URL)"
        status: pass
    human_judgment: false
  - id: D2
    description: "All seven PLAN section 12 scenarios pass in a real browser against the shipped container"
    requirement: TST-03
    verification:
      - kind: e2e
        ref: "docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright (12 passed, no retries)"
        status: pass
    human_judgment: false
  - id: D3
    description: "At 1440x900 all seven panels are in the viewport with no page scroll; chat-toggle collapses and restores the chat"
    requirement: UX-02
    verification:
      - kind: e2e
        ref: "test/e2e/fresh-start.spec.ts#every panel is visible at once at 1440x900"
        status: pass
    human_judgment: false
  - id: D4
    description: "Tablet layout (1024x768, 768x1024) keeps every panel reachable and usable"
    requirement: UX-02
    verification: []
    human_judgment: true
    rationale: "Plan Task 3 human-check: usability at tablet sizes is a visual judgment no E2E test asserts"
  - id: D5
    description: "Reset clears chat history through the routes"
    requirement: TST-01
    verification:
      - kind: integration
        ref: "backend/tests/test_reset.py#TestResetRoute::test_chat_history_is_empty_after_reset"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full backend, frontend and E2E suites green together"
    requirement: TST-02
    verification:
      - kind: unit
        ref: "uv run --directory backend --extra dev pytest -q (566 passed with frontend/out built) + ruff check + ruff format --check"
        status: pass
      - kind: unit
        ref: "npm --prefix frontend test (320 passed) && lint && typecheck && build"
        status: pass
    human_judgment: false
  - id: D7
    description: "Real copilot (AI-01..AI-03): analysis cites correct numbers in plain text and 'Buy 5 NVDA' executes and updates the terminal"
    verification: []
    human_judgment: true
    rationale: "Plan Task 3 human-check: needs the user's OPENROUTER_API_KEY and a live model; no automated test reaches OpenRouter"

duration: 12min
completed: 2026-10-30
status: complete
---

# Phase 3 Plan 05: E2E Suite and Phase Gate Summary

**Playwright 1.64.1 runs 12 browser tests in its own container against the real app image in LLM mock mode, with a tmpfs database. The tests cover all seven PLAN section 12 scenarios plus the 1440x900 layout. The backend (566), frontend (320) and E2E (12) suites are all green.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-10-30T02:54:07Z
- **Completed:** 2026-10-30T03:06:34Z
- **Tasks:** 3
- **Files modified:** 14 (13 created, 1 modified)

## Accomplishments

- One command (`docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright`) builds the production image and a Playwright runner, waits for the healthcheck and exits 0. Then `down -v` removes everything. The user's `finally` project, `finally-data` volume and `.env` key are never touched. This was checked before and after each of the 4 runs.
- 12 tests in 6 spec files. Each file resets in `beforeEach`, and every test reads only data-testid and data-* hooks. The assertions are relational (cash below 10,000; cash after the sell above cash after the buy; heatmap sign equals positions P&L % sign in one `page.evaluate`). No test asserts an exact live price or waits for `networkidle`.
- A route-level test proves that `POST /api/reset` after a chat turn leaves `GET /api/chat/history` at `{"messages": []}`.

## Task Commits

1. **Task 1: Isolated E2E harness, fresh-start and layout specs** - `d90a175` (test)
2. **Task 2: Remaining PLAN section 12 scenarios** - `6cf874b` (test)
3. **Task 3: Reset clears chat; phase gate** - `bd5091a` (test)

## Files Created/Modified

- `test/package.json`, `test/package-lock.json`: the `finally-e2e` project. `@playwright/test` is pinned exactly at 1.64.1. The lockfile holds only `@playwright/test`, `playwright` and `playwright-core` 1.64.1.
- `test/playwright.config.ts`: serial chromium (`workers: 1`, `fullyParallel: false`) at 1440x900, with retries 1 under CI. It throws if `BASE_URL` is unset.
- `test/Dockerfile`, `test/.dockerignore`: the runner image, which runs `npm ci` and then `npx playwright test`.
- `test/docker-compose.test.yml`: project `finally-test`. The `app` service (image `finally-test:latest`, alias `finally-app`, tmpfs `/app/db`, mock mode, empty keys, healthcheck) is paired with a `playwright` service (ipc host, init, report bind mounts).
- `test/e2e/helpers.ts`: `freshApp`, `money`, `cashOf`, `buyFromBar`, `sellFromBar`, `sendChat`.
- `test/e2e/*.spec.ts`: fresh-start (2), watchlist (1), trading (3), portfolio (1), chat (4), reset (1).
- `backend/tests/test_reset.py`: `TestResetRoute::test_chat_history_is_empty_after_reset`.

## TST-01 / TST-02 Coverage Map (all passing)

| Area | Named tests |
|------|-------------|
| TST-01 trade service: avg cost | `test_trading.py::TestBuy::test_avg_cost_full_precision_stored_four_places_served`, `TestSell::test_partial_sell_keeps_avg_cost` |
| TST-01 P&L | `test_valuation.py` (`test_unrealized_pnl`, `test_exact_decimal_pnl`, `TestParityTable`) |
| TST-01 oversell / insufficient cash | `TestSell::test_sell_beyond_holding_is_rejected`, `test_selling_a_ticker_never_held`, `TestBuy::test_cost_above_cash_is_rejected`, `test_cost_equal_to_cash_succeeds` |
| TST-01 selling at a loss, dust | `TestSell::test_selling_at_a_loss`, `test_sell_within_tolerance_closes_the_position` |
| TST-01 no cached price | `TestValidation::test_no_price_available`; `test_portfolio_api.py::test_unpriced_ticker_is_400_with_verbatim_message` |
| TST-01 rounding / precision | `TestRounding::test_hundred_small_buys_stay_cent_exact`, `test_money.py` (`TestToCents`, `TestRound4`, `TestNotional`), `test_chat_actions.py::test_note_plan_section_9_example_exactly` |
| TST-01 ordering / adjacency / concurrency | `test_top_up_keeps_first_purchase_order`, `test_two_fills_in_one_second_store_two_rows_each`, `test_concurrent_buys_never_overspend`, `test_chat_api.py::TestTurnLock` |
| TST-01 tracked tickers | `test_trading.py::test_selling_unwatched_ticker_to_zero_stops_tracking_it`, `test_selling_watched_ticker_to_zero_keeps_it_tracked`; `test_tracker.py::test_held_ticker_stays_tracked_after_leaving_watchlist`; `test_watchlist.py::test_removing_held_ticker_from_watchlist_keeps_it_tracked` |
| TST-01 LLM parsing: valid, malformed | `test_chat_parsing.py` (`TestParseEquivalence`, `TestParseErrors::test_unreadable_reply_raises`, `TestBadLists`, `TestItemModels`) |
| TST-01 per-item failures, notes, caps | `test_chat_actions.py` (`TestOrderAndIndependence::test_malformed_item_fails_alone_in_input_order`, `TestNotes`, `TestCaps::test_cap_eleventh_trade_fails_and_never_runs`) |
| TST-01 mock triggers | `test_chat_mock.py::TestRules` (`test_buy`, `test_sell`, `test_add_uppercases_capture`, `test_remove_uppercases_capture`, `test_greeting_text`, `test_word_boundaries_fall_through_to_greeting`) |
| TST-01 API status codes and shapes | `test_portfolio_api.py` (`test_insufficient_cash_and_shares_are_400_and_change_nothing`, `test_malformed_body_is_422`, `test_buy_returns_trade_and_committed_portfolio`), `test_watchlist.py` (`test_remove_then_404`, `test_default_ticker_readd_is_200`), `test_chat_api.py` (`TestValidation`, `TestLLMFailures::test_llm_error_is_502_with_user_row_only`, `test_unconfigured_app_returns_503_and_stores_nothing`, `TestHistory`), `test_main.py::TestHealth` |
| TST-01 reset | `test_reset.py::TestResetService::test_reset_restores_the_default_account`, `TestResetRoute::test_json_post_resets_and_returns_ok`, `test_chat_history_is_empty_after_reset` (new) |
| TST-02 component rendering | `terminal.test.tsx` ("renders every panel and the header readouts at the same time (UX-02)"), `header.test.tsx`, `Heatmap.test.tsx`, `PositionsTable.test.tsx`, `PnlChart.test.tsx`, `TradeBar.test.tsx`, `TradeHistory.test.tsx`, `ChartPanel.test.tsx` |
| TST-02 price flash | `terminal.test.tsx` ("flash on up ticks, re-flash on a new timestamp, and not on flat or repeated ticks") |
| TST-02 connection status | `terminal.test.tsx` `ConnectionDot` ("follows the stream through connect, open, reconnect and close") |
| TST-02 watchlist add/remove | `watchlist.test.tsx` `AddTickerForm` ("POSTs the ticker and appends the new row at the bottom on 201") and `remove button` ("DELETEs an unselected ticker in one click and keeps the selection") |
| TST-02 portfolio math | `domain/portfolio.test.ts` (`livePortfolio`, `livePortfolio server parity`, "gives weights that sum to 1") |
| TST-02 chat rendering, failed actions, loading | `ChatPanel.test.tsx` ("renders executed trade and watchlist chips", "renders a failed chip distinctly with its error", "shows the loading row and disables Send while the request is in flight") |

## Decisions Made

- The `app` service gets a `finally-app` network alias, and `BASE_URL` uses it (see Deviation 1).
- A 12th E2E test was added for the inline 400 trade error, a PLAN section 10 behavior that no spec covered, so the plan's floor of 12 is met with real coverage.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Chromium cannot load http://app:8000**
- **Found during:** Task 1 (first compose run)
- **Issue:** Both tests failed in `page.goto` with `net::ERR_SSL_PROTOCOL_ERROR at http://app:8000/`. `app` is an HSTS-preloaded top-level domain, so Chromium silently upgrades `http://app` to https. The APIRequestContext reset worked because it does not apply HSTS.
- **Fix:** The `app` service keeps its name and gets the network alias `finally-app`. The playwright service sets `BASE_URL: http://finally-app:8000`, and the config error message names that URL.
- **Files modified:** test/docker-compose.test.yml, test/playwright.config.ts
- **Verification:** The compose run went from 2 failed to 2 passed. The later runs had 12 passed each.
- **Committed in:** d90a175
- **Note for verifiers:** The plan's key_link text "BASE_URL=http://app:8000" now reads `http://finally-app:8000`. The `BASE_URL` pattern still matches.

**2. [Rule 2 - Missing coverage] Empty-state assertions in fresh-start, and the inline 400 test**
- **Found during:** Task 2
- **Issue:** The must-haves require the fresh-start spec to assert the empty states, but the Task 1 action did not list them. Task 2 as specified gave 11 tests, below the plan's floor of 12.
- **Fix:** The fresh-start test now asserts `positions-empty`, zero `chat-message` and a visible `chat-prompt`. Added "a rejected sell shows the 400 error inline and changes nothing" to trading.spec.ts.
- **Files modified:** test/e2e/fresh-start.spec.ts, test/e2e/trading.spec.ts
- **Committed in:** 6cf874b

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing coverage)
**Impact on plan:** Both were needed to meet the plan's own truths. No scope creep.

## Issues Encountered

- The sandbox would not run the plan's `env -u BASE_URL ...` verify command verbatim. The equivalent `unset BASE_URL; node ... --list` was run instead, and it failed with an error naming BASE_URL, as required.
- Backend `test_main.py::TestStatic` skips until `frontend/out` exists. After the frontend build in Task 3 it ran and passed (566 passed in total).

## User Setup Required

None. The E2E suite needs only Docker and no API keys.

## Next Phase Readiness

- Phase 3's automated gate is green. Two human checks are queued for end-of-phase verification: the tablet layout at 1024x768 and 768x1024, and the live copilot with OPENROUTER_API_KEY (as described in the Task 3 human-check blocks).
- REQUIREMENTS.md, STATE.md and ROADMAP.md were not edited. The orchestrator owns those writes, and TST-03 and UX-02 still read Pending there.

---
*Phase: 03-ai-copilot-and-complete-terminal*
*Completed: 2026-10-30*

## Self-Check: PASSED

- All 13 created files and the modified test file exist; commits d90a175, 6cf874b and bd5091a are ancestors of HEAD.
