---
last_mapped_commit: e4d2dc6c861d30bbf4ab05aea270f8f75bc343aa
last_mapped_at: 2026-10-23
---
# Codebase Concerns

**Analysis Date:** 2026-10-23

## Scope and Overall State

Only `backend/app/market/` (plus its tests and `backend/market_data_demo.py`) exists as application code. There is no FastAPI app entry point (`backend/app/__init__.py` is a docstring only), no `backend/app/db/`, no portfolio, trade, watchlist or chat code, no `frontend/` source, no `test/` E2E tests, no `Dockerfile`, and no `docker-compose.yml`. Most PLAN.md requirements are therefore unimplemented, and the concerns below are limited to what exists plus the risks the market subsystem creates for the remaining build.

Verified state: `cd backend && .venv/Scripts/python.exe -m pytest` passes 139 tests on the current `main`-line code (commit `e4d2dc6`, working tree clean).

## Status of Prior Findings (`planning/MARKET_DATA_REVIEW.md`)

The review (2026-10-13) listed 15 findings. The fix commit `3aa71db` and merges `1249e40`/`dfc5be9` address them. Checked against the current code:

| ID | Finding | Status | Evidence |
|---|---|---|---|
| C1 | Massive reads nonexistent `last_trade.timestamp` | Fixed | `massive_client.py` now uses `pick_price()` (`last_trade.price` → `min.close` → `day.close` → `prev_day.close`); fields confirmed on `massive` 2.2.0 models; cache uses receipt time |
| H1 | Free Basic key unsupported | Fixed | LIVE→EOD switch on `NOT_AUTHORIZED` in `massive_client.py` (`_poll_once`, `_fetch_eod`) |
| H2 | Ticker removed mid-poll reappears | Fixed | Re-reads `self._tickers` after `to_thread` in `_poll_once`; worker gets a list copy |
| M1 | Unknown-ticker seed random per restart | Fixed | `simulator.py:_unknown_seed_price` uses `random.Random(ticker)` |
| M2 | History timestamps not strictly increasing | Fixed | `cache.py:update` forces `prev.timestamp + 0.001` |
| M3 | `remove()` doesn't bump version | Fixed | `cache.py:remove` increments `_version` when the ticker existed |
| M4 | SSE generator untested | Fixed | `tests/market/test_stream.py` added |
| M5 | 600-point history spans 2.5 h in Massive mode | Fixed | `cache.py:get_history` filters to `HISTORY_SECONDS` (300) |
| L1 | NaN/inf poll interval | Fixed | `factory.py:_poll_interval` checks `math.isfinite`, floor 1 s |
| L2 | `CancelledError` swallowed in SSE | Fixed | `stream.py` uses only `finally`; no swallowing `except` |
| L3 | Ticker normalization inconsistent | Fixed | `simulator.py:_normalize` and Massive `strip().upper()` |
| L4 | No keep-alive in SSE | Fixed | `stream.py` sends `: keep-alive` after 15 s silence |
| L5 | Stale docs | Mostly fixed | `backend/CLAUDE.md` updated; see Documentation Drift below for the remaining stale parts |
| L6 | Formatting drift | Not verified | `backend/CLAUDE.md` now lists `ruff format --check`; run it before merging |
| L7 | `rich` runtime dependency | Fixed | `rich` moved to the `dev` extra in `backend/pyproject.toml` |

Remaining gaps from the review and from this audit are listed below.

## Tech Debt

**Market-subsystem plan items (PLAN §6 `[change]`):**
- Implemented: session `open_price` (`cache.py`, `models.py`), 5-minute history ring buffer with 600-point cap (`cache.py`), `GET /api/prices/{ticker}/history` (`stream.py`), `open_price` in SSE payload (`models.py:to_dict`), `MASSIVE_POLL_INTERVAL` parsing (`factory.py`).
- Gap: `session_change_percent` is server-side only. The frontend must compute "Chg %" from `price` and `open_price`; the SSE payload intentionally omits it. Confirm the frontend does this, or PLAN §6 "Chg %" will diverge from the LLM context value.

