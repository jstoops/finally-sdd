# Pitfalls Research

**Domain:** AI-powered simulated trading workstation (FastAPI + SSE + stdlib SQLite, Next.js static export served by FastAPI, Lightweight Charts, LiteLLM → OpenRouter/Cerebras structured outputs with auto-executed trades, single Docker container, Playwright E2E)
**Researched:** 2026-10-23
**Confidence:** MEDIUM overall. Items tagged **[repo-verified]** were checked directly against this repository and are HIGH. Items tagged **[docs]** come from official documentation fetched during this session (Lightweight Charts 5.2, Next.js static-export guide, Starlette `staticfiles.py` source, Python 3.12 `sqlite3` docs, OpenRouter provider routing and structured-output docs, Cerebras structured-output docs). The GSD confidence seam rates all web-fetched sources LOW, so treat **[docs]** as MEDIUM-HIGH and verify version-specific details when implementing. Items tagged **[inferred]** come from known behaviour and reasoning, not a source checked in this session. Validate them in the phase that owns them.

Phase names used below match the PROJECT.md Active groups: **Backend foundation**, **Portfolio & trading**, **Watchlist & tracked tickers**, **AI chat**, **Frontend**, **Packaging & ops**, **Testing**.

---

## Critical Pitfalls

### Pitfall 1: The root `.gitignore` silently drops frontend source and fails to ignore build/DB artifacts **[repo-verified]**

**What goes wrong:**
The root `.gitignore` is the stock GitHub Python template. Its unanchored `lib/` (line 17) and `build/` (line 11) rules match any directory with those names. `git check-ignore` confirms that `frontend/src/lib/api.ts` and `frontend/lib/x.ts` are ignored. Next.js projects almost always have a `lib/` folder (API client, SSE store, treemap layout). Those files never get committed, so a parallel worktree agent or the Docker build context never sees them, and the build fails with "Module not found: '@/lib/...'" only on a clean checkout. Also, `node_modules/`, `.next/`, `out/`, `db/finally.db`, `db/*.db-wal`/`-shm`, `test-results/` and `playwright-report/` are **not** ignored today. PLAN §4 says `finally.db` is gitignored, but no rule does this.

**Why it happens:**
Python-template ignore files are written for Python packaging layouts. Nobody re-reads them when a JS project joins the repo.

**How to avoid:**
As the first commit of the milestone: anchor or remove `lib/`, `lib64/`, `build/`, `dist/`, `parts/`, `var/` and `downloads/` (or scope them to `/backend/`). Add `node_modules/`, `frontend/.next/`, `frontend/out/`, `db/*.db*`, `test/test-results/`, `test/playwright-report/` and `backend/static/` if it is a build target. Add a `.gitattributes` in the same commit (see Pitfall 16).

**Warning signs:**
`git status` stays clean after creating files under `frontend/src/lib/`. A worktree build fails on imports that resolve locally. `git check-ignore -v <path>` names `.gitignore:17`.

**Phase to address:** Backend foundation (first task, before any frontend agent starts).

---

### Pitfall 2: Blocking the asyncio event loop freezes every SSE stream **[inferred, HIGH]**

**What goes wrong:**
The SSE generator, the simulator loop (`asyncio.create_task`) and the 30 s snapshot task all share one event loop. Any blocking call inside an `async def` route stalls them all. Examples are a stdlib `sqlite3` query, `litellm.completion()` (synchronous and 1–3 s, longer on retries), or `time.sleep`. Prices freeze, flashes stop, and the connection dot stays green because the TCP connection is still open.

**Why it happens:**
FastAPI makes `async def` look free. The existing market code is careful (`asyncio.to_thread` in the Massive poller), but new route authors copy the `async def` style from `stream.py` and put blocking calls inside.

**How to avoid:**
- Write DB-touching routes as plain `def` (FastAPI runs them in the threadpool), or wrap the work in `await asyncio.to_thread(...)`. Pick one convention and document it in `backend/CLAUDE.md`.
- For chat, use `await litellm.acompletion(...)` or call `completion` via `to_thread`. The cerebras skill snippet uses sync `completion`, so adapt it for async routes.
- The snapshot task must do its DB write through `to_thread`.

**Warning signs:**
Sparklines show a flat gap for 1–3 s every time a chat message is sent. The SSE frame interval in the browser Network tab jumps from 500 ms to more than 1 s during trades. A test that measures SSE frame gaps during `POST /api/chat` with a slow mock fails.

**Phase to address:** Backend foundation (convention), AI chat (LLM call). Add a regression test in Testing: a mock LLM with an artificial 1 s delay must not delay SSE frames.

---

### Pitfall 3: `sqlite3` connection/thread/transaction semantics **[docs]**

**What goes wrong:**
- `check_same_thread=True` is the default. A connection created in a sync FastAPI dependency (one threadpool thread) and used in a sync endpoint (possibly another thread) raises `ProgrammingError: SQLite objects created in a thread can only be used in that same thread`. It fails intermittently, because it depends on threadpool scheduling.
- A single module-level connection with `check_same_thread=False` shared across threads causes interleaved transactions. One request's `commit()` commits another request's half-done trade.
- Legacy transaction control (still the Python 3.12 default) implicitly opens a **DEFERRED** transaction only before `INSERT/UPDATE/DELETE/REPLACE`. A `SELECT cash_balance` before the first write therefore runs **outside** the transaction, which breaks a check-then-write trade (see Pitfall 4).
- `executescript()` issues an implicit `COMMIT` first, and it is the natural way to run `schema.sql`. Never call it inside a trade or reset transaction.
- `with conn:` commits or rolls back but **does not close** the connection. Connections leak unless you use `contextlib.closing` or an explicit `close()`.
- Default `timeout=5.0`. Under contention a deferred read→write upgrade can return `database is locked`.

**Why it happens:**
The PLAN's "stdlib sqlite3, no ORM" choice is right, but the stdlib defaults are legacy and do not suit threaded servers.

**How to avoid:**
- One helper: `get_conn()` opens a new connection per unit of work (cheap for SQLite) with `isolation_level=None` (explicit transactions), `row_factory=sqlite3.Row`, `PRAGMA busy_timeout=5000`, `PRAGMA foreign_keys=ON`. It is used as `with closing(get_conn()) as conn:`.
- A `transaction(conn)` context manager that issues `BEGIN IMMEDIATE` (takes the write lock up front) and `COMMIT`/`ROLLBACK`.
- Set `PRAGMA journal_mode=WAL` once at startup. It persists in the file and lets SSE-adjacent reads proceed during writes.
- Run `schema.sql` with `executescript` only in the startup path, then the seed with `INSERT OR IGNORE` in its own transaction.

**Warning signs:**
Sporadic `ProgrammingError` under load tests. `database is locked` in logs. Tests pass alone and fail under `pytest -n`. Cash changes without a matching trade row.

**Phase to address:** Backend foundation (DB helper). Portfolio & trading (transaction usage).

---

