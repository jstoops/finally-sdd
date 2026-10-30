---
phase: 01-live-market-terminal
reviewed: 2026-10-27T08:36:37Z
depth: standard
files_reviewed: 64
files_reviewed_list:
  - .dockerignore
  - .env.example
  - backend/.python-version
  - backend/app/api/__init__.py
  - backend/app/api/system.py
  - backend/app/api/watchlist.py
  - backend/app/config.py
  - backend/app/db/__init__.py
  - backend/app/db/schema.sql
  - backend/app/db/seed.py
  - backend/app/errors.py
  - backend/app/main.py
  - backend/app/snapshots.py
  - backend/app/tickers.py
  - backend/app/tracker.py
  - backend/app/watchlist.py
  - backend/pyproject.toml
  - backend/tests/conftest.py
  - backend/tests/test_config.py
  - backend/tests/test_main.py
  - backend/tests/test_snapshots.py
  - backend/tests/test_tracker.py
  - backend/tests/test_watchlist.py
  - docker-compose.yml
  - Dockerfile
  - frontend/.env.development
  - frontend/.gitignore
  - frontend/AGENTS.md
  - frontend/CLAUDE.md
  - frontend/eslint.config.mjs
  - frontend/next.config.ts
  - frontend/package.json
  - frontend/postcss.config.mjs
  - frontend/src/api/client.ts
  - frontend/src/api/ticker.test.ts
  - frontend/src/api/ticker.ts
  - frontend/src/api/types.ts
  - frontend/src/app/globals.css
  - frontend/src/app/layout.tsx
  - frontend/src/app/page.tsx
  - frontend/src/components/ChartPanel.test.tsx
  - frontend/src/components/ChartPanel.tsx
  - frontend/src/components/Header.tsx
  - frontend/src/components/terminal.test.tsx
  - frontend/src/components/Terminal.tsx
  - frontend/src/components/watchlist.test.tsx
  - frontend/src/components/Watchlist.tsx
  - frontend/src/domain/chart.test.ts
  - frontend/src/domain/chart.ts
  - frontend/src/domain/market.test.ts
  - frontend/src/domain/market.ts
  - frontend/src/store/prices.ts
  - frontend/src/store/watchlist.ts
  - frontend/src/stream/priceStream.test.ts
  - frontend/src/stream/priceStream.ts
  - frontend/src/test/FakeEventSource.ts
  - frontend/tsconfig.json
  - frontend/vitest.config.mts
  - frontend/vitest.setup.ts
  - README.md
  - scripts/start_mac.sh
  - scripts/start_windows.ps1
  - scripts/stop_mac.sh
  - scripts/stop_windows.ps1
findings:
  critical: 1
  warning: 5
  info: 11
  total: 17
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-10-27T08:36:37Z
**Depth:** standard
**Files Reviewed:** 64
**Status:** issues_found

## Summary

I reviewed the Phase 1 backend (app factory, lifespan, SQLite layer, watchlist service and router, tracker, snapshots, error envelope, config), the container and script layer (Dockerfile, compose, `.dockerignore`, start and stop scripts), and the Next.js frontend (API client, stores, price stream, watchlist, chart panel, header and terminal shell), plus their tests. I checked them against PLAN.md sections 6 to 8 and 10 and the conventions in `.claude/CLAUDE.md`.

Overall the code is careful. The watchlist mutations are serialized behind one lock, transactions roll back correctly in the normal case, the SSE "replace, never merge" store matches the server's full-frame semantics (I confirmed this against `app/market/stream.py`), Lightweight Charts accepts fractional Unix-second times (I confirmed this in the library's `timestampConverter` and `fillWeightsForPoints`), and the tests cover concurrency, the 50-ticker cap and the reconnect state machine.

The main defect is a data-loss path in Docker. A blank `DB_PATH` (PLAN §5 shows exactly `DB_PATH=`) makes the backend fall back to `REPO_ROOT/db/finally.db`. Inside the image `REPO_ROOT` resolves to `/`, so the database lands at `/db/finally.db` in the container's writable layer, outside the `finally-data` volume, and is lost on the next `docker compose down`/`up`. The other findings are robustness gaps: a watchlist add that commits but fails to reconcile is never repaired by a retry, a clean checkout fails `npm run typecheck`, the red "disconnected" dot is effectively unreachable when the server is down, the watchlist never re-fetches after a failed first load, and a rollback can hide the original SQLite error.