**Simulator set-up is O(n²) with no size cap:**
- Issue: `backend/app/market/simulator.py:_rebuild_cholesky` rebuilds the full correlation matrix in a Python double loop, and `GBMSimulator.add_ticker` / `remove_ticker` call it on every change. Ticker count is unbounded: the LLM can add tickers through `watchlist_changes`, and positions add to the tracked set.
- Files: `backend/app/market/simulator.py`
- Impact: Each add/remove costs O(n²) pairwise calls plus an O(n³) Cholesky on the event loop, and the 500 ms `step()` is O(n) with a matrix-vector product per tick. Fine at ~10–50 tickers; degrades beyond that. The review's "n < 50" assumption is not enforced.
- Fix approach: Enforce a watchlist/tracked-ticker cap in the app layer (e.g. 50), and/or build the correlation matrix vectorised from group membership. Add a test at the cap.

**Massive poller hard-codes a permanent LIVE→EOD switch:**
- Issue: `massive_client.py:_poll_once` sets `self._mode = "eod"` and never returns to LIVE, even if the user upgrades the plan without a restart.
- Files: `backend/app/market/massive_client.py`
- Impact: Upgrading a key requires a restart. Minor, but undocumented.
- Fix approach: Retry LIVE once per hour (same cadence as the EOD refresh), or document that a restart is required.

**Unused public surface:**
- `PriceCache.update(timestamp=...)` explicit timestamps are used only by tests; `GBMSimulator.get_price`/`get_tickers` are used only by the source. Harmless; keep until the app layer is built.

**Demo script in the backend package:**
- `backend/market_data_demo.py` is a Rich-based terminal demo at the top of the backend package with `rich` as a dev dependency. It is not part of the app; move it to `scripts/` or `backend/tools/` before the Docker image is built, so it is not confused with app code.

## Known Bugs

No confirmed functional bugs in the current code. The test suite passes and the review's reproduced defects are fixed. The following are latent defects found while reading:

**Massive EOD refresh can exceed the free-tier budget on holidays:**
- Symptoms: On a weekday holiday (or any run of weekdays with no grouped data), `_latest_grouped_closes` in `massive_client.py` makes up to `EOD_LOOKBACK_DAYS` (7) synchronous `get_grouped_daily_aggs` calls in one poll (weekends are skipped, weekdays are not). The free tier allows 5 calls per minute, so this can trigger rate-limit errors (`ERROR`-level logs from `_poll_once`).
- Files: `backend/app/market/massive_client.py:_latest_grouped_closes`
- Trigger: Market holiday, or the first call after a long outage.
- Workaround: None. Fix by spreading lookback calls across polls, or caching a "no data on day X" result for the refresh window.

**`MASSIVE_POLL_INTERVAL` floor of 1 s can exceed the rate limit:**
- Symptoms: Setting `MASSIVE_POLL_INTERVAL=1` makes one snapshot call per second (60/min) against a 5/min free tier. PLAN §6 says paid tiers may use 2–15 s; the factory allows down to 1 s.
- Files: `backend/app/market/factory.py` (`MIN_POLL_INTERVAL = 1.0`)
- Fix approach: Raise the floor to 2 s (per PLAN §6 guidance) or document the rate-limit consequence.

**Error classification relies on string matching:**
- Symptoms: `massive_client.py:is_not_entitled` checks `"not_authorized"` / `"not entitled"` in `str(BadResponse)`. A wording change in the Massive API would silently keep the app in LIVE mode, where every poll fails and the cache stays empty (the exact pre-fix C1/H1 symptom), logged only as `ERROR` every poll.
- Files: `backend/app/market/massive_client.py`
- Fix approach: Check the parsed response status/code if the SDK exposes it, and log a single clear startup message when the cache is empty after the first poll.

## Security Considerations

**No API key in logs or code:**
- `MASSIVE_API_KEY` is read from `os.environ` in `factory.py` and passed into `RESTClient`. It is not logged. Keep it that way: `massive` `BadResponse` messages are logged verbatim in `_poll_once` (`logger.error("Massive poll failed: %s", e)`), and the response body does not contain the key today.
- Files: `backend/app/market/factory.py`, `backend/app/market/massive_client.py`

**Environment file handling:**
- `.gitignore` covers `.env`. The backend `.env` loading (`python-dotenv`) is planned, not yet present. When added, load `../.env` only, and never print variables at startup.