### Pitfall 4: Trade, snapshot and reset races corrupt cash and positions **[inferred, HIGH]**

**What goes wrong:**
The trade path is read cash/position → validate → write cash/position/trade → snapshot. Concurrent callers interleave: a double-clicked Buy, a chat trade at the same time as a manual trade, the 30 s snapshot task, or a reset. Both requests read $10,000, both pass the cash check, and the account goes negative. Or a snapshot computed just before a reset is written just after it, so the fresh P&L chart starts with the old portfolio value. Or the price is read from `PriceCache` outside the critical section, and the fill price differs from the price used in the cash check.

**Why it happens:**
"Each trade runs in one SQLite transaction" (PLAN §7) sounds sufficient. But a DEFERRED transaction does not protect a read that happens before the first write (Pitfall 3), and snapshot/reset are separate code paths.

**How to avoid:**
- One process-wide `threading.Lock` (the app is single-process and single-worker by design) held around: price read → validation → `BEGIN IMMEDIATE` … `COMMIT` → post-trade snapshot. Use the same lock for reset and for the periodic snapshot. It is simple, correct and cheap at this scale. `BEGIN IMMEDIATE` is the second line of defence.
- One `execute_trade(conn, ticker, side, qty)` service function shared by the manual route, the chat executor and tests. Never duplicate the rules.
- The tracked-ticker side effects of a trade (sell-to-zero → `remove_ticker`) run after the commit, still under the lock.
- Frontend: disable Buy/Sell while a request is in flight.

**Warning signs:**
A concurrency test (fire 20 parallel buys that together exceed cash) ends with negative cash or more than the affordable number of trades. P&L chart shows a spike right after reset.

**Phase to address:** Portfolio & trading. Reset and snapshot task share the lock in the same phase.

---

### Pitfall 5: Float money math, rounding and unit confusion **[repo-verified for units, inferred for the rest]**

**What goes wrong:**
- **Percent vs fraction units are mixed in the contract.** In PLAN §8, `unrealized_pnl_percent: 0.0105` for $0.20 on $1,905 is **percent** units (0.0105 %), and SSE `change_percent` is percent too. But `weight: 1.0` is a **fraction**. The frontend will multiply one of them by 100 twice, or the LLM context will say a position is "1.05 %" when it is 0.0105 %.
- **"Buy max" is rejected.** A user (or the LLM) computes `cash / price`. After rounding to 4 dp, `qty * price` can exceed cash by fractions of a cent, so `quantity * price <= cash_balance` fails with "insufficient cash".
- **Accumulated drift.** `cash -= qty * price` over hundreds of trades leaves `cash_balance = 8095.000000000002`. That leaks into JSON, the UI and the LLM prompt.
- **Rounding avg_cost to 2 dp** corrupts P&L % for fractional and low-priced positions.
- **NaN/inf** (division by a zero `positions_value` or zero price) makes Starlette's JSON encoder raise a 500, because it uses `allow_nan=False`.

**Why it happens:**
REAL columns and Python floats are the PLAN's choice, which is fine for a simulator, but nobody defines the rounding points.

**How to avoid:**
- Define rounding points once in the trade service: cash rounded to cents on every write (`round(x, 2)`), quantity to 4 dp (PLAN), avg_cost **not** rounded (or at least 6 dp), `price` already 2 dp from the cache.
- Compare with a tolerance: `cost <= cash + 0.005` (half a cent), mirroring the PLAN's `1e-6` share tolerance on sells.
- Guard every division (`weight = mv / positions_value if positions_value > 0 else 0`).
- Write the units into the API contract in PLAN or a shared `types.ts`: "`*_percent` fields are percent (×100 already); `weight` is a 0–1 fraction". Add a frontend unit test for the formatter.
- Optional: compute with `Decimal` inside the trade function and store floats. Not required if the rounding points are enforced.

**Warning signs:**
Header shows `$8,095.000000002`. Heatmap tile sizes look right but P&L % is 100× off. "Buy all" fails with "insufficient cash (need $10,000.00, have $10,000.00)".

**Phase to address:** Portfolio & trading (backend math, contract note). Frontend (formatters).

---

### Pitfall 6: Tracked-ticker invariant (watchlist ∪ positions) broken at one of its five edges **[repo-verified via CONCERNS.md]**

**What goes wrong:**
CONCERNS.md records that the remove-only-if-unheld rule has **no enforcing caller**. Calling `remove_ticker` on a held ticker deletes its price, history and session open from `PriceCache`. Valuation then silently falls back to `avg_cost`, so P&L shows 0 and the heatmap goes grey. The five edges each get their own ad-hoc code:
1. Watchlist remove while the ticker is held.
2. Sell-to-zero of an unwatched ticker.
3. LLM `watchlist_changes` remove.
4. Reset re-sync: held non-default tickers must be removed, and removed default tickers re-added.
5. Startup: watchlist ∪ positions.

Related concerns:
- No ticker cap. The LLM can add dozens of tickers, and the simulator's `_rebuild_cholesky` is O(n²)+O(n³) on the event loop and can raise `LinAlgError`.
- In Massive mode a newly added ticker has no price for up to `MASSIVE_POLL_INTERVAL`, so the LLM's "add PYPL then buy PYPL" fails by design.

**Why it happens:**
The rule spans the watchlist, trading, chat and reset code, and each is written by a different agent or plan.

**How to avoid:**
- One `TrackedTickers` service (or `sync_tracked(conn, source)`) that computes `watchlist ∪ positions` from the DB and diffs it against `source.get_tickers()`. Call it after **every** watchlist change, trade commit and reset, and at startup. Diffing the full set removes the per-edge logic entirely.
- Enforce a cap (for example 50 watchlist entries) in the watchlist service, which returns 400. Wrap simulator `add_ticker` failures so they become a failed action, not a 500.
- In the chat failure note for Massive mode, say "price not available yet, try again in ~15 s". The existing "Add it to your watchlist first" message is misleading when the ticker *is* on the watchlist.

**Warning signs:**
A held position shows `current_price == avg_cost` exactly. The ticker disappears from the SSE frame while still in `/api/portfolio`. Reset leaves ghost tickers in the SSE stream.

**Phase to address:** Watchlist & tracked tickers (the service), reused in Portfolio & trading, AI chat, and Reset. Tests: PLAN §12 "Tracked tickers" cases plus reset re-sync.

---

### Pitfall 7: `DB_PATH` resolves outside the Docker volume, so data is lost on every restart **[inferred, HIGH]**

**What goes wrong:**
`.env.example` (PLAN §5) ships `DB_PATH=` empty. `docker compose` `env_file: .env` injects `DB_PATH=""`, and that **overrides** the Dockerfile's `ENV DB_PATH=/app/db/finally.db`. If the code does `os.environ.get("DB_PATH", default)`, it gets `""`. If it treats empty as unset, it falls back to the local-dev default "`<repo>/db/finally.db`", computed from `__file__`. Inside the image the backend sits at `/app`, so `<repo>` becomes `/` and the DB lands at `/db/finally.db`, outside the `finally-data` volume. Everything works until `docker compose down && up`, then the portfolio is gone. Related failures:
- `sqlite3.connect` creates the file but not the parent directory, so a missing `db/` gives "unable to open database file".
- A non-root container user cannot write to a root-owned named volume.
- A relative `DB_PATH` resolves against the uvicorn cwd.