Note: the secret-file guard blocked reading `frontend/.env.development` directly. I checked its expected content (`NEXT_PUBLIC_API_BASE=http://localhost:8000`) through the plan's verification command in `01-03-PLAN.md:248`, and it is listed only because it was in scope. I skimmed `frontend/src/domain/market.test.ts` but did not read it in full; it tests pure helpers only.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Blank `DB_PATH` puts the Docker database outside the persistent volume (data loss)

**File:** `backend/app/config.py:13-14`, `backend/app/config.py:42`, `docker-compose.yml:13-15`
**Issue:** `REPO_ROOT = Path(__file__).resolve().parents[2]`. Inside the image the module lives at `/app/app/config.py`, so `parents[2]` is `/` and `DEFAULT_DB_PATH` is `/db/finally.db`. `docker compose` injects `env_file: .env`, and env_file values override the image's `ENV DB_PATH=/app/db/finally.db`. A `.env` containing `DB_PATH=` therefore sets `DB_PATH` to the empty string in the container. `_env("DB_PATH")` turns that into `None`, and the app uses `/db/finally.db`, which is outside the `finally-data` volume mounted at `/app/db`. Every trade, watchlist change and snapshot then goes into the container's writable layer and is silently lost on the next `docker compose down && up` (the stop scripts run `down`, which deletes the container).

This is not hypothetical. PLAN §5 shows the line `DB_PATH=` verbatim in the environment block, so a user who builds `.env` from PLAN, or from an older template, hits it. The `from_env` docstring says the opposite of what happens in Docker: "an empty `DB_PATH=` falls back to the default instead of resolving to a path outside the data volume". The only defence today is a comment in `.env.example`. The startup log line `App: database at /db/finally.db` is the only symptom.
**Fix:** Make the container path immune to `.env`. Compose's `environment:` takes precedence over `env_file:`:
```yaml
# docker-compose.yml
services:
  app:
    env_file:
      - path: .env
        required: false
    environment:
      DB_PATH: /app/db/finally.db   # wins over a blank DB_PATH= in .env
```
Also correct the docstring and, ideally, fail loudly when the resolved default is not under the repo `db/` directory (for example, log a warning when `REPO_ROOT == Path("/")`). Add a test that simulates the container layout, or at least asserts compose sets `DB_PATH` under `environment`.

## Warnings

### WR-01: A watchlist add that commits but fails to reconcile is never repaired by a retry

**File:** `backend/app/watchlist.py:59-64`
**Issue:** `_add_tx` commits the row first, then `reconcile()` runs. If `source.add_ticker` raises (for example a simulator Cholesky rebuild failure, or any future source error), the client gets a 500 even though the row is committed, and the source does not price the ticker. The natural retry (`POST` the same ticker) then takes the `created == False` branch, which skips `reconcile()` entirely and returns 200 with `price: null`. The ticker stays unpriced until some unrelated mutation happens to reconcile. `remove()` has the same split: the DB delete is committed before a reconcile that may raise.
**Fix:** Reconcile on every add under the lock, not only on creation (reconcile is a no-op when nothing differs), and don't turn a reconcile failure into a 500 for an already-committed change:
```python
async with self._lock:
    row, created = await asyncio.to_thread(self._add_tx, ticker)
    try:
        await self._tracker.reconcile()   # idempotent; also heals a previous failure
    except Exception:
        logger.exception("Tracker: reconcile failed after adding %s", ticker)
    return self._entry(*row), created
```

### WR-02: `npm run typecheck` fails on a clean checkout

**File:** `frontend/src/app/layout.tsx:11`, `frontend/package.json:12`, `frontend/.gitignore:41`
**Issue:** `RootLayout({ children }: LayoutProps<"/">)` relies on the global `LayoutProps` type, which only exists in the generated `.next/types/routes.d.ts`. That file is pulled in by `next-env.d.ts`, which is gitignored. On a fresh clone, or in CI before `next build`/`next dev`, `tsc --noEmit` fails with `Cannot find name 'LayoutProps'`. The Docker build still works because `next build` runs typegen first, which hides the problem.
**Fix:** Generate the types before checking, or drop the dependency on them:
```json
"typecheck": "next typegen && tsc --noEmit"
```
or type the prop directly: `({ children }: { children: React.ReactNode })`.