**Public, unauthenticated endpoints (planned):**
- Risk: PLAN §2 specifies no login. `POST /api/reset` deletes all data and `POST /api/chat` spends LLM budget (OpenRouter key). Anyone who can reach port 8000 can do both.
- Recommendations: Bind to `127.0.0.1` in local start scripts (or document that exposing 8000 publicly is unsupported), and rate-limit `/api/chat`.

**Path parameter not validated:**
- `GET /api/prices/{ticker}/history` in `stream.py` accepts any string, uppercases it, and returns an empty list for unknown symbols. No injection risk (lookup only), but the endpoint lets callers probe arbitrary strings. Validate against `^[A-Z][A-Z0-9.]{0,9}$` (PLAN §7) once the app layer exists.

**CI workflows:**
- `.github/workflows/claude-code-review.yml` runs on every `pull_request` (not `pull_request_target`), so fork PRs do not get the OAuth secret. It has `id-token: write`, which is needed for the action. Acceptable as configured.
- `.github/workflows/claude.yml` runs on `@claude` mentions from comments and reviews. Anyone able to comment on a public PR can trigger it, but the workflow only reads secrets for the authorised action. Review the `if:` author-association filter before making the repository public.

## Performance Bottlenecks

**SSE sends the full ticker set on every change:**
- Problem: `stream.py:_generate_events` serialises all tracked tickers into one JSON frame every 500 ms (the simulator bumps `version` on every step, so the frame goes out on every tick even when prices are unchanged).
- Files: `backend/app/market/stream.py`, `backend/app/market/simulator.py` (`_run_loop`)
- Cause: The version counter increases on every `update()` regardless of whether the price changed; with 10 tickers that is about 2 frames/s of ~1.5 KB each per client.
- Improvement path: Skip the version bump when `price` and `open_price` are unchanged, or send only changed tickers. Note that the PLAN §6 contract says "if any price changed, send one event with all tickers", so the change-skip is the spec-compliant option.

**Per-client serialisation with no connection cap:**
- Problem: Each SSE client runs its own loop, calling `price_cache.get_all()` and `to_dict()` for every ticker every 0.5 s. There is no limit on concurrent streams.
- Files: `backend/app/market/stream.py`
- Improvement path: Serialise once per version change and share the bytes between clients, and cap concurrent SSE connections (e.g. 20). Not an issue for a single-user app; relevant if the app is ever deployed publicly.

**`PriceCache` uses one global `threading.Lock`:**
- Problem: `get_history` builds a filtered list under the lock; `get_all` copies the dict. Both are short, but every SSE client and every simulator tick contends on the same lock.
- Files: `backend/app/market/cache.py`
- Impact: Negligible at current scale. Note only.

**Simulator `_rebuild_cholesky` on the event loop:**
- Issue: See Tech Debt above. Adding a ticker blocks the event loop for the rebuild time; the Cholesky cost is small at n<50 but is unbounded.

## Scaling Limits

**Tracked ticker count:**
- Current capacity: Watchlist of 10 + positions; the simulator is verified with 66 mixed tickers (review).
- Limit: No cap is defined. Simulator cost grows O(n²) per add/remove; Massive snapshot call is one request for all tickers but the free tier is 5 calls/min regardless of ticker count.
- Scaling path: Define a cap in PLAN (and enforce it in the watchlist service) before the LLM watchlist tool is wired up.

**Massive free-tier call budget:**
- Current capacity: One snapshot call per 15 s (4/min) in LIVE mode; in EOD mode one grouped call per hour plus up to 2 `/prev` calls per poll for unknown tickers.
- Limit: 5 calls/min on the free tier. Any additional Massive calls (e.g. from the future portfolio or chat code) would share this budget.
- Scaling path: Keep all market-data calls in `MassiveDataSource`; never call the REST client from the app layer.

**History memory:**
- 600 points × N tickers × 16 bytes plus deque overhead is trivial; not a concern at any realistic ticker count.

## Dependencies at Risk