**Why it happens:**
Empty-string env vars are a different state from unset ones. Local and container directory layouts differ.

**How to avoid:**
- `db_path = os.environ.get("DB_PATH") or DEFAULT`, with `DEFAULT` computed differently in-container, or better, have the Dockerfile set `DB_PATH` **and** keep `DB_PATH` commented out (`# DB_PATH=`) in `.env.example`, not empty.
- At startup: `Path(db_path).resolve().parent.mkdir(parents=True, exist_ok=True)` and log the resolved absolute path once at INFO.
- Same rule for `MASSIVE_API_KEY=`, `MASSIVE_POLL_INTERVAL=` and `LLM_MOCK=`: treat empty as unset (the PLAN already says this for the Massive key).
- Packaging acceptance test: trade, `docker compose down`, `up`, and the position is still there.

**Warning signs:**
Startup log shows a DB path that does not start with `/app/db/`. `docker volume inspect finally-data` shows an empty mountpoint after trading.

**Phase to address:** Backend foundation (path resolution), Packaging & ops (compose and env example, persistence test).

---

### Pitfall 8: SSE delivery failures: buffering, connection limits, reconnect semantics, stale state **[docs + inferred]**

**What goes wrong:**
- **Compression buffers the stream.** Adding `GZipMiddleware` (or a third-party gzip middleware) for the static bundle can buffer `text/event-stream`. Starlette fixed its own middleware in 0.46.0 (#2871), but copies such as `asgi-gzip` lagged. The frontend then sees no frames, or frames in bursts.
- **Browser connection limit.** HTTP/1.1 allows 6 connections per origin. Every open tab holds one SSE connection, and React StrictMode in dev mounts effects twice. A leaked `EventSource` (no `close()` in cleanup) eats the pool, and then `fetch('/api/portfolio')` hangs forever.
- **Reconnect semantics are misread.** `onerror` fires with `readyState === CONNECTING` while the browser auto-reconnects (yellow). `CLOSED` means it gave up, for example after a non-200 response or wrong content type (red). Code that sets red on any `onerror` flickers red every reconnect. Code that never handles `CLOSED` stays yellow forever.
- **Heartbeat comments are invisible to JS.** `: keep-alive` lines never reach `onmessage`, so a client-side "stale stream" detector cannot use them. If CONCERNS' fix (skip frames when nothing changed) is applied, Massive mode is silent for 15 s between polls. A naive "no message for 5 s → yellow" detector flaps.
- **Merging frames leaves ghosts.** Each frame is the **full** tracked set. A client that merges frames into its map keeps prices for removed tickers forever (after reset or watchlist removal). The cache already pushes a frame on remove for exactly this reason.
- **Shutdown hangs.** Uvicorn waits for open streaming responses on shutdown. `docker compose down` then waits for the 10 s stop timeout and SIGKILLs, which can interrupt the final SQLite write.

**How to avoid:**
- Do not add gzip middleware (the static bundle is small and local), or exclude `text/event-stream` explicitly. Keep the existing `X-Accel-Buffering: no` and `Cache-Control: no-cache` headers.
- One SSE connection per tab, owned by a single module-level store (not a component). `useEffect` cleanup calls `es.close()`.
- Status mapping: `onopen` → green; `onerror && readyState===CONNECTING` → yellow; `readyState===CLOSED` → red, plus a manual retry with backoff (the browser will not retry after CLOSED).
- **Replace** the client price map with each frame. Do not merge.
- If staleness detection is wanted, base it on data frames with a threshold larger than `MASSIVE_POLL_INTERVAL`, or have the server send a periodic data event instead of a comment.
- Set `--timeout-graceful-shutdown 3` on uvicorn. Make lifespan shutdown cancel the snapshot task and stop the source.

**Warning signs:**
Prices update in bursts. Dot flickers red/yellow on every reconnect. Network tab shows 2+ `/api/stream/prices` requests per tab. `/api/*` calls show "pending" indefinitely. Removed tickers still flash.

**Phase to address:** Backend foundation (middleware choice, shutdown). Frontend (store, status logic, replace semantics). Testing (connection-status transition tests with a mocked EventSource).

---

### Pitfall 9: Lightweight Charts time-axis rules throw at runtime **[docs]**

**What goes wrong:**
Lightweight Charts 5.2 requires `setData` items ordered by ascending time. `update()` requires `time >= latest` (equal **replaces** the last point, older throws unless `historicalUpdate` is set, which is slow). `UTCTimestamp` is **seconds**, not ms. Concrete failures in this app:
- **P&L chart.** Snapshots are ISO strings. They must become Unix seconds. A trade snapshot and the 30 s timer snapshot can land in the **same second**, which creates duplicate times. `setData` asserts "data must be asc ordered by time" and the chart (and possibly the React tree) crashes.
- **Main chart ticker switch race.** On ticker select, the history fetch is in flight while SSE frames keep arriving. If SSE points are appended before `setData(history)`, or a late history response overwrites newer SSE points, the next `update()` sees an older time and throws.
- **Sub-second timestamps.** The SSE and history times are float seconds with 500 ms spacing, and `PriceCache` forces `+0.001` increments. Fractional `UTCTimestamp` is undocumented, so tick labels and crosshair formatting may behave oddly.
- **Milliseconds.** Passing `Date.now()` or `new Date(iso).getTime()` (ms) puts points ~50,000 years in the future.
- **UTC display.** The library renders all times in UTC, so a US user sees axis labels hours off.
- **Lifecycle.** `createChart` inside a component without `chart.remove()` in cleanup creates two charts in one div under StrictMode. A container with no explicit height renders 0 px.

**How to avoid:**
- One `toChartTime()` helper: ISO → `Math.floor(Date.parse(iso)/1000)`; SSE/history float → `Math.floor(ts)`. Bucket to whole seconds and use `series.update()` (same-second points replace, which gives one point per second and is guaranteed valid). Dedupe history by floored second, keeping the last value, before `setData`.
- Guard every `update()`: drop points whose time is below the series' last time. Track the selected ticker and a request id so a late history response for a previous ticker is discarded.
- Use `localization.timeFormatter` / `tickMarkFormatter` (or shift timestamps by the local offset) for local-time labels.
- `autoSize: true` and an explicit container height. Create the chart once per mount and call `remove()` on cleanup. Never recreate it on data change.

**Warning signs:**
Console error mentioning "asc ordered" or "Cannot update oldest data". Chart blank after switching tickers quickly. P&L chart breaks right after a trade near a 30 s boundary.

**Phase to address:** Frontend (chart wrappers with unit tests for dedupe/ordering). Optionally Portfolio & trading: have `GET /api/portfolio/history` dedupe same-second snapshots too.

---

### Pitfall 10: React re-render storm from 500 ms ticks **[inferred, HIGH]**

**What goes wrong:**
Putting the full price map in top-level `useState`/Context re-renders the whole app twice a second: chat panel, positions table, treemap layout and chart wrappers. Typing in the chat input lags. The treemap recomputes the squarified layout every tick. Chart wrappers whose effects depend on `prices` tear down and recreate the chart (flashing canvas, lost zoom). Sparkline arrays "accumulated since page load" grow without bound (10 tickers × 7,200 points/hour), and each tick copies the arrays immutably, so CPU and memory climb over a long demo.

**How to avoid:**
- A small external store (`useSyncExternalStore` or zustand with selectors). Rows subscribe to **their** ticker only. `React.memo` on rows.
- Charts subscribe imperatively: the store callback calls `series.update()`, not React props.
- Treemap layout depends on positions and weights. Recompute on portfolio change, and at most once per second for live values.
- Cap sparkline buffers (for example the last 300 points, or downsample) and use a ring buffer.
- Price flash: re-trigger by toggling a key, or remove the class, force a reflow, then re-add it. Re-adding the same class does not restart the CSS transition. Flash only when the price value actually changed (CONCERNS: frames are sent even when nothing changed).

**Warning signs:**
React Profiler shows the whole tree committing every 500 ms. Chat input drops keystrokes. Memory grows steadily over a 30-minute session. Two consecutive upticks show only one flash.

**Phase to address:** Frontend (state architecture decided **before** building panels).

---

### Pitfall 11: Next.js static export served by FastAPI **[docs: Next.js static-export guide, Starlette `staticfiles.py`]**

**What goes wrong:**
- **Starlette does not append `.html`.** `StaticFiles(html=True)` only resolves `dir/index.html` (with a trailing-slash redirect) and a top-level `404.html`. With the default `trailingSlash: false`, Next emits `out/foo.html`, so `/foo` returns 404.html.
- **Mount order matters.** `app.mount("/", StaticFiles(...))` registered before the API routers shadows them. A typo'd API route returns the HTML 404 page with status 404, and a non-GET request returns 405 from StaticFiles, so the frontend's `res.json()` throws a confusing parse error.
- **Unsupported with `output: 'export'`:** rewrites, redirects, headers, `next/image` with the default loader, Server Actions, dynamic routes without `generateStaticParams`, cookies. Using them errors even in `next dev`.
- **No dev proxy.** Because rewrites are unsupported with export, there is no built-in way to proxy `/api` from `next dev` (port 3000) to FastAPI (8000). Agents then hack in absolute URLs, which breaks the single-origin build, or add CORS.
- **Prerender crashes.** Client components are **prerendered at build**. Lightweight Charts, `EventSource`, `window.confirm`, `localStorage` and `ResizeObserver` touched at module or render scope crash the build ("window is not defined"). `next/dynamic` with `ssr:false` is not allowed from a Server Component.
- **Hydration mismatches.** Formatting numbers or dates in render with the runtime locale (`toLocaleString()` with no locale, `new Date()`) differs between build (Node) and browser, so React reports hydration mismatches.
- **Removed command.** `next export` was removed in v14; agents trained on older docs may emit it.

**How to avoid:**
- Keep the app to a single route (`app/page.tsx`). It is a single-page terminal, so the `.html` issue disappears. If more routes are needed, set `trailingSlash: true` so files are `route/index.html`.
- In `main.py`, include all `/api` routers first, then mount `StaticFiles(directory=static_dir, html=True)` at `/` **last**. Add a catch-all `/api/{path:path}` that returns JSON 404 before the mount.
- Dev story, decided once: `NEXT_PUBLIC_API_BASE` (empty in production), plus `CORSMiddleware` for `http://localhost:3000` enabled only when a `DEV_CORS=true` env var is set. Or simply develop the frontend against `next build && serve via FastAPI`. Document it in `frontend/CLAUDE.md`.
- All browser APIs go inside `useEffect` in `'use client'` components. Charts are created in effects.
- `Intl.NumberFormat('en-US', ...)` with a fixed locale. Live values render only after mount.
- `images: { unoptimized: true }` if `next/image` is used at all.

**Warning signs:**
`next build` fails with "window is not defined". Console hydration warnings. 404 HTML returned to `fetch`. Frontend works in `next dev` but not from port 8000, or the other way round.

**Phase to address:** Backend foundation (static mount and JSON 404). Frontend (scaffold config, dev story, client-only patterns).

---

### Pitfall 12: LLM structured-output failures (schema subset, provider fallback, reasoning tokens) **[docs: OpenRouter, Cerebras]**

**What goes wrong:**
- **Schema rejected by Cerebras strict mode.** Cerebras strict `json_schema` requires `additionalProperties: false` on **every** object and a root object. It does **not** support `pattern`, `format`, `minItems`/`maxItems`, `oneOf`/`allOf`/`not`, or recursive refs. A Pydantic model with `Field(gt=0)`, `pattern=r"^[A-Z]..."` or `Optional[list[...]] = None` (which generates `anyOf: [..., null]`) may be rejected by the provider with a 400, or silently downgraded. `gpt-oss-120b` itself supports strict mode on Cerebras.
- **Fallback provider ignores the schema.** `extra_body={"provider": {"order": ["cerebras"]}}` (the skill snippet) still **falls back** to other providers when Cerebras is unavailable (`allow_fallbacks` defaults to true). `require_parameters` defaults to false, so `response_format` is a soft preference and a fallback provider may ignore it. The output is then prose or fenced JSON, and parsing fails intermittently: "it worked yesterday".
- **Empty content.** `gpt-oss` is a reasoning model. A low `max_tokens` is consumed by reasoning and `message.content` comes back `None`/empty. `model_validate_json(None)` raises a `TypeError`, not a `ValidationError`, and escapes the 502 handler as a 500.
- **Content not usable as is.** Content may arrive wrapped in Markdown code fences or with leading whitespace when not strictly constrained.
- **Wrong types.** The LLM returns `quantity: "10"`, `-5`, `0`, `"all"`, lowercase or company-name tickers (`"Apple"`), or `side: "BUY"`.

**How to avoid:**
- Schema: `trades: list[Trade]` and `watchlist_changes: list[WatchlistChange]` as **required** fields that may be empty, not Optional. `side: Literal["buy","sell"]`, `action: Literal["add","remove"]`, plain `str`/`float`, and `model_config = ConfigDict(extra="forbid")` so `additionalProperties: false` is emitted. No numeric/string constraints in the schema. **Validate in app code** through the shared Trade Rules, which already produce per-action `failed` statuses.
- Provider block: `{"order": ["cerebras"], "require_parameters": True}`. Decide explicitly on `allow_fallbacks` (false gives deterministic behaviour and a 502 on Cerebras outage; true gives availability with supported providers only). Do not set a small `max_tokens`. Keep `reasoning_effort="low"`.
- Parser: `content or ""` → strip code fences → `model_validate_json`. Catch `ValidationError`, `ValueError`, `TypeError` and LiteLLM exceptions → 502 with the user message already stored (PLAN §8). Log the raw content at DEBUG.
- Test the parser against a fixture corpus: valid, fenced, extra keys, missing arrays, null content, wrong types, and a non-JSON apology.

**Warning signs:**
Intermittent 502s that correlate with OpenRouter provider status. Provider 400 errors mentioning schema. Unit tests only cover the happy path.

**Phase to address:** AI chat. Consider a short spike (one real call with the final schema) at the start of the phase, because strict-mode schema acceptance is the highest-uncertainty item in the milestone.

---

### Pitfall 13: Auto-executed actions go wrong semantically: duplicates, hallucinated fills, unbounded actions, injection **[inferred]**

**What goes wrong:**
- **Re-execution from history.** The last 20 messages are fed back as conversation history. If assistant turns are replayed as raw JSON including `trades`, the model often **re-emits** earlier trades on the next unrelated message ("thanks!"), so the same buy executes twice.
- **Hallucinated execution.** The message says "Bought 5 NVDA at $875.20" (written before execution, with an invented price) while `trades` is empty or the trade fails. The failure note covers failures, but not trades the model forgot to put in the array, or wrong prices in the prose.
- **Ambiguous quantities.** "Buy $500 of AAPL", "sell half", "sell everything" need the model to compute quantities from context prices. Prices move between the prompt and execution, so "sell all" computed as 10.0000 can exceed a held 9.99995 after rounding.
- **Unbounded actions.** One response can contain 200 watchlist adds or 50 trades (which hits the simulator O(n²) concern from CONCERNS.md).
- **Prompt injection.** The only text sources are the user and the model's own history, so injection is mostly self-inflicted. But if the app is ever exposed beyond localhost (App Runner stretch goal), anyone can drive trades, reset, and spend the OpenRouter budget (CONCERNS.md: public unauthenticated endpoints).

**How to avoid:**
- Replay history as `{role, content}` only, with executed actions summarised in plain text (for example "[executed: bought 5 NVDA @ 875.20]"). System prompt: "Only include trades/watchlist_changes the user is requesting **in the latest message**; never repeat past actions."
- Prompt: do not state fill prices or claim completion. Use phrasing like "Placing an order for…". The backend appends executed summaries as well as failure notes, so the stored message stays truthful.
- Sell tolerance: clamp `qty` to the held quantity when `qty > held` and `qty - held < 1e-6` (the PLAN tolerance). Consider treating `qty >= held` within 0.01 % as "sell all" only for chat. Otherwise leave the rule as is.
- Caps: max 10 trades and 10 watchlist changes per response (extras → `failed: "too many actions"`), plus the watchlist cap from Pitfall 6.
- Bind the compose port to `127.0.0.1:8000:8000` for local use (CONCERNS.md) and add a simple in-process rate limit on `/api/chat`.

**Warning signs:**
The trades table shows identical trades seconds apart after a non-trading message. The assistant message price differs from the `actions.trades[].price`.

**Phase to address:** AI chat (prompt construction, executor caps). Packaging & ops (localhost bind).

---

### Pitfall 14: Mock-mode drift makes E2E pass while real chat is broken (or the other way round) **[inferred]**

**What goes wrong:**
- **Separate code path.** The mock is implemented as a separate route branch that returns a hand-built response, skipping the parser, executor, failure notes and storage, so E2E tests prove nothing about the real path.
- **Sloppy matching.** Substring matching makes "address" match `add`, and "buyer" or "Can you add TSLA and sell?" hit the first-rule-wins order unexpectedly. The `<TICKER>` capture is not uppercased or validated.
- **Wrong gating.** `LLM_MOCK=true` is checked after the `OPENROUTER_API_KEY` check, so E2E without a key returns 503.

**How to avoid:**
The mock is a drop-in `LLMClient` implementation that returns the same **raw JSON string** the real client would. Everything downstream is shared. Use word-boundary regexes (`\bbuy\b`, `\badd\s+([A-Za-z][A-Za-z0-9.]{0,9})\b`), checking order exactly as the PLAN §9 table. Gate order: `LLM_MOCK` first, then the key check. Unit-test each mock rule and the 503 path.

**Warning signs:**
Mock tests pass but the first real call fails parsing. `grep` finds `if settings.llm_mock:` in more than one place.

**Phase to address:** AI chat.

---

### Pitfall 15: Docker build breaks on Windows-originated context and lockfiles **[inferred, MEDIUM-HIGH]**

**What goes wrong:**
- **No `.dockerignore`.** `COPY backend/` brings the Windows `.venv` (with `Scripts/`, not `bin/`) into the image. `uv sync` then reuses or conflicts with it, or the image is gigabytes. `COPY frontend/` brings Windows `node_modules` with native binaries for the wrong platform.
- **Lockfile missing Linux binaries.** An npm lockfile generated on Windows can lack Linux optional native packages (the npm optional-dependency bug affecting `@next/swc-*`, `lightningcss`, `@tailwindcss/oxide-*`). `npm ci` in `node:*-slim` then fails with "Cannot find module '...-linux-x64-gnu'".
- **Node 20 is EOL** (April 2026). The PLAN says "Node 20 slim". Current Next.js still accepts Node ≥ 20.9, but newer releases may not, and EOL images get no security fixes.
- **Wrong bind address.** uvicorn binding `127.0.0.1` inside the container makes it unreachable from the host. Inside the container it must be `0.0.0.0`; restrict exposure in compose's port mapping instead.
- **Multiple workers or reload.** `--workers N` or `--reload` in the CMD. `PriceCache` is process-local (PROJECT.md), so multiple workers give each worker its own simulator and divergent prices, and trades price against a different cache than the SSE stream.
- **Missing `.env`.** `env_file: .env` with no `.env` makes `docker compose up` fail outright on a fresh clone.
- **No curl for health checks.** `HEALTHCHECK` with `curl` fails because `python:3.12-slim` has no curl.
- **LiteLLM side effects.** LiteLLM fetches its model-cost map from GitHub at import, so startup is slow or stalls offline. LiteLLM had a **PyPI supply-chain compromise** (1.82.7/1.82.8, March 2026), so an unpinned `litellm>=` is a real risk.
- **Demo script in the image.** `backend/market_data_demo.py` and the `rich` dev dependency end up in the image (CONCERNS.md).

**How to avoid:**
- `.dockerignore`: `**/.venv`, `**/node_modules`, `**/.next`, `frontend/out`, `db/*.db*`, `.git`, `.planning`, `test/`, `**/__pycache__`.
- Frontend stage: `node:22-slim` (record this as a deliberate PLAN deviation), `npm ci`. If the native-optional-deps error appears, regenerate `package-lock.json` (delete it and `node_modules`, then `npm install`) or install the explicit Linux optional package.
- Backend stage: copy `uv` from the official `ghcr.io/astral-sh/uv` image. `uv sync --frozen --no-dev`. `ENV LITELLM_LOCAL_MODEL_COST_MAP=True`. CMD `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1 --timeout-graceful-shutdown 3`.
- Pin `litellm` to an exact known-good version in `pyproject.toml`. `uv.lock` records hashes. Also add the upper bound for `massive` noted in CONCERNS.md.
- Compose: `env_file: [{path: .env, required: false}]` (Compose ≥ 2.24), or have start scripts copy `.env.example` to `.env` when it is missing. Healthcheck via `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"`.

**Warning signs:**
Image larger than 1 GB. Build works on one machine only. Container starts but `localhost:8000` refuses connections. Startup takes more than 10 s with network blocked.

**Phase to address:** Packaging & ops.

---

### Pitfall 16: Start/stop scripts break on line endings, permissions and PowerShell policy **[repo-verified: `core.autocrlf=true`, no `.gitattributes`]**

**What goes wrong:**
This machine has `core.autocrlf=true` and the repo has no `.gitattributes`, so line endings depend on each clone's settings:
- **CRLF in shell scripts.** `.sh` files authored on Windows can be committed or checked out with CRLF, and running them on macOS/Linux or in WSL fails with `/usr/bin/env: 'bash\r': No such file or directory`. Any shell script `COPY`ed into the image (an entrypoint) fails the same way.
- **No exec bit.** NTFS does not track the exec bit, so `scripts/start_mac.sh` is committed as `100644` and fails with "Permission denied" on macOS.
- **PowerShell execution policy.** The Windows client default policy (Restricted) refuses to run `start_windows.ps1` when it is double-clicked or run as `.\scripts\start_windows.ps1`.
- **PowerShell 5.1 encoding.** Windows PowerShell 5.1 reads BOM-less UTF-8 as ANSI. Non-ASCII characters in a `.ps1` (em dashes, ✓, ⚠️ copied from PLAN text) become mojibake or cause parse errors.
- **Non-idempotent scripts.** The scripts do not check that Docker Desktop is running, use the legacy `docker-compose` binary, or decide whether `--build` is needed by checking the wrong image name (compose names images `<project>-<service>`).

**How to avoid:**
- `.gitattributes`: `* text=auto`, `*.sh text eol=lf`, `*.ps1 text eol=crlf`, `Dockerfile text eol=lf`, `*.py text eol=lf`. Then `git add --renormalize .`.
- `git update-index --chmod=+x scripts/*.sh`. Verify with `git ls-files -s scripts`.
- Keep `.ps1` scripts ASCII-only. Document `powershell -ExecutionPolicy Bypass -File scripts\start_windows.ps1` in the README. Check `$LASTEXITCODE` after each `docker` call.
- Detect the image with `docker compose images -q` (or `docker image inspect` with the compose-derived name). Probe `docker info` first and print a clear "start Docker Desktop" message.

**Warning signs:**
`git ls-files --eol scripts/` shows `i/crlf` for `.sh`. `git ls-files -s` shows `100644` for `.sh`.

**Phase to address:** Backend foundation (`.gitattributes`, with Pitfall 1). Packaging & ops (scripts).

---

### Pitfall 17: Playwright flakiness against live-streaming prices **[inferred, HIGH]**

**What goes wrong:**
- **`networkidle` never settles.** `page.waitForLoadState('networkidle')` never resolves because the SSE connection is permanently open, so tests time out.
- **Exact-value assertions.** Asserting exact prices, cash after a buy (`$9,809.50`), or P&L colours fails because prices move between the click and the fill.
- **Parallel workers share state.** Playwright's default parallel workers all hit **one** backend with a shared SQLite DB. Test A's `POST /api/reset` wipes test B's position mid-test.
- **Visual assertions.** The flash animation and canvas charts cannot be asserted by text. Screenshot diffs of moving data always fail.
- **Version mismatch.** The Playwright Docker image tag does not match the `@playwright/test` version ("Executable doesn't exist at /ms-playwright/...").
- **Not ready.** The app container is not ready when tests start (`depends_on` without a health condition).
- **Wrong environment.** The test compose reuses the `finally-data` volume or project name and resets the user's real portfolio, or runs with real `LLM_MOCK=false`.

**How to avoid:**
- `workers: 1` (and `fullyParallel: false`) because the backend is a shared singleton. `POST /api/reset` via `request` in `beforeEach`.
- Wait for streaming with web-first assertions: `await expect(page.getByTestId('price-AAPL')).not.toHaveText('—')` or `expect.poll`. Never use `networkidle`.
- Assert relations, not values: cash decreased; cash + position value ≈ $10,000 within a tolerance; the position row exists with qty 1. Read the fill price from the `POST /api/portfolio/trade` response (`page.waitForResponse`) when exact numbers are needed.
- Expose state for tests: `data-testid` on rows and tiles, `data-pnl-sign="positive|negative"` on heatmap tiles, `data-points-count` on chart containers, `data-status` on the connection dot.
- Pin `mcr.microsoft.com/playwright:v<same-version>-noble` to the exact `@playwright/test` version. Use `depends_on: app: condition: service_healthy`. Use a separate compose project name (`-p finally-test`), no named volume (or a tmpfs DB), and `LLM_MOCK=true` in the test compose.
- Backend pytest: `DB_PATH` pointed at `tmp_path`. Use `with TestClient(app)` so lifespan runs. Use a fake or seeded market source for deterministic prices.
- Frontend unit tests: mock `lightweight-charts` and `EventSource`, because jsdom has no canvas, `ResizeObserver` or `EventSource`.

**Warning signs:**
Tests pass alone and fail in the suite. Timeouts on page load. Failures that mention a cents difference in cash.

**Phase to address:** Testing. The `data-testid` and `data-*` hooks must be specified in the Frontend phase so E2E is not blocked on retrofits.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Global `threading.Lock` serialising trades, snapshots and reset | Correctness with ~10 lines | Does not scale past one process | **Acceptable for v1.** The single-worker design already rules out multiple processes. |
| Floats with fixed rounding points instead of `Decimal`/integer cents | Matches PLAN schema (REAL); simple JSON | Edge-case cent drift if rounding points are skipped | Acceptable if rounding is centralised in the trade service and tested |
| Connection-per-request SQLite (no pool) | No threading bugs | Small per-request overhead | Always acceptable at this scale |
| Separate mock response path for `LLM_MOCK` | Fast to write | E2E no longer covers the real parser/executor | **Never.** The mock must feed the same parser. |
| Merging SSE frames into client state | Fewer object allocations | Ghost tickers after removal or reset | **Never.** Frames are full snapshots. |
| Unbounded sparkline arrays | "Since page load" literally | Memory and CPU growth in long sessions | Only with a cap (for example 300 points) |
| `allow_fallbacks: true` without `require_parameters` | Higher availability | Intermittent unparseable output | **Never** for structured-output calls |
| Hard-coding `http://localhost:8000` in frontend fetches for dev | `next dev` works quickly | Breaks single-origin production build | **Never.** Use an empty-by-default `NEXT_PUBLIC_API_BASE`. |
| Leaving the Python-template `.gitignore` unedited | Zero effort | Silently missing `frontend/**/lib` code | **Never** |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenRouter → Cerebras | Only `provider.order`, so fallbacks ignore `response_format` | `{"order": ["cerebras"], "require_parameters": true}`, explicit `allow_fallbacks` decision |
| Cerebras strict JSON schema | Pydantic constraints (`gt`, `pattern`), `Optional` fields, missing `additionalProperties:false` | Plain types, `Literal` enums, required lists, `extra="forbid"`; validate in app |
| gpt-oss reasoning model | Small `max_tokens` → empty `content`; `TypeError` escapes as 500 | No tight `max_tokens`; `content or ""`; catch all parse errors → 502 |
| LiteLLM | Sync `completion()` in `async def`; import-time network fetch; unpinned version | `acompletion` or `to_thread`; `LITELLM_LOCAL_MODEL_COST_MAP=True`; exact version pin |
| Massive (Polygon) | App code calling the REST client directly; LLM "add then buy" in Massive mode | All calls stay in `MassiveDataSource` (5 calls/min budget); failure note says price arrives at next poll |
| Docker Compose `env_file` | Empty `DB_PATH=` overrides Dockerfile `ENV`; missing `.env` aborts `up` | Comment out optional vars in `.env.example`; `required: false` or script-created `.env` |
| Starlette `StaticFiles` | Mounted at `/` before API routers; expecting `/foo` → `foo.html` | Mount last; single-page app or `trailingSlash: true`; JSON 404 for `/api/*` |
| Lightweight Charts | ms timestamps, duplicate times, `update()` with older time | Floor to seconds, dedupe, guard monotonic updates |
| Playwright Docker image | Image tag ≠ `@playwright/test` version | Pin both to the same exact version |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Blocking calls in `async def` routes | SSE gaps during chat or trades | `def` routes or `to_thread`; `acompletion` | Immediately (every chat message) |
| App-wide re-render per SSE frame | Chat input lag, high CPU | External store with per-ticker selectors; imperative chart updates | ~10 tickers at 2 Hz on mid-range laptops |
| Simulator Cholesky rebuild on add/remove (CONCERNS.md) | Event-loop stalls on add; `LinAlgError` 500 | Watchlist cap (~50); wrap rebuild with a fallback | Above ~50–100 tracked tickers |
| SSE frames sent even when unchanged (CONCERNS.md) | Flashes with no change; wasted bytes | Skip version bump when the price is unchanged (spec-compliant) | Cosmetic at 10 tickers; matters with many clients |
| Per-client serialisation, no connection cap (CONCERNS.md) | CPU grows with tabs; browser 6-connection limit | One EventSource per tab; optional server cap (~20) | Many tabs or public deploy |
| Unbounded sparkline buffers | Memory growth over hours | Cap or downsample | Multi-hour sessions |
| Snapshot table growth | None in practice (~2,900 rows/day) | Index `portfolio_snapshots(user_id, recorded_at)`; downsample in the P&L chart if over ~5,000 points | Weeks of uptime |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Publishing port 8000 on all interfaces | Anyone on the LAN can reset the account or spend the OpenRouter budget via `/api/chat` (CONCERNS.md) | Compose `"127.0.0.1:8000:8000"` for local runs; document that public exposure is unsupported without auth |
| Unbounded LLM-driven actions | Ticker flood (simulator cost), mass trades | Per-response action caps; watchlist cap; rate-limit `/api/chat` |
| Logging raw provider errors or env at startup | API key leakage into logs | Never log env; log the LiteLLM exception class and message only; keep the Massive key out of logs (CONCERNS.md) |
| Unpinned `litellm` | Supply-chain compromise (malicious 1.82.7/1.82.8 in March 2026 ran on Python startup via `.pth`) | Exact pin plus `uv.lock` hashes; review upgrades deliberately |
| Unvalidated ticker path params (`/api/prices/{ticker}/history`, `DELETE /api/watchlist/{ticker}`) | Probing arbitrary strings; inconsistent normalisation | One `normalize_ticker()` with the PLAN §7 regex used by every route (CONCERNS.md) |
| Trusting LLM-provided fields (price, side casing) | Trades at invented prices | Executor uses only ticker, side and qty from the LLM; price always comes from `PriceCache` |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Assistant message claims a fill that failed or never happened | User believes a trade executed | Backend appends executed and failed summaries; prompt forbids stating fill prices |
| Flash on every frame, including unchanged prices | Visual noise, "everything is flashing" | Flash only on actual value change; re-trigger correctly on same-direction ticks |
| Connection dot flickers red on normal reconnects | False alarm | CONNECTING = yellow, CLOSED = red |
| Chart axis in UTC | Times look wrong to non-UTC users | Local-time formatter |
| Chg % computed from tick-to-tick `change_percent` | Wildly jumpy, meaningless column | Compute from `open_price` (CONCERNS.md notes that the SSE payload omits `session_change_percent`) |
| Massive-mode "add then buy" fails with "Add it to your watchlist first" | Confusing, since it is on the watchlist | Distinct message when the ticker is tracked but not yet priced |
| No in-flight disabling on Buy/Sell | Double trades on double-click | Disable buttons while the request is pending |
| Reset leaves stale sparklines, chart series or chat | App looks half-reset | Clear sparkline buffers, chart series and chat state; re-fetch all |

## "Looks Done But Isn't" Checklist

- [ ] **Repo hygiene:** `git check-ignore frontend/src/lib/x.ts` returns nothing; `db/finally.db`, `node_modules`, `.next`, `out` are ignored; `.gitattributes` exists.
- [ ] **Trades:** 20 parallel over-budget buys never produce negative cash (concurrency test).
- [ ] **Trades:** "Buy max" (`cash/price` rounded to 4 dp) succeeds; "sell all" of a fractional position deletes the row (dust rule).
- [ ] **Tracked tickers:** Removing a held ticker from the watchlist keeps it in the SSE frame; selling it to zero then drops it; reset removes held non-default tickers from the stream.
- [ ] **Persistence:** Trade → `docker compose down` → `up` → position still present; startup log shows `/app/db/finally.db`.
- [ ] **SSE:** One `/api/stream/prices` connection per tab in dev (StrictMode); prices keep flowing during a slow chat request.
- [ ] **Static serving:** `GET /api/does-not-exist` returns JSON 404, not HTML; hard refresh of `/` works from port 8000.
- [ ] **Charts:** Rapid ticker switching produces no console errors; P&L chart survives two snapshots in the same second.
- [ ] **Chat:** Parser handles null content, fenced JSON, extra keys and wrong types → 502 with the user message stored; a non-trading follow-up does not repeat the previous trade.
- [ ] **Chat:** `LLM_MOCK=true` works with **no** `OPENROUTER_API_KEY`; missing key without mock → 503 and the app still starts.
- [ ] **Docker:** Fresh clone with no `.env` → start script still succeeds (simulator + 503 chat); image has no `.venv` from Windows; `--workers 1`.
- [ ] **Scripts:** `.sh` is LF and `100755` in the index; `.ps1` is ASCII-only and runs with `-ExecutionPolicy Bypass`; running start twice is harmless.
- [ ] **E2E:** Suite passes with `workers: 1` three runs in a row; test compose uses its own project name and no shared volume.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Frontend `lib/` files never committed | MEDIUM (lost work in worktrees) | Fix `.gitignore`, then recover files from each agent worktree before cleanup; `git add` and re-verify the build on a clean clone |
| DB written outside the volume | LOW (sim money) | Fix path resolution; data loss is acceptable (fake money); add the persistence test |
| Trade race produced negative cash | LOW | Add lock and `BEGIN IMMEDIATE`; `POST /api/reset` |
| Re-render storm baked into components | HIGH if found late | Introduce the external store and migrate panels one by one; decide the store in Frontend phase plan 1 to avoid this |
| Schema rejected by Cerebras strict mode | LOW | Simplify the Pydantic model (drop constraints, Optional → required lists); move validation to Trade Rules |
| CRLF or exec-bit script breakage | LOW | Add `.gitattributes`, `git add --renormalize .`, `git update-index --chmod=+x` |
| Flaky E2E | MEDIUM | Serialise workers, replace value assertions with relational ones, add `data-*` hooks |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. `.gitignore` drops `lib/`; missing artifact ignores | Backend foundation (first task) | `git check-ignore` checks in the checklist; clean-clone build |
| 2. Blocking the event loop | Backend foundation (convention), AI chat | SSE frame-gap test during delayed mock chat |
| 3. sqlite3 thread/transaction semantics | Backend foundation | DB helper unit tests; parallel request test |
| 4. Trade/snapshot/reset races | Portfolio & trading | Concurrency test: parallel buys and reset during snapshot |
| 5. Float money and unit confusion | Portfolio & trading, Frontend | Buy-max, sell-all and drift tests; formatter unit tests; units noted in contract |
| 6. Tracked-ticker invariant | Watchlist & tracked tickers (reused by trading, chat, reset) | PLAN §12 tracked-ticker tests plus reset re-sync test; cap test |
| 7. `DB_PATH` outside the volume | Backend foundation, Packaging & ops | Down/up persistence test; logged resolved path |
| 8. SSE buffering/limits/reconnect/state | Backend foundation, Frontend | Mocked-EventSource status tests; one connection per tab; replace-not-merge test |
| 9. Lightweight Charts time rules | Frontend | Unit tests for `toChartTime`, dedupe and monotonic guard; rapid-switch E2E |
| 10. Re-render storm | Frontend (first plan: state architecture) | React Profiler check; memo and selector review |
| 11. Static export + StaticFiles | Backend foundation, Frontend scaffold | JSON 404 test; `next build` in CI; no hydration warnings |
| 12. Structured-output failures | AI chat (spike first) | Parser fixture corpus; one real call with the final schema |
| 13. Action semantics and injection | AI chat, Packaging & ops | Duplicate-on-follow-up test; action-cap test; localhost bind |
| 14. Mock drift | AI chat | Mock routed through the shared parser (code review); per-rule tests |
| 15. Docker build/runtime | Packaging & ops | Clean-machine build; image size check; startup with network blocked |
| 16. Script line endings/policy | Backend foundation (`.gitattributes`), Packaging & ops | `git ls-files --eol` and `-s` checks; run scripts twice on both OS families |
| 17. Playwright flakiness | Testing (hooks specified in Frontend) | Three consecutive green runs with `workers: 1` |

## Sources

- Repository inspection (this session): `.gitignore` (unanchored `lib/`, `build/`; `git check-ignore` results), `git config core.autocrlf` = `true`, no `.gitattributes`, `backend/app/market/stream.py`, `cache.py`, `models.py`, `simulator.py`, `backend/pyproject.toml` (HIGH)
- `.planning/codebase/CONCERNS.md`: remove-only-if-unheld gap, ticker cap and Cholesky cost, `MASSIVE_POLL_INTERVAL` floor, SSE frames on unchanged prices, public endpoints, path validation, `massive` pin (HIGH, project-internal)
- [Lightweight Charts 5.2: ISeriesApi `setData`/`update`](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/ISeriesApi); [UTCTimestamp](https://tradingview.github.io/lightweight-charts/docs/api/type-aliases/UTCTimestamp); [Time zones](https://tradingview.github.io/lightweight-charts/docs/time-zones)
- [Next.js: Static Exports guide](https://nextjs.org/docs/app/guides/static-exports) (unsupported features, output file naming, `trailingSlash`)
- [Starlette `staticfiles.py` source](https://raw.githubusercontent.com/encode/starlette/master/starlette/staticfiles.py) (html mode: `index.html` and `404.html` only, no `.html` append)
- [Starlette release notes](https://www.starlette.dev/release-notes/); [Simon Willison: asgi-gzip SSE fix](https://simonwillison.net/2026/Apr/9/asgi-gzip/); [sse-starlette on PyPI](https://pypi.org/project/sse-starlette) (GZip and SSE caveat)
- [Python 3.12 `sqlite3` docs](https://docs.python.org/3.12/library/sqlite3.html) (`check_same_thread`, `autocommit` and legacy transaction control, `executescript`, context manager, timeout)
- [OpenRouter: provider selection](https://openrouter.ai/docs/guides/routing/provider-selection) (`allow_fallbacks`, `require_parameters`); [OpenRouter: structured outputs](https://openrouter.ai/docs/features/structured-outputs)
- [Cerebras: structured outputs](https://inference-docs.cerebras.ai/capabilities/structured-outputs) (strict subset, `additionalProperties:false`, gpt-oss-120b support); [Cerebras: OpenRouter integration](https://inference-docs.cerebras.ai/integrations/openrouter.md)
- [BleepingComputer: LiteLLM PyPI compromise](https://bleepingcomputer.com/news/security/popular-litellm-pypi-package-compromised-in-teampcp-supply-chain-attack); [Comet: LiteLLM supply chain attack](https://www.comet.com/site/blog/litellm-supply-chain-attack/)
- [CrewAI community: litellm slow import / `LITELLM_LOCAL_MODEL_COST_MAP`](https://community.crewai.com/t/crewai-cli-command-is-slow-to-respond/3359); [LiteLLM custom cost map docs](https://docs.litellm.ai/docs/proxy/custom_model_cost_map)
- [React StrictMode double effects (Sentry answer)](https://getsentry.com/answers/react-useeffect-running-twice/)
- Inferred (not source-checked this session, verify in-phase): HTTP/1.1 6-connection limit with SSE, EventSource `readyState` semantics, Playwright `networkidle` with SSE and image-version pinning, npm optional-dependency lockfile bug, Node 20 EOL date, Compose `env_file.required` (≥ 2.24), uvicorn graceful-shutdown behaviour with open streams

---
*Pitfalls research for: AI-powered simulated trading workstation (FinAlly)*
*Researched: 2026-10-23*
