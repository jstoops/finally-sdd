---
phase: 01-live-market-terminal
fixed_at: 2026-10-27T13:15:00Z
review_path: .planning/phases/01-live-market-terminal/01-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-10-27T13:15:00Z
**Source review:** .planning/phases/01-live-market-terminal/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 critical, 5 warnings; fix_scope = critical_warning, so IN-01 to IN-11 were not attempted)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### CR-01: Blank `DB_PATH` puts the Docker database outside the persistent volume (data loss)

**Files modified:** `docker-compose.yml`, `backend/app/config.py`, `backend/tests/test_config.py`, `.env.example`, `README.md`
**Commit:** 6524d2d
**Applied fix:** Two layers of protection:
- `docker-compose.yml` now pins `DB_PATH: /app/db/finally.db` under `environment:`. That setting takes precedence over `env_file:`, so a blank `DB_PATH=` in `.env` can no longer override it. `docker compose config` shows the pinned value.
- `config.py` gained `default_db_path(config_file)`. When the computed repo root is the filesystem root (the container layout, `/app/app/config.py`), it returns `<backend>/db/finally.db`, which is `/app/db/finally.db`, the volume path. Locally it still returns `<repo>/db/finally.db`.

The `from_env` docstring no longer makes the incorrect claim. The `.env.example` DB_PATH guidance and the README table row now say Docker always uses the pinned path. New tests cover the local layout, the container layout, and a parse of `docker-compose.yml` that checks `environment.DB_PATH` sits inside the volume mount target.

### WR-01: A watchlist add that commits but fails to reconcile is never repaired by a retry

**Files modified:** `backend/app/watchlist.py`, `backend/tests/test_watchlist.py`
**Commit:** cb3ce2b
**Applied fix:** Both `add()` and `remove()` now go through a new `_reconcile(action, ticker)` helper, which runs while the lock is held. It catches `Exception`, logs it with `logger.exception`, and does not raise, so a change that is already committed never turns into a 500. `add()` now reconciles on every call, not only when the row is new, so retrying the same ticker repairs the source. Reconcile is idempotent. New `TestReconcileFailure` tests use a source whose calls fail once on demand. They cover three cases: a failed reconcile on add is not an error, a re-add repairs the source, and a failed reconcile on remove is not an error and the next mutation repairs it. All three fail without the fix.
**Status note:** fixed: requires human verification. This changes error-handling behaviour: a source failure is now logged instead of returned as a 500.

### WR-02: `npm run typecheck` fails on a clean checkout

**Files modified:** `frontend/package.json`
**Commit:** 71b7447
**Applied fix:** The `typecheck` script is now `next typegen && tsc --noEmit`, which only edits a script line and adds no dependency. I reproduced the failure first by moving `.next/` and `next-env.d.ts` aside: `tsc --noEmit` reported `Cannot find name 'LayoutProps'`. `next typegen` then regenerated `next-env.d.ts` (byte-identical to the previous file) and `.next/types`, and `tsc` passed. I then restored the original build artifacts. I added no automated test, because the fix is a script change; the reproduction above is the verification.

### WR-03: The red "disconnected" state is effectively unreachable when the server is down

**Files modified:** `frontend/src/stream/priceStream.ts`, `frontend/src/stream/priceStream.test.ts`, `README.md`
**Commit:** 4a93b73
**Applied fix:** New exported constant `DISCONNECTED_AFTER_FAILURES = 3`. Rule: every `onerror` counts as one failed attempt, and only `onopen` resets the count. While the browser is still retrying (CONNECTING), the status is "connecting" (yellow) until 3 consecutive failures, then "closed" (red). With `retry: 1000` that is about 3 seconds. The browser keeps retrying, and the next successful open turns the dot green. A CLOSED readyState still reports "closed" at once and recreates the EventSource with the existing backoff. During a long outage, a recreated instance reports "closed" rather than flickering back to yellow. Three new FakeEventSource tests cover:
- the threshold after an open, then recovery and reset
- failures before the first open
- staying red across a recreated instance

The README connection-indicator section now describes the new rule.
**Status note:** fixed: requires human verification. This changes the status logic.

### WR-04: The watchlist is fetched once and never recovers from a failed load

**Files modified:** `frontend/src/store/watchlist.ts`, `frontend/src/components/Terminal.tsx`, `frontend/src/components/terminal.test.tsx`
**Commit:** cbcee40
**Applied fix:**
- `loadWatchlist` now sets its error through `failureMessage(err)`, so a network failure shows the same "Could not reach the server. Try again." text as add and remove. Server error text is still passed through.
- `Terminal` subscribes to the prices store and calls `loadWatchlist()` again whenever the status changes from not-open to "open". It skips the first open after mount unless the initial load failed, which avoids a duplicate request on a normal page load. It unsubscribes in the effect cleanup, which is safe under StrictMode.

Four new tests cover:
- the generic network message
- recovery from a failed first load when the stream opens
- a re-fetch on reconnect but not on the first open or on frames
- no re-fetches after unmount

The first three fail without the fix.
**Status note:** fixed: requires human verification. This changes state-sync behaviour. Re-fetching more often makes the stale-load race in IN-02 (out of scope here) slightly more likely.

### WR-05: Rollback can mask the original SQLite error

**Files modified:** `backend/app/db/__init__.py`, `backend/tests/test_main.py`
**Commit:** 1aa139a
**Applied fix:** `transaction()` now runs `ROLLBACK` only when `conn.in_transaction` is true, with a comment explaining why. Two tests were added to `TestDatabase`. One confirms that an error still rolls back the write. The other ends the transaction inside the block and then raises, and checks that the original `ValueError` reaches the caller. That second test fails without the fix: the caller gets "cannot rollback - no transaction is active" instead.

## Verification

All gates ran **in the main checkout** (`E:/Development/AI-Coding/finally-std`, branch `finally-gsd`), not in an isolated worktree. The caller told me to work directly on the branch, and a hand-rolled worktree would have no `node_modules` to run the frontend gates with. The numbers below can be reproduced from the current tree.

- Backend: `uv run --extra dev pytest -q`: 258 passed (250 before the fixes). `ruff check .`: all checks passed. `ruff format --check .`: 38 files already formatted.
- Frontend: `npm test`: 117 passed across 7 files (110 before the fixes). `npm run lint`: clean. `npm run build`: static export succeeded. `npm run typecheck` (now `next typegen && tsc --noEmit`): exit 0.
- `docker compose config` resolves `DB_PATH: /app/db/finally.db` under the app service's environment.

No lockfiles, dependencies or `.env` were touched.

---

_Fixed: 2026-10-27T13:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