**`massive` SDK (pinned `>=1.0.0`, installed 2.2.0):**
- Risk: The SDK changed the model field names between versions (the root of C1: `last_trade.timestamp` vs `sip_timestamp`). The lock file pins a version, but `pyproject.toml` allows any `>=1.0.0`.
- Impact: A future SDK change could silently empty the cache again (see Known Bugs).
- Migration plan: Pin an upper bound (`massive>=2.2,<3`) and keep the real-model fixture tests (`TickerSnapshot.from_dict`) in CI so a field rename fails a test.

**`numpy` for a 10-ticker simulator:**
- Risk: numpy is a heavy runtime dependency used only for `np.linalg.cholesky` and `standard_normal` in `simulator.py`. Acceptable; it also keeps the Docker image larger than necessary.
- Migration plan: None required.

## Missing Critical Features

**Remove-only-if-unheld rule is not enforced anywhere yet:**
- Problem: `interface.py` says the app must call `remove_ticker` only when no position is held (PLAN §6), but no app layer exists to enforce it. Calling it on a held ticker removes its price, so portfolio valuation falls back to `avg_cost` silently.
- Blocks: Watchlist removal and sell-to-zero logic, and the LLM `watchlist_changes` executor.
- Fix approach: Implement the tracked-set rule (watchlist ∪ positions) in one service function, and test it (PLAN §12 "Tracked tickers" cases).

**Startup wiring is missing:**
- Problem: No `lifespan` hook creates the schema, starts the market source with watchlist ∪ positions, records the initial snapshot, or starts the 30 s snapshot task (PLAN §3).
- Blocks: Everything end-to-end. The `create_stream_router(price_cache)` function is ready to mount.

**Database layer missing:**
- Problem: No `backend/app/db/schema.sql`, seed logic, or connection helper (PLAN §7). Trade execution, cash and snapshots have no implementation.
- Blocks: Portfolio, trades, watchlist persistence, reset.

**Price-availability rule for trades:**
- Problem: PLAN §7 rejects trades on tickers with no cached price. In Massive mode, a newly added ticker has no price until the next poll (up to 15 s), so a buy immediately after adding will fail. The UI and LLM need to handle this message.

## Test Coverage Gaps

**Massive live-path against the real API:**
- What's not tested: No run against the live API (the summary says no key configured). Fixtures use real `TickerSnapshot.from_dict`, which catches field-name errors but not wire-format changes.
- Files: `backend/tests/market/test_massive.py`
- Risk: Wire-format or entitlement behaviour could differ from the fixtures.
- Priority: Medium. Add an opt-in integration test gated on `MASSIVE_API_KEY`.

**Simulator Cholesky validity for arbitrary ticker sets:**
- What's not tested: Positive-definiteness is checked only for the verified 66-ticker mix. Arbitrary symbol sets (e.g. all tech tickers at 0.6 plus unknown tickers at 0.3) are not property-tested. `np.linalg.cholesky` raises `LinAlgError` if the matrix stops being positive definite, and `add_ticker` would then raise into the caller.
- Files: `backend/app/market/simulator.py`, `backend/tests/market/test_simulator.py`
- Risk: An add-ticker request raises an unhandled error in a route handler.
- Priority: Medium. Add a randomized test over N ≤ 100 tickers and wrap the rebuild in a fallback (e.g. diagonal-only correlation with a logged warning).

**Factory logging and env edge cases:**
- Covered by `test_factory.py` (invalid, NaN, inf, clamping). Adequate.

## Documentation Drift

- `planning/MARKET_DATA_SUMMARY.md` still says "Complete and tested" and "139 tests, all passing. Coverage 99%". The test count matches the current suite (139 passed), but the review's `test_plan_changes.py` file no longer exists in `backend/tests/market/`; its cases were folded into the other modules. Update the test-module table.
- `planning/MARKET_DATA_REVIEW.md` is a point-in-time review; its own header says all findings are fixed, so it should not be treated as current status.
- `planning/` holds two overlapping design docs (`MARKET_DATA_DESIGN.md` at ~72 KB and `MARKET_INTERFACE.md` at ~21 KB) plus archive copies. Agents may load stale guidance; consider moving superseded docs into `planning/archive/` and keeping `MARKET_DATA_SUMMARY.md` as the entry point.

---

*Concerns audit: 2026-10-23*