### WR-03: The red "disconnected" state is effectively unreachable when the server is down

**File:** `frontend/src/stream/priceStream.ts:53-65`
**Issue:** The stream reports `closed` only when `readyState === CLOSED`. Browsers reach CLOSED only for HTTP-level failures (non-200, wrong content type). For the common real-world disconnect (container stopped, connection refused, network drop), the spec says the browser keeps "reestablishing", so readyState stays CONNECTING forever and the dot stays yellow indefinitely. PLAN §2 defines red as "disconnected". The README documents the yellow behaviour, but users still can't tell a 1-second blip from a server that has been down for ten minutes.
**Fix:** Count consecutive errors without an intervening `onopen`, or time how long the stream has been in CONNECTING, and report `closed` past a threshold while still letting the browser retry:
```ts
let failures = 0;
source.onopen = () => { attempt = 0; failures = 0; opts.onStatus("open"); };
source.onerror = () => {
  if (source.readyState !== ES_CLOSED) {
    failures += 1;
    opts.onStatus(failures >= 3 ? "closed" : "connecting");
    return;
  }
  // ...existing CLOSED handling
};
```

### WR-04: The watchlist is fetched once and never recovers from a failed load

**File:** `frontend/src/store/watchlist.ts:45-54`, `frontend/src/components/Terminal.tsx:40-43`
**Issue:** `loadWatchlist()` runs once on mount. If it fails (backend restarting, the `next dev` loop started before uvicorn, a transient 5xx), the panel shows the error and an empty list until a full page reload, while the SSE stream reconnects and streams prices for rows that are never rendered. The error path also shows the raw `TypeError` text ("Failed to fetch") instead of the store's own `NETWORK_ERROR` message used by add and remove, so the same failure produces two different messages.
**Fix:** Re-fetch the watchlist whenever the price stream goes to `open` after a non-open state (this also resyncs after a backend restart), and route the load error through `failureMessage(err)`:
```ts
} catch (err) {
  set({ loaded: true, loadError: failureMessage(err) });
}
```

### WR-05: Rollback can mask the original SQLite error

**File:** `backend/app/db/__init__.py:59-65`
**Issue:** On any exception, `transaction()` runs `conn.execute("ROLLBACK")` unconditionally. When SQLite has already rolled the transaction back itself (SQLITE_FULL, SQLITE_IOERR, some SQLITE_BUSY cases, or a statement that ended the transaction), `ROLLBACK` raises `OperationalError: cannot rollback - no transaction is active`. That replaces the real exception, so the log shows a misleading error and the root cause is lost.
**Fix:**
```python
except BaseException:
    if conn.in_transaction:
        conn.execute("ROLLBACK")
    raise
```

## Info

### IN-01: Live ticks that arrive while history is in flight are dropped from the chart

**File:** `frontend/src/components/ChartPanel.tsx:148-159`, `frontend/src/components/ChartPanel.tsx:172-183`
**Issue:** Ticks ingested before `historyLoadedRef` flips are ignored. After `finish()`, the newest tick already in the store is not appended until the next store change, and the one that triggered nothing is lost. With the simulator this is a sub-second gap. In Massive mode (15 s polls) the chart can lag by one poll and permanently miss that point. The history request also has no abort or timeout, so a hung request leaves "Loading X…" up indefinitely.
**Fix:** At the end of `finish()`, append `usePrices.getState().ticks[selected]` when `isNewer(...)`. Pass an `AbortController` signal to `apiFetch` and abort it in an effect cleanup.

### IN-02: A stale `loadWatchlist` response can overwrite a newer add or remove

**File:** `frontend/src/store/watchlist.ts:47-48`
**Issue:** `setEntries(data.tickers)` replaces the list wholesale. If an add or remove completes between the server generating the GET response and it being applied, the row reappears or disappears until the next load. This is unlikely during Phase 1's single initial load, but it matters once PLAN §10 re-fetches after chat actions.
**Fix:** Tag loads with a request counter and drop responses older than the latest local mutation.

### IN-03: DELETE with a malformed path ticker returns 400, not 404

**File:** `backend/app/watchlist.py:68`
**Issue:** PLAN §8 lists only `204` and `404` for `DELETE /api/watchlist/{ticker}`. A malformed symbol can never be on the watchlist, yet it gets a 400. The frontend treats only 404 as "already gone".
**Fix:** In `remove()`, map a `DomainError` from `normalize_ticker` to `NotFoundError`, or document the 400 as intentional.

### IN-04: The `/api/*` catch-all hides 405s and misses HEAD and OPTIONS

**File:** `backend/app/main.py:114-120`
**Issue:** A wrong method on a real route (`PUT /api/watchlist`) now returns 404 instead of 405, which is documented. `HEAD` and `OPTIONS` on unknown `/api/*` paths are not listed, so they fall through to `StaticFiles` and get an HTML 404 rather than the JSON envelope.
**Fix:** Add `"HEAD"` and `"OPTIONS"` to `methods` (CORS preflights are answered earlier by the middleware), and consider returning 405 when the path matches a known route.

### IN-05: The ticker error message echoes unbounded user input

**File:** `backend/app/tickers.py:25-27`
**Issue:** `f"Invalid ticker {symbol!r}: ..."` reflects the whole request value, which can be megabytes, and uses Python `repr` quoting in a user-facing message.
**Fix:** Truncate, for example `symbol[:20]`, or drop the value from the message.

### IN-06: Client sanitizer silently rewrites "BRK B" into "BRKB"

**File:** `frontend/src/api/ticker.ts:15-17`
**Issue:** `sanitizeTickerInput` removes all inner whitespace, so a user who types a space meaning "." submits a different valid symbol without any warning. The server would reject `"BRK B"`.
**Fix:** Strip only leading and trailing whitespace and let `tickerError` reject inner spaces.

### IN-07: `apiFetch` header merge drops `Headers` instances

**File:** `frontend/src/api/client.ts:37-44`
**Issue:** `...init?.headers` spreads a `Headers` object or a tuple array into `{}` or index keys, so caller headers are silently lost. Today every call passes no headers, but this will bite later callers.
**Fix:** `const headers = new Headers(init?.headers); if (!headers.has("Content-Type")) headers.set(...)`.

### IN-08: The image can include stale `backend/static` assets and test code, and runs as root

**File:** `Dockerfile:37-42`, `.dockerignore`
**Issue:** `COPY backend/ ./` copies `backend/static` if a developer populated it (it is the local `DEFAULT_STATIC_DIR` and is in neither `.gitignore` nor `.dockerignore`). `COPY --from=frontend /frontend/out ./static` overlays it but does not delete stale files. `backend/tests` is shipped as well. The container also runs uvicorn as root.
**Fix:** Add `backend/static` and `backend/tests` to `.dockerignore` and `backend/static/` to `.gitignore`. Add a non-root `USER` that owns `/app/db`.

### IN-09: The compose file needs Compose 2.24+, and the app is reachable from the LAN by default

**File:** `docker-compose.yml:12-15`
**Issue:** The `env_file` long syntax (`path`/`required`) fails to parse on Docker Compose releases older than 2.24, and the start scripts don't check the version. `"8000:8000"` follows PLAN §11 and the README discloses it, but it exposes an unauthenticated trading UI to the LAN. From Phase 3 that UI can also spend the user's OpenRouter credits.
**Fix:** Document the minimum Compose version in the README, or check it in the start scripts. Consider making `127.0.0.1:8000:8000` the default.

### IN-10: A chart time-format test depends on the host locale

**File:** `frontend/src/domain/chart.test.ts` (the "uses local wall-clock time" case), `frontend/src/domain/chart.ts:43-48`
**Issue:** `Intl.DateTimeFormat(undefined, …)` follows the runner's locale. Under locales with non-Latin digits (for example `ar-EG`), the `^\d{2}:\d{2}:\d{2}$` assertions fail, which makes the test environment-dependent.
**Fix:** Pin `TZ`/`LANG` in the vitest config, or pass a `numberingSystem: "latn"` option to the formatter.

### IN-11: A cancelled snapshot can still write after shutdown starts

**File:** `backend/app/snapshots.py:49-52`, `backend/app/main.py:74-79`
**Issue:** Cancelling the snapshot task while it awaits `asyncio.to_thread(self._record_tx)` releases the lock and ends the task, but the worker thread keeps running and commits a snapshot after `source.stop()` has run. This is harmless today, but it contradicts the "stop the snapshot task first" comment.
**Fix:** Accept it and update the comment, or shield the in-flight write: `await asyncio.shield(asyncio.to_thread(...))`, then let cancellation take effect after the commit.

---

_Reviewed: 2026-10-27T08:36:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
