# Phase 3: AI Copilot and Complete Terminal - Research

**Researched:** 2026-10-28
**Domain:** LLM chat with structured output and auto-executed actions (FastAPI + LiteLLM → OpenRouter → Cerebras), the chat panel and the final terminal layout (Next.js static export + zustand), and Playwright E2E in Docker
**Confidence:** HIGH for the integration points in the codebase (read this session). MEDIUM for LiteLLM/OpenRouter/Cerebras behavior (official docs and source, but no live call made). MEDIUM for the Playwright container setup.

<user_constraints>
## User Constraints (from CONTEXT.md)

There is no CONTEXT.md for this phase. The user chose to plan without discuss-phase (Phase 2 was planned the same way). The binding constraints are:

### Locked Decisions
- `planning/PLAN.md` §5, §8, §9, §10 and §12 are the contract for env vars, the chat API shapes and status codes, LLM behavior, the frontend and testing.
- `.planning/REQUIREMENTS.md` AI-01..AI-16, PF-10, UX-02 and TST-01..TST-04, including the adopted gap resolutions: G-11 (validate each item), G-14 (mock word boundaries), G-15 (a 503 stores nothing; empty or >2,000-char message → 400), G-16 (Reset disabled while chat is in flight), G-17 (prompt rules), G-19 (relational E2E assertions plus data hooks), G-20 (AI add is idempotent; AI remove of an unwatched ticker fails), G-21 (at most 10 trades and 10 watchlist changes).
- STATE.md decisions: every mutation goes through the shared `state_lock` services; `TickerTracker.reconcile` is the only caller of `source.add/remove_ticker`; business failures raise `DomainError` (400) / `NotFoundError` (404); every trade quantity failure is a `DomainError` (so the executor catches one type); trade errors carry "need $X, have $Y" fragments for the failure notes; reset does not clear sparklines, chat or chart selection (that is PF-10, this phase).
- Project skill `cerebras-inference` is mandatory for LLM calls: LiteLLM, `openrouter/openai/gpt-oss-120b`, `extra_body={"provider": {"order": ["cerebras"]}}`, `reasoning_effort="low"`, Pydantic `response_format`.
- MVP mode, tracer-first plans.

### Claude's Discretion
Everything PLAN.md and REQUIREMENTS.md leave open: module layout, the LLM client seam, prompt wording, chip styling, the collapse affordance, the E2E container layout, and where the client-side validation lives.

### Deferred Ideas (OUT OF SCOPE)
From REQUIREMENTS.md "Out of Scope" and v2: token streaming, a second LLM call for failures, multi-step tool loops, markdown rendering, keyboard shortcuts (KEY-01), a seeded simulator for E2E (SIM-01, only if relational assertions prove flaky), rate limiting or auth (MULT-01), cloud deploy (DEPL-01).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AI-01 | `POST /api/chat` via LiteLLM → OpenRouter (Cerebras), structured output, returns the stored assistant message | §Standard Stack (litellm pin), Pattern 2 (LLM client seam), Code Examples "OpenRouter client" |
| AI-02 | Prompt = system prompt + portfolio context from the same service as `GET /api/portfolio` + last 20 messages | Pattern 4 (prompt builder) reuses `PortfolioService.view()` and `WatchlistService.list_entries()` |
| AI-03 | System prompt rules (concentration, P&L, $→shares at 4dp, "sell all" = exact held qty, plain text, no tables) | Code Examples "System prompt" |
| AI-04 | Strict envelope, per-item validation, 502 on unparseable output or LLM failure with the user message stored | Pattern 3 (two-schema parse), Pitfalls 1–3 |
| AI-05 | Watchlist changes first, then trades; each independent; same services as REST; `actions` null when none | Pattern 5 (executor) on `WatchlistService.add/remove` and `TradeService.execute` |
| AI-06 | AI add of a watched ticker = executed; AI remove of an unwatched ticker = failed "{T} is not on your watchlist" | `WatchlistService.add` returns `(entry, created)`; `remove` raises `NotFoundError` with that exact text |
| AI-07 | At most 10 trades + 10 watchlist changes; extras failed "too many actions" | Pattern 5 |
| AI-08 | Templated ⚠️ note per failed action, appended to the stored content | Pattern 6 (failure notes) |
| AI-09 | No key (and not mock) → app starts, `503` with the PLAN §5 text, nothing stored; empty or >2,000 chars → `400` | Pattern 1 (gate order), Settings extension |
| AI-10 | `LLM_MOCK=true` deterministic rules, word boundaries, uppercase capture, same pipeline | Pattern 2 (`MockLLMClient` returns raw JSON), Code Examples "Mock rules" |
| AI-11 | `GET /api/chat/history` last 50 oldest first; panel loads it; stored actions render like live ones | Pattern 7 (storage), Frontend chat store |
| AI-12 | Collapsible panel, Enter sends, loading indicator, send disabled in flight, auto-scroll, pre-wrap | Frontend Pattern A; Pitfall 8 (jsdom has no `scrollIntoView`) |
| AI-13 | Executed chips (side, qty, ticker, fill price); failed chips visibly distinct with error | Frontend Pattern B |
| AI-14 | 502/503/400 as a distinct system bubble | Frontend Pattern A |
| AI-15 | Non-null `actions` → re-fetch portfolio, watchlist, history (and trades) | Frontend Pattern C (component orchestration, stores never import each other) |
| AI-16 | Empty chat shows clickable prompt chips | Frontend Pattern A |
| PF-10 | After reset: refetch everything, clear chat, sparklines and chart selection; Reset disabled while chat in flight | Frontend Pattern D |
| UX-02 | All panels visible at once on wide screens; usable on tablet; collapsible chat | Terminal grid already reserves the `panel-chat` slot; §Architecture "Layout" |
| TST-01 | Backend pytest for trade, tracker, LLM parsing, API, reset | Most of it already exists (388 tests); new `test_chat*.py` files |
| TST-02 | Frontend unit tests incl. chat rendering, failed actions, loading | Existing Vitest harness; new `ChatPanel.test.tsx`, `chat` store tests |
| TST-03 | Playwright from `test/docker-compose.test.yml`, `LLM_MOCK=true`, reset before each test, 7 scenarios | §E2E Architecture |
| TST-04 | `data-testid` hooks and `data-sign` on P&L-bearing elements | Most hooks already exist (audited below); add chat hooks and a P&L-chart point count |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Python 3.12, `uv` project in `backend/`; stdlib `sqlite3`, no ORM; Ruff (line length 100, rules E, F, I, N, W) must pass `ruff check` and `ruff format --check`.
- `from __future__ import annotations` at the top of every module; PEP 604 unions; `collections.abc` for callables; frozen slotted dataclasses for value types with explicit `to_dict()` (never `dataclasses.asdict` for wire payloads).
- Router factories with no module-level state (`create_*_router(deps) -> APIRouter`), registered before `install_api_not_found(app)` and `mount_static`.
- Blocking I/O (SQLite, SDK calls) goes through `asyncio.to_thread`. Background loops catch `Exception` and log with `logger.exception`.
- `%s`-style lazy logging, component-prefixed messages ("Chat: ..."). Never log API key values (OPS-03). Any secret on `Settings` must use `field(repr=False)` (`backend/app/config.py:42-44`).
- Env vars read with `os.environ.get(NAME, "").strip()`; empty means unset. Tests patch the environment with `patch.dict(os.environ, {...}, clear=True)`; no secrets in code or tests.
- Business failures 400 `{"error"}`, malformed bodies FastAPI 422, not found 404, LLM failure 502 (PLAN §8).
- Frontend: browser APIs only inside effects; exactly one `EventSource` (prices store); `apiFetch()`/`apiUrl()` only; no charting library other than Lightweight Charts; no `next/font/google`; never create `frontend/.env.local`.
- LLM calls must follow the `cerebras-inference` skill (`.claude/skills/cerebras/SKILL.md`).
- GSD workflow: edits happen inside GSD commands (the executor handles this).
- Do not read the repo-root `.env` (secrets). The researcher did not.

## Summary

Phases 1 and 2 left a clean seam for the chat feature. `TradeService.execute(raw_ticker, quantity, side)` and `WatchlistService.add/remove(raw)` are the single mutation paths. They take the shared `state_lock` themselves, normalize tickers, and raise only `DomainError`/`NotFoundError` with user-ready text such as "Insufficient cash (need $X, have $Y).". `PortfolioService.view()` returns the exact `GET /api/portfolio` dict. The `chat_messages` table exists, reset already deletes it, the Terminal grid reserves a `panel-chat` slot (currently a `ComingSoon` placeholder), and most TST-04 hooks already exist. Phase 3 mostly adds one backend module group (chat service, LLM client, parser/executor, router) and one frontend store and panel. No existing service needs to change.

The highest-risk item is the LLM boundary. Three facts drive the design. (1) LiteLLM fetches its model cost map from GitHub **at import time** (`model_cost = get_model_cost_map(url=model_cost_map_url)`, 5s timeout, disabled only by `LITELLM_LOCAL_MODEL_COST_MAP=true`). It is also heavy: adding it doubles the lockfile from 40 to 82 packages and pulls boto3, tokenizers, huggingface-hub and openai. So import it lazily, off the event loop, and only in real mode. (2) LiteLLM turns a Pydantic `response_format` into a `json_schema` with `"strict": True` via `to_strict_json_schema`. Cerebras strict mode rejects `pattern`, `format`, `minItems`/`maxItems`, `oneOf`/`allOf`, and needs `additionalProperties: false` on every object. Keep validation constraints out of the schema sent to the model, and validate leniently and per item in app code. (3) OpenRouter's `provider.order` still falls back to other providers by default, and fallback providers for gpt-oss-120b may ignore `response_format`. Add `"require_parameters": True` (and decide on `allow_fallbacks`).

Use an `LLMClient` seam (`async complete(messages) -> str` returning the raw JSON text) with three implementations: `OpenRouterLLMClient` (litellm), `MockLLMClient` (PLAN §9 rules, returning raw JSON) and test fakes. The mock, the real model and the fakes then all flow through one parse → execute → note → store pipeline (Pitfall 14 in the project research). E2E needs a new `test/` npm project pinned to `@playwright/test` **1.64.1**, plus the matching image `mcr.microsoft.com/playwright:v1.64.1-noble` (tag verified on MCR). The test compose project must use its own project name and a tmpfs DB, never the `finally-data` volume, because that volume has a fixed explicit name and E2E resets would wipe the user's real portfolio.

**Primary recommendation:** Build the tracer first in mock mode: `POST /api/chat` → `ChatService` (store user message → `MockLLMClient` → parse → execute through the existing services → notes → store → return) → a minimal `ChatPanel` that renders the reply and chips and refetches the portfolio and watchlist. Then layer on the real `OpenRouterLLMClient` behind a human-verified spike, the error paths, the full panel UX with PF-10 and UX-02, and finally the Playwright suite.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Message validation (empty, >2,000, 422 shape) | API / Backend | Browser (pre-check bubble) | Server is authoritative (AI-09); the client pre-check only avoids a pointless request |
| Config gate (mock vs key vs 503) | API / Backend | — | Decided once in `create_app` from `Settings`; nothing stored on 503 |
| Prompt + portfolio context | API / Backend | — | Must reuse `PortfolioService.view()` (AI-02); prices come from `PriceCache` |
| LLM call (LiteLLM → OpenRouter → Cerebras) | API / Backend | External (OpenRouter) | Key never reaches the browser; blocking SDK off the loop |
| Parse + per-item validation + caps | API / Backend | — | AI-04/AI-07; pure functions, unit-testable |
| Action execution | API / Backend (existing services) | Database | Same `TradeService` / `WatchlistService` as REST (AI-05), under `state_lock` |
| Chat persistence + history | Database / Storage | API | `chat_messages` table already exists |
| Chat panel, chips, bubbles, loading | Browser / Client | — | zustand store + component |
| Post-action refresh (portfolio, watchlist, history, trades) | Browser / Client | — | PLAN §10 data flow; components orchestrate stores |
| Reset side effects (clear chat, sparklines, selection) | Browser / Client | API (reset already deletes chat rows) | PF-10 |
| E2E orchestration | CI / Docker (test compose) | — | App container plus a Playwright container |

## Current Code: Integration Points (read this session)

Every value below was opened with `Read`/`cat -n` this session.

### Services the chat must reuse (AI-02, AI-05)

- `TradeService.execute`: `async def execute(self, raw_ticker: str, quantity: float, side: str) -> TradeResult:` [VERIFIED: backend/app/trading.py:94]. It normalizes the ticker and side, validates quantity (rejects `bool`, non-number, non-finite, ≤0, `> MAX_QUANTITY`, rounds to 0), takes `self._lock`, fills, snapshots, reconciles and returns `TradeResult(trade, portfolio)`. Every rule failure is a `DomainError`. Error texts quoted verbatim:
  - `raise DomainError(f"No price available for {ticker}. Add it to your watchlist first.")` [VERIFIED: backend/app/trading.py:158]
  - `f"Insufficient cash (need {format_money(cost)}, have {format_money(cash)})."` [VERIFIED: backend/app/trading.py:176]
  - `f"Insufficient shares (need {format_qty(qty)}, have {format_qty(held)})."` [VERIFIED: backend/app/trading.py:194]
  - `raise DomainError("Side must be 'buy' or 'sell'.")` [VERIFIED: backend/app/trading.py:106]
  - `raise DomainError("Quantity must be a positive number.")` [VERIFIED: backend/app/trading.py:134]
  - `Trade.to_dict()` keys `"id", "ticker", "side", "quantity", "price", "executed_at"` [VERIFIED: backend/app/trading.py:55-63]. `trade.quantity` is the *filled* quantity (a sell within `DUST` is clamped).
- `WatchlistService.add`: `async def add(self, raw: str) -> tuple[dict, bool]:` returns `(entry, created)`; an existing ticker returns `created=False` and is not an error (G-20 → `executed`) [VERIFIED: backend/app/watchlist.py:54-67].
- `WatchlistService.remove`: `async def remove(self, raw: str) -> None:` raises `raise NotFoundError(f"{ticker} is not on your watchlist")` [VERIFIED: backend/app/watchlist.py:69-75]. This is exactly the AI-06 text.
- Watchlist cap: `WATCHLIST_CAP = 50` with the message `f"Watchlist is full ({WATCHLIST_CAP} tickers). "` `"Remove one before adding another."` [VERIFIED: backend/app/watchlist.py:19, 95-98].
- `WatchlistService.list_entries()` → `{"ticker", "price", "open_price", "added_at"}` dicts [VERIFIED: backend/app/watchlist.py:49-52, 122-129].
- `PortfolioService.view()`: `async def view(self) -> dict:` → the PLAN §8 portfolio dict [VERIFIED: backend/app/portfolio.py:42-44].
- `normalize_ticker` raises `DomainError` and calls `raw.strip()`, so it **must receive a `str`**. A non-string from the LLM would raise `AttributeError`, so validate the item type first [VERIFIED: backend/app/tickers.py:12-18].
- Errors: `class DomainError(Exception):` with `status_code = 400`; `class NotFoundError(DomainError):` with `status_code = 404`; the handler renders `{"error": exc.message}` with `exc.status_code` [VERIFIED: backend/app/errors.py:14-31]. A new 502/503 error can subclass `DomainError` with a different `status_code` and reuse `_domain_error`. Register it explicitly in `error_handlers()` like `NotFoundError`.

### App wiring

- `create_app(settings=None, *, source_factory=None, snapshot_interval=SNAPSHOT_INTERVAL)` [VERIFIED: backend/app/main.py:39-44]. Services are built at lines 57-62: `state_lock = asyncio.Lock()`, `tracker = TickerTracker(db, source)`, `watchlist = WatchlistService(db, cache, tracker, state_lock)`, `portfolio = PortfolioService(db, cache, tracker, state_lock)`, `trade_service = TradeService(db, cache, tracker, portfolio, state_lock)`. The `watchlist` service is a local variable and is **not** on `app.state`.
- Router order: `create_stream_router`, `create_watchlist_router`, `create_portfolio_router`, `create_system_router`, then `install_api_not_found(app)  # after every /api router`, then `mount_static(...)` [VERIFIED: backend/app/main.py:106-111]. The chat router must be included **before** `install_api_not_found`, otherwise `/api/chat` returns the JSON 404.
- Comment at line 56: "asyncio.Lock is not reentrant: never call a lock-taking method while holding it." The chat service must **never** hold `state_lock` while calling `TradeService.execute` or `WatchlistService.add/remove` (they take it themselves).
- `Settings` fields: `db_path: str`, `static_dir: str`, `dev_cors_origin: str | None = None`; frozen slotted dataclass; docstring says "Any secret field added later must use `field(repr=False)`" [VERIFIED: backend/app/config.py:39-49]. `from_env` calls `load_dotenv(env_file or REPO_ROOT / ".env", override=False)` [VERIFIED: backend/app/config.py:61]. `_env(name)` returns the stripped value or `None` [VERIFIED: backend/app/config.py:69-72].
- The test fixture builds `Settings(db_path=..., static_dir=...)` directly [VERIFIED: backend/tests/conftest.py:68-70], so new `Settings` fields need defaults. Tests then never pick up a real `OPENROUTER_API_KEY`.

### Database

- `chat_messages` columns: `id TEXT PRIMARY KEY`, `user_id TEXT NOT NULL DEFAULT 'default'`, `role TEXT NOT NULL`, `content TEXT NOT NULL`, `actions TEXT`, `created_at TEXT NOT NULL`; index `idx_chat_user_time ON chat_messages (user_id, created_at)` [VERIFIED: backend/app/db/schema.sql:46-53, 61-62]. **No schema change is needed.**
- `now_iso()` → `datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")` (second resolution) [VERIFIED: backend/app/db/__init__.py:28-30]. The user and assistant rows usually share a second, so order by `created_at, rowid`, as the trades query does.
- `Database.transaction()` = `BEGIN IMMEDIATE` … `COMMIT`/`ROLLBACK`; "All methods are blocking; call them from async code via `asyncio.to_thread`" [VERIFIED: backend/app/db/__init__.py:33-69].
- Reset already deletes chat rows: `RESET_TABLES = ("positions", "trades", "portfolio_snapshots", "chat_messages", "watchlist")` [VERIFIED: backend/app/portfolio.py:20]. No backend change for PF-10.

### Frontend

- Placeholder to replace: `<ComingSoon testId="panel-chat" title="AI Chat" label="AI Chat — coming in Phase 3" className="min-h-64 md:col-start-2 xl:col-start-3 xl:row-start-1 xl:min-h-0" />` [VERIFIED: frontend/src/components/Terminal.tsx:99-104]. Grid: `md:grid-cols-[240px_minmax(0,1fr)] xl:min-h-0 xl:grid-cols-[260px_minmax(0,1fr)_360px]` [VERIFIED: Terminal.tsx:84].
- Stores: `usePortfolio` with `refresh()` = `Promise.all([loadPortfolio(), loadTrades(), loadHistory()])` and `reset()` [VERIFIED: frontend/src/store/portfolio.ts:175-177, 199-207]; `useWatchlist` with `loadWatchlist()`, `select(ticker)`, `setEntries` → `nextSelection(...)` [VERIFIED: frontend/src/store/watchlist.ts:35-69]; `usePrices` with `spark: Record<string, number[]>` and `SPARK_MAX = 300` [VERIFIED: frontend/src/store/prices.ts:9, 16]. The prices store has no action to clear sparklines; add one.
- `nextSelection(watchlist, selected, held)` returns `selected` if still watched or held, else `watchlist[0] ?? null` [VERIFIED: frontend/src/domain/market.ts:74-83]. Setting `selected` to `null` before `loadWatchlist()` makes reset select the first default ticker.
- Header reset: `RESET_CONFIRM` already mentions chat history; `ResetButton` does `usePortfolio.getState().reset()` then `useWatchlist.getState().loadWatchlist()` and has `disabled={resetting}` [VERIFIED: frontend/src/components/Header.tsx:14-15, 68-103].
- Convention: "the stores never import each other; this effect is the only bridge (assumption D-3)" [VERIFIED: Terminal.tsx:63-65]. Components orchestrate cross-store effects (Header does it for reset).
- `ApiError(status, message)`; `apiFetch` throws it with the server's `error` text; a 422 becomes `"Invalid request"` [VERIFIED: frontend/src/api/client.ts:11-33].
- Test helpers: `stubApi(overrides)` routes `"METHOD /path"` keys and returns 404 for anything unmatched; `DEFAULT_API` has no chat routes [VERIFIED: frontend/src/test/stubFetch.ts:27-32, 48-67]. Add `"GET /api/chat/history": { messages: [] }` to `DEFAULT_API`, or every existing Terminal test that mounts the chat panel gets a 404 on the history load (harmless but noisy, and it may surface an error bubble).

### Existing TST-04 hooks (audit)

Present: `connection-dot` (`data-status`), `header-total`, `header-cash`, `header-pnl` (`data-sign`), `reset-button`, `watchlist-row-{T}`, `select-{T}`, `price-{T}` (`data-direction`), `chg-{T}` (`data-sign`), `spark-{T}`, `remove-{T}`, `add-ticker-input/submit/error`, `trade-ticker/qty/buy/sell/message`, `trade-history(-row/-empty)`, `position-row-{T}`, `position-qty/avg/price/pnl/pnlpct-{T}` (pnl and pnlpct have `data-sign`), `heatmap-tile-{T}` (`data-sign`), `heatmap-empty`, `pnl-chart`, `pnl-status`, `chart-*`, `panel-*` [VERIFIED: grep plus reads of Heatmap.tsx:82-83, PositionsTable.tsx:65-73, Watchlist.tsx:83-179, PnlChart.tsx:94-102].

Missing: every chat hook, and a way to assert "P&L chart has data points" (the canvas can't be read). Add `data-point-count={snapshots.length}` on `pnl-chart`.

## Standard Stack

### Core (new this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| litellm | **==1.106.2** (published 2026-10-21) | LLM client → OpenRouter → Cerebras | Mandated by the `cerebras-inference` skill [CITED: .claude/skills/cerebras/SKILL.md]. Requires Python `<3.15,>=3.10` [VERIFIED: PyPI JSON API, present constraint] |
| pydantic | `>=2.12` (2.12.5 already locked transitively) | LLM response schema, request body | The skill says `uv add litellm pydantic`; app code already imports pydantic directly (`backend/app/api/portfolio.py:6`) but doesn't declare it |
| @playwright/test | **1.64.1** exact (in a new `test/package.json`) | E2E runner | PLAN §12; matching image tag `v1.64.1-noble` exists on MCR [VERIFIED: mcr.microsoft.com/v2/playwright/tags/list] |
| mcr.microsoft.com/playwright | **v1.64.1-noble** | Browser container | Official image; "always pin your Docker image to a specific version"; a version mismatch means "Playwright will be unable to locate browser executables" [CITED: playwright.dev/docs/docker] |

Already present and reused: FastAPI, Starlette `TestClient`, pytest + pytest-asyncio (`asyncio_mode = "auto"`), Vitest 5 + Testing Library + jsdom 30, zustand 5, Tailwind 4, Next 16.4.3, React 19.3 [VERIFIED: backend/pyproject.toml:7-23, frontend/package.json:15-38].

### Why `==1.106.2` and not the latest
- litellm releases several times a week; 1.106.6 was published on 2026-10-28 (research day). The legitimacy seam flags the latest as `too-new`.
- litellm had a real supply-chain compromise: versions 1.82.7 and 1.82.8 (2026-03-24, TeamPCP) carried a credential stealer. 1.82.8 used a `.pth` file that ran on every interpreter start [CITED: bitsight.com/blog/litellm-versions-1-82-7-1-82-8-supply-chain-compromise; netspi.com/blog/executive-blog/ai-ml-pentesting/litellm-supply-chain-compromise]. The project's own STACK research (2026-10-23) already chose 1.106.2.
- An exact pin plus `uv.lock` hashes plus `uv sync --locked` in the Dockerfile means no surprise upgrade.

### Lockfile impact (measured)
A scratch copy of `backend/pyproject.toml` + `uv.lock` with `"litellm==1.106.2", "pydantic>=2.12"` added and `uv lock` run: packages went **40 → 82**. New packages include boto3/botocore/s3transfer, openai 2.54.0, tokenizers 0.23.3, huggingface-hub 1.33.0, hf-xet, tiktoken 0.14.0, jsonschema, jinja2, pydantic-settings, aiohttp's deps (multidict, yarl, frozenlist, propcache), requests, regex and fastuuid. **`click` is bumped 8.3.1 → 8.5.0** (it's shared with uvicorn), so the plan should re-run the full backend suite after `uv add`. Expect a noticeably larger Docker image (no measurement; [ASSUMED] roughly +150–250 MB).

**Installation:**
```bash
cd backend && uv add "litellm==1.106.2" "pydantic>=2.12"
# E2E project (new):
cd test && npm init -y && npm install --save-exact --save-dev @playwright/test@1.64.1
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `asyncio.to_thread(litellm.completion, ...)` | `await litellm.acompletion(...)` | Both keep the event loop free. `to_thread(completion)` follows the skill snippet verbatim, matches the project's `to_thread` convention, and lets the heavy first import happen off-loop. `acompletion` needs the module imported first, on the loop or in a warm-up. Either works; recommend `to_thread`. |
| Direct `openai` SDK at OpenRouter | — | Violates the mandated skill. Don't. |
| Bind-mount `test/` and `npm ci` at container start | Build a tiny `test/Dockerfile` FROM the Playwright image | The bind mount needs network on every run and mixes Windows host `node_modules`. A built image is reproducible. Recommend the Dockerfile, with only report dirs bind-mounted. |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| litellm | PyPI | latest 1.106.6 is <1 day old; recommended pin 1.106.2 is 7 days old; project ~3 yrs [ASSUMED] | unknown (seam) | litellm.ai (GitHub BerriAI/litellm) | **SUS** (`too-new`, `unknown-downloads`) | Flagged. The planner must add `checkpoint:human-verify` before `uv add` (confirm the exact pin and that the lock contains no 1.82.7/1.82.8) |
| @playwright/test | npm | 1.64.1 published 2026-10-14 (14 days) | 86,382,233/wk | github.com/microsoft/playwright | **SUS** (`too-new` only) | Flagged. The planner must add `checkpoint:human-verify` before `npm install`. No postinstall script (seam: `postinstall: null`) |
| pydantic | PyPI | already locked (2.12.5) | — | — | not re-checked (already a transitive dependency) | Approved (no new download) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `litellm` [WARNING: flagged as suspicious, verify before using], `@playwright/test` [WARNING: flagged as suspicious, verify before using]. Both are flagged on recency signals of the latest release only. Both are the canonical packages named by the skill and PLAN.

## Architecture Patterns

### System Architecture Diagram

```
Browser (ChatPanel)
  │ Enter / prompt chip ──► chat store.send(text)
  │   client pre-check (empty / >2000 code points) ──► local system bubble, no request
  ▼
POST /api/chat {message}
  │ 422 if body malformed (FastAPI)
  ▼
ChatService.handle(message)
  1. validate: strip → empty? → 400 ; len > 2000 → 400            (nothing stored)
  2. gate: llm_client is None (no key, not mock) → 503             (nothing stored)
  3. store user row (to_thread, own transaction)
  4. history = last 20 rows before this one ; context = PortfolioService.view() + WatchlistService.list_entries()
  5. messages = [system prompt, context, *history, user]
  6. raw = await llm_client.complete(messages) ── LLMError ──► 502 (user row kept)
        ├─ MockLLMClient   (LLM_MOCK=true; rules → raw JSON string)
        ├─ OpenRouterLLMClient (to_thread → litellm.completion → OpenRouter → Cerebras)
        └─ FakeLLMClient   (tests)
  7. parse(raw): strip fences → json.loads → envelope{message: str, trades?, watchlist_changes?}
        └─ not JSON / no string message ──► 502 (user row kept)
  8. execute: watchlist_changes[:10] then trades[:10], each independently
        ├─ item invalid → failed("invalid ...")
        ├─ index ≥ 10   → failed("too many actions ...")
        ├─ WatchlistService.add/remove  ─┐  each takes state_lock itself
        └─ TradeService.execute          ─┘  DomainError → failed(error)
  9. content = message + "\n\n" + ⚠️ notes for failed actions
 10. store assistant row {content, actions JSON | NULL} ──► 200 {id, role, content, actions, created_at}
  ▼
ChatPanel renders reply + chips; if actions != null:
  usePortfolio.refresh() (portfolio, trades, history) + useWatchlist.loadWatchlist()
```

### Recommended Project Structure

```
backend/app/
├── chat/
│   ├── __init__.py      # public: ChatService, LLMClient, MockLLMClient, OpenRouterLLMClient, create_llm_client
│   ├── llm.py           # LLMClient protocol, LLMError, OpenRouterLLMClient (lazy litellm), LLMReply schema
│   ├── mock.py          # MockLLMClient: PLAN §9 rules → raw JSON string
│   ├── parsing.py       # strip_fences, parse_reply → ParsedReply (message, raw trade items, raw watchlist items)
│   ├── actions.py       # execute_actions(...) → (actions dict | None, notes list); caps; per-item validation
│   ├── prompt.py        # SYSTEM_PROMPT, build_context(portfolio, watchlist), build_messages(...)
│   └── service.py       # ChatService: validate, gate, store, call, parse, execute, store, history
├── api/chat.py          # create_chat_router(chat_service): POST /api/chat, GET /api/chat/history
├── config.py            # + openrouter_api_key (repr=False), llm_mock
└── errors.py            # + ChatUnavailableError (503), LLMFailedError (502)
backend/tests/
├── test_chat_parsing.py # fixture corpus: valid, fenced, extra keys, missing arrays, null, wrong types, prose
├── test_chat_actions.py # order, independence, caps, G-20, notes, executed price (trade_env fixture)
├── test_chat_mock.py    # every rule, word boundaries, uppercase, first-rule-wins
├── test_chat_api.py     # 200 shape, 400/422/502/503, storage, history order/limit, actions null
└── test_chat_prompt.py  # context numbers equal PortfolioService.view(); history window; no actions replayed as JSON
frontend/src/
├── api/types.ts         # + ChatMessage, ChatActions, TradeAction, WatchlistAction, ChatHistoryResponse
├── store/chat.ts        # messages, pending, loadHistory (sequence guard), send, clear
├── components/ChatPanel.tsx (+ ChatPanel.test.tsx)
└── store/prices.ts      # + clearSparklines()
test/                    # new E2E npm project
├── package.json / package-lock.json   # @playwright/test 1.64.1 exact
├── playwright.config.ts
├── Dockerfile           # FROM mcr.microsoft.com/playwright:v1.64.1-noble
├── .dockerignore        # node_modules, test-results, playwright-report
├── docker-compose.test.yml
└── e2e/*.spec.ts        # seven PLAN §12 scenarios
```

### Pattern 1: Gate order in `ChatService.handle`
**What:** Validate → gate → store → call. Both 400 and 503 store nothing (G-15). The mock check comes before the key check (Pitfall 14: "`LLM_MOCK=true` is checked after the `OPENROUTER_API_KEY` check, so E2E without a key returns 503").
**How:** Pick the client once in `create_app`: `llm_client = override or (MockLLMClient() if settings.llm_mock else OpenRouterLLMClient(key) if key else None)`. `ChatService` raises `ChatUnavailableError` (503) when the client is `None`. Exact message: `{"error": "AI assistant is not configured. Set OPENROUTER_API_KEY in .env."}` [CITED: planning/PLAN.md §5].
**Request model:** `class ChatRequest(BaseModel): message: StrictStr`, so `{"message": 5}` is a 422. Measure length on the stripped text with Python `len()` (code points). The client pre-check must count the same way: `Array.from(text.trim()).length`, not `.length` (UTF-16).

### Pattern 2: `LLMClient` seam returning raw text
**What:** `class LLMClient(Protocol): async def complete(self, messages: list[dict[str, str]]) -> str`. It raises `LLMError` on any transport or provider failure. The mock returns `json.dumps({...})` of the same envelope the model returns. Then mock, real and fake replies all exercise `parse_reply` (Pitfall 14).
**Injection:** add `llm_client: LLMClient | None = None` (a test seam, like `source_factory`) to `create_app`. Tests pass a `FakeLLMClient(replies=[...] | raises=...)`. Only one place reads `settings.llm_mock`.
**Warm-up:** in real mode only, the lifespan does `await asyncio.to_thread(client.warm)` (sets the env default, imports litellm), so the first chat doesn't pay the multi-second import and OPS-01's "initialise in lifespan" holds. Tests and mock mode never import litellm.

### Pattern 3: Two schemas, one strict and one lenient
- **Sent to the model** (`response_format=LLMReply`): `extra="forbid"`, every field required, no constraints:
  `message: str`, `trades: list[LLMTrade]`, `watchlist_changes: list[LLMWatchlistChange]`, `LLMTrade{ticker: str, side: Literal["buy","sell"], quantity: float}`, `LLMWatchlistChange{ticker: str, action: Literal["add","remove"]}`. LiteLLM converts this through `to_strict_json_schema` and sets `"strict": True` and `"name"` = the class name [CITED: github.com/BerriAI/litellm litellm/llms/base_llm/base_utils.py `type_to_response_format_param`]. It must avoid every keyword Cerebras strict mode rejects: `pattern`, `format`, `minItems`/`maxItems`, `oneOf`/`allOf`/`not`; `additionalProperties: false` is required on every object; `anyOf` is allowed only below the root; schema text ≤ 5,000 chars; `minimum`/`maximum`/`exclusiveMinimum` and `enum` are supported [CITED: inference-docs.cerebras.ai/capabilities/structured-outputs]. So no `Field(gt=0)`, no `max_length`, no ticker regex.
- **Used to parse** (app side, never sent): `json.loads` the fence-stripped text. Require a dict with `message` a non-empty `str` (otherwise 502). Treat `trades`/`watchlist_changes` as `None`/missing → `[]`, a list → items, anything else → one failed "invalid trades list" action. Validate each item separately with `TradeItem{ticker: StrictStr, side: StrictStr, quantity: StrictFloat}` / `WatchlistItem{ticker: StrictStr, action: StrictStr}` (extra keys ignored). Side, action, ticker and quantity semantics are then checked by the existing services, so error texts match the REST route exactly.
- Why both: the provider may not enforce the schema (fallback providers, `strict` ignored). AI-04 requires one bad item to fail alone, not the whole reply (G-11).

### Pattern 4: Prompt builder (AI-02, AI-03)
- `messages = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "system", "content": "Portfolio context (JSON):\n" + json.dumps(context)}, *history, {"role": "user", "content": message}]`.
- `context = {"cash_balance", "total_value", "positions_value", "unrealized_pnl", "positions": view["positions"], "watchlist": [{"ticker", "price", "chg_percent"}]}`, built from `await portfolio.view()` and `await watchlist.list_entries()`. `chg_percent = round((price - open) / open * 100, 2)` when both are present, else `null`.
- History = the 20 most recent rows **before** the new user row (select with `rowid < new_rowid` or `id != new_id`, `ORDER BY created_at DESC, rowid DESC LIMIT 20`, then reverse). Replay `{role, content}` only, and append a plain-text summary of executed actions to assistant turns (e.g. `[executed: buy 5 NVDA @ $875.20]`). Never replay the raw JSON `trades`: the model re-emits it and trades execute twice (project Pitfall 13).

### Pattern 5: Executor (AI-05, AI-06, AI-07)
```python
MAX_TRADES = 10
MAX_WATCHLIST_CHANGES = 10
# watchlist first (so a trade can use a ticker just added), then trades; each independent
for i, raw in enumerate(watch_items):
    if i >= MAX_WATCHLIST_CHANGES: record failed "too many actions (at most 10 watchlist changes per reply)"
    elif invalid: record failed "invalid watchlist change"
    elif action == "add": await watchlist.add(t)  → executed (created or not)
    elif action == "remove": await watchlist.remove(t)  → executed / NotFoundError → failed
    else: failed "Action must be 'add' or 'remove'."
for i, raw in enumerate(trade_items):
    ... await trades.execute(t, q, side) → executed {price: result.trade.price, quantity: result.trade.quantity}
except DomainError as e: failed e.message
except Exception: logger.exception("Chat: action failed"); failed "Unexpected error; the action was not run."
```
`actions = None` if both input lists are empty, else `{"trades": [...], "watchlist_changes": [...]}` (always both keys, matching the PLAN §8 example). Record keys exactly as PLAN §8: trades `{"ticker", "side", "quantity", "status", "price"?, "error"?}`, watchlist `{"ticker", "action", "status", "error"?}`. For a malformed item, store the raw field only if it is a primitive (`str`/`int`/`float`, truncated to 32 chars), else `null`. The frontend must tolerate `null` fields.

### Pattern 6: Failure notes (AI-08)
One line per failed action, appended after a blank line: `content = message.rstrip() + "\n\n" + "\n".join(notes)`.
- Trade: `⚠️ Couldn't {side} {qty} {TICKER}: {reason}.` with `qty` from `format_qty` (backend/app/money.py:58).
- Watchlist: `⚠️ Couldn't add {T} to your watchlist: {reason}.` / `⚠️ Couldn't remove {T} from your watchlist: {reason}.`
- Malformed: `⚠️ Couldn't run a requested trade: {reason}.`
- `reason` = the service error with its trailing `.` stripped and its first letter lowercased **only when the second character is lowercase**. So "Insufficient cash (need $12,450.00, have $8,095.00)." → "insufficient cash (need $12,450.00, have $8,095.00)", while "PYPL is not on your watchlist" stays as is. This reproduces the PLAN §9 example exactly.

### Pattern 7: Storage and history (AI-11)
- Insert with `db.transaction()` in `to_thread`; `id = str(uuid.uuid4())`; `created_at = now_iso()`; `actions = json.dumps(actions) if actions is not None else None`.
- `GET /api/chat/history` → `{"messages": [...]}`: the last 50 by `created_at DESC, rowid DESC`, reversed to oldest first, with `actions` parsed back with `json.loads`. The POST response is built from the same dict that was stored, so live and reloaded chips are byte-identical.
- No `state_lock` for chat rows (SQLite serializes the writes). Optionally serialize whole chat turns with a separate `chat_lock = asyncio.Lock()`, **never** `state_lock` (the executor's services take `state_lock`, which is non-reentrant).

### Frontend Pattern A: chat store and panel (AI-12, AI-14, AI-16)
- `useChat` state: `messages: ChatEntry[]` (server `ChatMessage` or local `{kind: "system", id, text, tone: "error" | "info"}`), `pending: boolean`, `loaded`, `loadHistory()`, `send(text)`, `clear()`.
- `send`: return early if `pending`; trim; pre-check empty or >2,000 code points → push a system bubble, no request; otherwise push an optimistic user entry, `pending = true`, `apiFetch<ChatMessage>("/api/chat", {method: "POST", body})`. On success push the assistant message. On `ApiError` push a system bubble with `err.message`: the server text, so 503 reads "AI assistant is not configured…" and 502/400 show the server's error. On a network error push "Could not reach the server. Try again." Always end with `pending = false`. Resolve to the assistant message (or `null`) so the **component** can trigger refetches.
- `loadHistory` uses a sequence guard like `portfolio.ts`: discard the response if a `send` or `clear` happened after the request started.
- Panel: a `<textarea>`; Enter sends and Shift+Enter inserts a newline; the button and Enter are disabled while `pending`; a `chat-loading` indicator; `whitespace-pre-wrap` text rendered as React text nodes (never `dangerouslySetInnerHTML`, never markdown); auto-scroll by setting `listRef.current.scrollTop = listRef.current.scrollHeight` in an effect on `messages.length` / `pending`; prompt chips ("Analyze my portfolio", "Buy 5 NVDA", …) only when there are no messages and nothing is pending.
- Collapse: a header toggle (`chat-toggle`, `aria-expanded`). Keep it as local component state or in the chat store. At `xl` the grid's third column switches from `360px` to a narrow rail.

### Frontend Pattern B: chips (AI-13)
- Executed trade: `BUY 5 NVDA @ $875.20` (`formatMoney` from `domain/portfolio`). Executed watchlist: `+ PYPL watchlist` / `− PYPL watchlist`.
- Failed: a different border and text color (`border-down text-down`), a ⚠ glyph, and the `error` text.
- Hooks: `data-testid="chat-action"`, `data-kind="trade|watchlist"`, `data-status="executed|failed"`.

### Frontend Pattern C: post-action refresh (AI-15)
`ChatPanel` (a component, not the store) does `const reply = await useChat.getState().send(text); if (reply?.actions) { void usePortfolio.getState().refresh(); void useWatchlist.getState().loadWatchlist(); }`. `refresh()` already reloads the portfolio, trades and P&L history through their sequence guards. This follows the Header precedent and keeps "stores never import each other".

### Frontend Pattern D: reset (PF-10)
In `ResetButton`: `disabled={resetting || chatPending}`, where `chatPending = useChat((s) => s.pending)`. After `reset()` returns `null`: `useChat.getState().clear()`, `usePrices.getState().clearSparklines()` (sets `spark: {}`; keeps `lastTs` so old frames never re-append), `useWatchlist.getState().select(null)` (widen the type, or add `clearSelection()`), then `loadWatchlist()`. `nextSelection` then picks the first default ticker, and `ChartPanel` re-seeds from `/api/prices/{T}/history` because `selected` changed (its history effect depends on `[selected]`, ChartPanel.tsx:166).

### Layout (UX-02)
The grid already shows header, watchlist, chart, heatmap + P&L, and positions + trade, with a chat column at `xl` (≥1280px) and chat under the center column at `md` (768–1279px). The remaining work: make the chat panel collapsible, keep everything visible at once at 1440×900 without page scroll (`xl:h-screen` is already set), and confirm tablet (1024×768) stays usable (page scrolls, chat below). Verify visually; E2E can assert each `panel-*` is visible at a 1440×900 viewport.

### Anti-Patterns to Avoid
- **Holding `state_lock` across the LLM call or around service calls:** this deadlocks (non-reentrant) and blocks trades and reset for seconds.
- **Separate mock branch in the route:** it skips the parser, executor and notes, so E2E proves nothing about the real path.
- **Constraints in the LLM schema** (`gt`, `pattern`, `max_length` on lists): Cerebras strict mode rejects them, and every chat returns 502.
- **Importing litellm at module top-level in `app/`:** this adds a GitHub fetch (≤5s, retried) and a multi-second import to every test run, every app start, and mock-mode E2E.
- **Replaying stored `actions` JSON to the model:** duplicate trades.
- **Rendering chat content as HTML or markdown:** XSS risk, and G-17 asks for plain text.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Trade rules for AI trades | A chat-specific trade path | `TradeService.execute` | AI-05; the lock, rounding, dust, snapshot and tracker are already proven |
| Watchlist add/remove for AI | Direct SQL | `WatchlistService.add/remove` | Cap, idempotency, tracker reconcile, exact error text |
| Portfolio context numbers | Recomputing P&L in the prompt builder | `PortfolioService.view()` | AI-02; identical to `GET /api/portfolio` |
| JSON schema for the provider | A hand-written schema dict | LiteLLM's Pydantic `response_format` conversion | It produces the strict schema with `additionalProperties: false` |
| Money/qty text in notes | f-string `:.2f` | `format_money`, `format_qty` (backend/app/money.py:51-63) | Half-up rounding, thousands separators, trimmed zeros |
| HTTP error envelope | Per-route `JSONResponse` | `DomainError` subclasses + `error_handlers()` | One envelope, consistent status codes |
| E2E browser install | `npx playwright install` in CI | The official `mcr.microsoft.com/playwright:v1.64.1-noble` image | Browsers and OS deps match the pinned version |

**Key insight:** Nearly all the domain logic exists already. The chat feature is an orchestration layer, and its risk is the external LLM boundary, not trading math.

## Common Pitfalls

### Pitfall 1: Empty or `None` content from a reasoning model
**What goes wrong:** gpt-oss is a reasoning model, and a small `max_tokens` is consumed by reasoning, so `message.content` is `None`. `model_validate_json(None)` raises `TypeError`, not `ValidationError`, which escapes as a 500.
**How to avoid:** `content = response.choices[0].message.content or ""`; don't set a small `max_tokens`; keep `reasoning_effort="low"`; in the parser treat empty text as `LLMError`/502. Catch `ValueError`, `TypeError` and `json.JSONDecodeError` explicitly.
**Warning signs:** sporadic 500s on `/api/chat`.

### Pitfall 2: Provider fallback ignores the schema
**What goes wrong:** `provider.order` alone still falls back ("proceed to other providers if none are operational"; `allow_fallbacks` defaults to `true`). With `require_parameters` at its default `false`, `response_format` is only a soft preference [CITED: openrouter.ai/docs/guides/routing/provider-selection]. The reply then arrives as prose or fenced JSON.
**How to avoid:** `EXTRA_BODY = {"provider": {"order": ["cerebras"], "require_parameters": True}}`, plus fence stripping in the parser. Recommend also `"allow_fallbacks": False` for deterministic behavior (a Cerebras outage becomes a clean 502). This is a small, recommended deviation from the skill snippet; flag it at the human-verify spike.

### Pitfall 3: Import-time network fetch and heavy import
**What goes wrong:** `litellm/__init__.py` runs `model_cost = get_model_cost_map(url=model_cost_map_url)` at import. That does an httpx GET to GitHub with `timeout: int = 5` and up to 3 attempts. It is skipped only when `os.getenv("LITELLM_LOCAL_MODEL_COST_MAP", "").lower() == "true"` [CITED: github.com/BerriAI/litellm litellm/__init__.py and litellm/litellm_core_utils/get_model_cost_map.py].
**How to avoid:** `os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")` immediately before the lazy import, and `ENV LITELLM_LOCAL_MODEL_COST_MAP=True` in the Dockerfile's ENV block (Dockerfile:22-26). Import only in real mode, inside `to_thread`.

### Pitfall 4: Blocking the event loop
**What goes wrong:** a sync `completion()` inside `async def` freezes SSE and the snapshot task for 1–3s per chat (project Pitfall 2).
**How to avoid:** `await asyncio.to_thread(self._complete_sync, messages)`. Test it: a FakeLLM that sleeps in a thread while an SSE or health request still answers is overkill. Instead, a unit test asserts that `OpenRouterLLMClient.complete` calls through `asyncio.to_thread`, by patching the sync function and asserting it ran on a different thread id.

### Pitfall 5: E2E wipes the user's real data
**What goes wrong:** `docker-compose.yml` declares `volumes: finally-data: name: finally-data  # explicit name` [VERIFIED: docker-compose.yml:87-89]. Any test compose that mounts `finally-data` (or extends the main compose) shares the user's database, and `beforeEach` reset wipes it. It also uses `image: finally:latest` [VERIFIED: docker-compose.yml:59], which the start scripts reuse.
**How to avoid:** the test compose sets `name: finally-test`, uses `tmpfs: [/app/db]`, tags its image `finally-test:latest`, has **no** `env_file` (so the real `.env` key is never injected), and sets `LLM_MOCK: "true"`, `MASSIVE_API_KEY: ""` and `OPENROUTER_API_KEY: ""` explicitly.

### Pitfall 6: Playwright against live prices
**What goes wrong:** `networkidle` never settles (SSE stays open); exact cash and price asserts are flaky; parallel workers share one backend.
**How to avoid:** `workers: 1`, `fullyParallel: false`; reset in `beforeEach` via `request.post("/api/reset")`; web-first assertions (`await expect(page.getByTestId("price-AAPL")).not.toHaveText("—")`); relational checks. Compare the heatmap tile `data-sign` with `position-pnlpct-{T}` `data-sign` in **one** `page.evaluate` read inside `expect.poll`, because two separate reads can straddle a tick. Accept the `window.confirm` with `page.once("dialog", d => d.accept())` before clicking Reset.

### Pitfall 7: Version drift between image and npm package
**How to avoid:** pin `@playwright/test` to exactly `1.64.1` (`--save-exact`) and the image to `v1.64.1-noble`. The image does not include the npm package ("The Playwright package/dependency is not included in the image and should be installed separately") [CITED: playwright.dev/docs/docker], so run `npm ci` in the test Dockerfile. Use `ipc: host` ("recommended when using Chromium") and `init: true` [CITED: playwright.dev/docs/docker].

### Pitfall 8: jsdom has no `scrollIntoView`
**What goes wrong:** auto-scroll implemented with `el.scrollIntoView()` throws `TypeError` in Vitest.
**Evidence:** probed with the project's jsdom: `scrollIntoView: undefined scrollTo: undefined`, while `scrollTop` assignment works [VERIFIED: node probe against frontend/node_modules/jsdom this session].
**How to avoid:** `list.scrollTop = list.scrollHeight`.

### Pitfall 9: Stale history load overwrites a send
**What goes wrong:** the mount-time `GET /api/chat/history` resolves after the user's first send and replaces the optimistic messages.
**How to avoid:** a sequence guard (as in `portfolio.ts:36-48`); `send` and `clear` bump the sequence.

### Pitfall 10: Reset racing an in-flight chat
**What goes wrong:** reset deletes `chat_messages`, then the in-flight chat stores its assistant message and executes trades into the fresh account (G-16).
**How to avoid:** disable Reset while `pending` (PF-10). The backend race stays as an accepted demo limitation (both paths use `state_lock` per mutation, so there is no corruption, only an orphaned reply).

### Pitfall 11: Existing frontend tests break when the chat panel mounts
**What goes wrong:** `terminal.test.tsx` renders `<Terminal/>`. The new panel's history fetch hits `stubApi`, which returns 404 for unknown routes, so an error bubble appears and the `ComingSoon` assertions for `panel-chat` fail.
**How to avoid:** add `"GET /api/chat/history": { messages: [] }` to `DEFAULT_API` in `src/test/stubFetch.ts`, update any assertion on the placeholder text, and reset the chat store between tests like the other stores.

### Pitfall 12: Mock regex edge cases
`\badd\s+([A-Za-z][A-Za-z0-9.]{0,9})\b` on "add PYPL." still captures `PYPL`: the greedy match backtracks off the trailing dot because `\b` needs a word/non-word boundary. "Buy 5 NVDA" with the mock buys **1 AAPL** (the PLAN §9 rule), not NVDA. E2E and UAT expectations must follow the mock table, not the prompt text. "sell" with no AAPL held fails ("Insufficient shares (need 1, have 0).") and is a good failure-note case.

## Code Examples

### OpenRouter client (skill-conformant, off-loop, lazy import)
```python
# Source: .claude/skills/cerebras/SKILL.md (MODEL, EXTRA_BODY, completion(..., response_format=..., reasoning_effort="low", extra_body=...))
# plus OpenRouter provider docs (require_parameters) and litellm get_model_cost_map (env flag)
MODEL = "openrouter/openai/gpt-oss-120b"
EXTRA_BODY = {"provider": {"order": ["cerebras"], "require_parameters": True}}  # + "allow_fallbacks": False (decide at spike)
LLM_TIMEOUT = 30.0  # seconds; [ASSUMED] litellm `timeout` kwarg

class OpenRouterLLMClient:
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key  # never logged

    def warm(self) -> None:
        os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")  # before the import
        import litellm  # noqa: F401  heavy; called via to_thread from lifespan

    async def complete(self, messages: list[dict[str, str]]) -> str:
        return await asyncio.to_thread(self._complete_sync, messages)

    def _complete_sync(self, messages: list[dict[str, str]]) -> str:
        self.warm()
        from litellm import completion
        try:
            response = completion(
                model=MODEL, messages=messages, response_format=LLMReply,
                reasoning_effort="low", extra_body=EXTRA_BODY,
                api_key=self._api_key, timeout=LLM_TIMEOUT,   # [ASSUMED] kwarg names
            )
        except Exception as exc:  # litellm maps provider errors to its own exception types
            raise LLMError(type(exc).__name__) from exc
        return response.choices[0].message.content or ""
```

### Mock rules (G-14, PLAN §9 table, first rule wins)
```python
_BUY = re.compile(r"\bbuy\b", re.IGNORECASE)
_SELL = re.compile(r"\bsell\b", re.IGNORECASE)
_ADD = re.compile(r"\badd\s+([A-Za-z][A-Za-z0-9.]{0,9})\b", re.IGNORECASE)
_REMOVE = re.compile(r"\bremove\s+([A-Za-z][A-Za-z0-9.]{0,9})\b", re.IGNORECASE)
GREETING = "Hello! I'm FinAlly, your AI trading assistant. How can I help?"

def mock_reply(text: str) -> dict:
    if _BUY.search(text):
        return {"message": "Buying 1 share of AAPL.", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 1}], "watchlist_changes": []}
    if _SELL.search(text):
        return {"message": "Selling 1 share of AAPL.", "trades": [{"ticker": "AAPL", "side": "sell", "quantity": 1}], "watchlist_changes": []}
    if m := _ADD.search(text):
        t = m.group(1).upper()
        return {"message": f"Adding {t} to your watchlist.", "trades": [], "watchlist_changes": [{"ticker": t, "action": "add"}]}
    if m := _REMOVE.search(text):
        t = m.group(1).upper()
        return {"message": f"Removing {t} from your watchlist.", "trades": [], "watchlist_changes": [{"ticker": t, "action": "remove"}]}
    return {"message": GREETING, "trades": [], "watchlist_changes": []}
# MockLLMClient.complete(messages) → json.dumps(mock_reply(last user message content))
```
The message strings are copied from the PLAN §9 table [CITED: planning/PLAN.md §9].

### System prompt (AI-03, G-17; wording at Claude's discretion)
```text
You are FinAlly, an AI trading assistant inside a simulated trading terminal (fake money).
- Analyze portfolio composition, concentration risk and unrealized P&L using the context provided.
- Suggest trades with brief reasoning. Execute trades only when the user asks or agrees.
- Manage the watchlist proactively when it helps the user.
- Be concise and data-driven. Plain text only: no markdown tables, no headings.
- Quantities are shares, up to 4 decimal places. Convert dollar amounts to shares using the
  current price in the context. For "sell all", use the exact held quantity from the context.
- Only include trades and watchlist_changes the user requests in their latest message; never repeat earlier actions.
- Describe orders as being placed; the app confirms fills and reports failures.
- Always reply with JSON: {"message": string, "trades": [...], "watchlist_changes": [...]}, using [] when there are none.
```

### Failure note helper
```python
def _reason(error: str) -> str:
    text = error.strip().rstrip(".")
    if len(text) > 1 and text[0].isupper() and text[1].islower():
        text = text[0].lower() + text[1:]
    return text
# f"⚠️ Couldn't {side} {format_qty(qty)} {ticker}: {_reason(err)}."
# → "⚠️ Couldn't buy 50 TSLA: insufficient cash (need $12,450.00, have $8,095.00)."
```

### Test compose (E2E)
```yaml
# test/docker-compose.test.yml — run from repo root:
#   docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright
#   docker compose -f test/docker-compose.test.yml down -v
name: finally-test
services:
  app:
    build: { context: .., dockerfile: Dockerfile }
    image: finally-test:latest
    environment:
      LLM_MOCK: "true"
      OPENROUTER_API_KEY: ""
      MASSIVE_API_KEY: ""
      DB_PATH: /app/db/finally.db
    tmpfs: [/app/db]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=3)"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 20s
  playwright:
    build: { context: . }          # test/Dockerfile: FROM mcr.microsoft.com/playwright:v1.64.1-noble; npm ci
    environment:
      BASE_URL: http://app:8000
      CI: "true"
    depends_on:
      app: { condition: service_healthy }
    ipc: host
    init: true
    volumes:
      - ./playwright-report:/e2e/playwright-report
      - ./test-results:/e2e/test-results
    command: ["npx", "playwright", "test"]
```
The healthcheck command is copied from the existing compose [VERIFIED: docker-compose.yml:75-81]. Report dirs are already gitignored (`test/test-results/`, `test/playwright-report/`) [VERIFIED: .gitignore]. The root `.dockerignore` excludes `test` from the app build context [VERIFIED: .dockerignore:116-117], which is correct; the Playwright build context is `test/` itself and needs its own `test/.dockerignore` (`node_modules`, `test-results`, `playwright-report`).

### playwright.config.ts essentials
```ts
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:8000", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
// each spec: test.beforeEach(async ({ request, page }) => { await request.post("/api/reset"); await page.goto("/"); });
```
`BASE_URL` defaults to localhost only for debugging against a disposable app. **Never** point it at the `docker compose up` app that holds real data: `beforeEach` resets it.

### The seven PLAN §12 scenarios → assertions
1. Fresh start: 10 `watchlist-row-*`; `header-cash` = `$10,000.00`; `connection-dot[data-status=open]`; `price-AAPL` not `—` and its text changes (`expect.poll`).
2. Watchlist: add `PYPL` → `watchlist-row-PYPL` visible; click `remove-PYPL` → hidden.
3. Buy: `trade-ticker` AAPL, `trade-qty` 1, `trade-buy` → `position-row-AAPL` visible, parsed `header-cash` < 10000, one `trade-history-row`.
4. Sell: buy 2, sell 2 → `position-row-AAPL` gone; cash after sell > cash after buy.
5. Visualization: after a buy, `heatmap-tile-AAPL` visible and its `data-sign` equals `position-pnlpct-AAPL`'s (one evaluate, polled); `pnl-chart[data-point-count]` ≥ 2 (startup snapshot + trade snapshot; reset writes one, the trade another).
6. AI chat (mocked): type "buy" + Enter → `chat-loading` visible then gone; an assistant `chat-message` "Buying 1 share of AAPL."; `chat-action[data-status=executed][data-kind=trade]`; `position-row-AAPL` appears.
7. Reset: after a buy and a chat, accept the dialog, click `reset-button` → `header-cash` `$10,000.00`, 10 watchlist rows, `positions-empty` visible, no `chat-message`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON mode (`json_object`) + prompt-only schema | `json_schema` strict structured outputs (Cerebras supports strict for gpt-oss-120b) | 2025–2026 | The schema subset matters; keep constraints out |
| `provider.order` assumed exclusive | Explicit `require_parameters` / `allow_fallbacks` | OpenRouter docs | Fallbacks are on by default |
| Unpinned `litellm` | Exact pin + lock hashes after the 1.82.7/1.82.8 compromise | 2026-03 | Pin; a human verifies before install |

**Deprecated/outdated:** none relevant in the existing code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | litellm `completion()` accepts `api_key=` and `timeout=` kwargs with those names | Code Examples | Low: TypeError at the spike; fall back to the `OPENROUTER_API_KEY` env var, which litellm reads |
| A2 | Cerebras via OpenRouter accepts the strict schema LiteLLM generates from `LLMReply` (nested `$defs`, `enum` from `Literal`) | Pattern 3 | High: every chat returns 502. Mitigated by the spike checkpoint; the docs say `$ref`/`$defs` (local) and `enum` are supported |
| A3 | `"allow_fallbacks": False` is preferable to availability | Pitfall 2 | Low: a product choice; confirm at the spike |
| A4 | The image grows by roughly 150–250 MB with litellm | Standard Stack | Low: cosmetic |
| A5 | The litellm logger may log one INFO line per call; set `logging.getLogger("LiteLLM").setLevel(logging.WARNING)` to keep logs clean | Security | Low |
| A6 | 1.106.2 is free of known security issues beyond the lock's hash guarantee | Package audit | Medium: the human-verify checkpoint covers it |
| A7 | Client-side pre-check for empty/over-long messages (bubble without a request) satisfies "rejected with a clear bubble"; the server 400 remains authoritative | Frontend Pattern A | Low: alternatively send and render the server 400 |

## Open Questions

1. **Spike result for strict schema plus provider routing** (STATE.md blocker)
   - Known: the docs say gpt-oss-120b supports strict mode on Cerebras; LiteLLM emits `strict: True`.
   - Unclear: whether OpenRouter passes the strict schema through unchanged, and whether `require_parameters` filters Cerebras correctly for this model today.
   - Recommendation: the first real-LLM task is a `checkpoint:human-verify` spike. A tiny script under `backend/` (not a test) calls `OpenRouterLLMClient.complete` with the final `LLMReply` schema and prints the raw content; the human runs it with their key. The researcher did not read `.env` and made no live call.
2. **Chat turn serialization:** use a `chat_lock` so two tabs can't interleave turns? Recommended, low cost; the planner can decide.
3. **Where the "not configured" bubble appears:** on send (the 503 response) is enough for success criterion 3. Showing it on load would need a status endpoint not in PLAN §8. Recommend on send.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| uv | backend deps/tests | ✓ | 0.13.0 | — |
| Python (uv-managed 3.12 via `backend/.python-version`) | backend | ✓ | system 3.14.5; uv picks 3.12 | — |
| Node | frontend, `test/` npm project | ✓ | v22.23.4 (`.nvmrc` = 22) | — |
| npm | same | ✓ | 10.9.9 | — |
| Docker | image build, E2E | ✓ | 29.8.0 | — |
| Docker Compose | E2E | ✓ | v5.5.1 | — |
| PyPI / npm / MCR network | `uv add`, `npm install`, image pull | ✓ (queried this session) | — | — |
| OpenRouter key | real-LLM spike, UAT "Analyze my portfolio" | not checked (secret) | — | `LLM_MOCK=true` for everything automated |

Baseline (run this session): backend `388 passed in 10.27s`; frontend `16 files, 255 tests passed` in ~5s.

**Missing dependencies with no fallback:** none for automated work. The real-LLM spike and UAT need the user's key (human step).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Backend: pytest 9 + pytest-asyncio (`asyncio_mode = "auto"`), Starlette `TestClient`. Frontend: Vitest 5 + Testing Library + jsdom (`FakeEventSource`, `stubApi`). E2E: @playwright/test 1.64.1 in Docker |
| Config file | `backend/pyproject.toml` `[tool.pytest.ini_options]`; `frontend/vitest.config.mts` + `vitest.setup.ts`; new `test/playwright.config.ts` |
| Quick run command | `uv run --directory backend --extra dev pytest -q -x tests/test_chat_api.py tests/test_chat_actions.py tests/test_chat_parsing.py tests/test_chat_mock.py` · `npm --prefix frontend test -- src/components/ChatPanel.test.tsx src/store` |
| Full suite command | `uv run --directory backend --extra dev pytest -q && uv run --directory backend --extra dev ruff check app tests && uv run --directory backend --extra dev ruff format --check app tests && npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend run build` |
| E2E (phase gate, minutes) | `docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright; docker compose -f test/docker-compose.test.yml down -v` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AI-01 | POST returns stored assistant message shape `{id, role, content, actions, created_at}`; real client builds skill-conformant call (patched `completion`: model, `response_format=LLMReply`, `reasoning_effort="low"`, extra_body) via to_thread | integration + unit | `uv run --directory backend --extra dev pytest -q tests/test_chat_api.py tests/test_chat_llm.py` | ❌ Wave 0 |
| AI-02 | context numbers equal `PortfolioService.view()`; history = 20 prior rows, oldest first, new user msg last | unit | `... pytest -q tests/test_chat_prompt.py` | ❌ Wave 0 |
| AI-03 | system prompt contains each rule phrase | unit | `... pytest -q tests/test_chat_prompt.py -k system` | ❌ Wave 0 |
| AI-04 | fixture corpus: valid, fenced, extra keys, missing arrays, null content, prose → 502 with user row kept; bad item → failed only | unit + integration | `... pytest -q tests/test_chat_parsing.py tests/test_chat_api.py -k "502 or malformed"` | ❌ Wave 0 |
| AI-05 | watchlist before trades; independence; executed price = fill; `actions` null when none | unit (trade_env) | `... pytest -q tests/test_chat_actions.py` | ❌ Wave 0 |
| AI-06 | add existing → executed; remove unwatched → failed "PYPL is not on your watchlist" | unit | `... pytest -q tests/test_chat_actions.py -k idempotent` | ❌ Wave 0 |
| AI-07 | 11th trade/change → failed "too many actions" | unit | `... pytest -q tests/test_chat_actions.py -k cap` | ❌ Wave 0 |
| AI-08 | note text exactly matches PLAN §9 example; stored content includes notes | unit | `... pytest -q tests/test_chat_actions.py -k note` | ❌ Wave 0 |
| AI-09 | no key → app starts, 503 exact text, 0 rows; empty/whitespace/2001 chars → 400, 0 rows; `{"message": 5}` → 422 | integration | `... pytest -q tests/test_chat_api.py -k "503 or 400 or 422"` | ❌ Wave 0 |
| AI-10 | each mock rule, word boundaries ("buyer", "bestseller", "address" → greeting), uppercase capture, first rule wins; mock path stores and executes | unit + integration | `... pytest -q tests/test_chat_mock.py` | ❌ Wave 0 |
| AI-11 | history last 50 oldest first, actions round-trip identical to POST; panel loads history on mount | integration + component | `... pytest -q tests/test_chat_api.py -k history` · `npm --prefix frontend test -- src/components/ChatPanel.test.tsx -t history` | ❌ Wave 0 |
| AI-12 | Enter sends, Shift+Enter newline, loading shown, second send blocked, scrollTop set | component | `npm --prefix frontend test -- src/components/ChatPanel.test.tsx` | ❌ Wave 0 |
| AI-13 | executed chip text; failed chip `data-status=failed` + error | component | same file `-t chip` | ❌ Wave 0 |
| AI-14 | 503/502/400 → system bubble with server text | component | same file `-t bubble` | ❌ Wave 0 |
| AI-15 | non-null actions → GET /api/portfolio, /api/watchlist, /api/portfolio/history, /api/trades called; null → not | component | same file `-t refetch` (uses `callsTo`) | ❌ Wave 0 |
| AI-16 | chips shown only when empty; click sends | component | same file `-t prompt` | ❌ Wave 0 |
| PF-10 | Reset disabled while pending; after reset chat cleared, spark cleared, selection → first default, every panel refetched | component | `npm --prefix frontend test -- src/components/header.test.tsx src/components/terminal.test.tsx -t reset` | ✅ files exist (extend) |
| UX-02 | all `panel-*` visible at 1440×900; chat collapsible | E2E + manual | scenario in `test/e2e/layout.spec.ts`; manual tablet check | ❌ Wave 0 |
| TST-01 | backend suite green incl. new chat tests | suite | full suite command | ✅ partial |
| TST-02 | frontend suite green incl. chat | suite | `npm --prefix frontend test` | ✅ partial |
| TST-03 | 7 scenarios pass in compose under LLM_MOCK | E2E | E2E command above | ❌ Wave 0 |
| TST-04 | chat hooks + `data-point-count` exist | component + E2E | ChatPanel/PnlChart tests assert attributes | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the quick command for the touched area (<15s each).
- **Per wave merge:** the full suite command (~30–60s, plus `next build`).
- **Phase gate:** full suite + E2E compose run green + the human-verified real-LLM spike, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `backend/tests/test_chat_parsing.py`, `test_chat_actions.py`, `test_chat_mock.py`, `test_chat_api.py`, `test_chat_prompt.py`, `test_chat_llm.py` (patched `completion`; never imports a real network path)
- [ ] `backend/tests/conftest.py`: a `FakeLLMClient` and a `chat_client` fixture (`make_app(llm_client=...)`, RecordingSource, AAPL priced); a `trade_env`-based executor fixture
- [ ] `frontend/src/test/stubFetch.ts`: add `"GET /api/chat/history": { messages: [] }` to `DEFAULT_API`
- [ ] `frontend/src/components/ChatPanel.test.tsx`, a chat store test; extend `header.test.tsx`/`terminal.test.tsx` for PF-10
- [ ] `test/` project: `package.json` (exact `@playwright/test@1.64.1`), lockfile, `playwright.config.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.test.yml`, `e2e/*.spec.ts`
- [ ] Framework install: `uv add "litellm==1.106.2" "pydantic>=2.12"` (after human-verify); `npm install --save-exact --save-dev @playwright/test@1.64.1` in `test/` (after human-verify)

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user by design (PLAN §3); out of scope |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No users; `user_id` is hardcoded server-side, never taken from the request |
| V5 Input Validation | yes | `ChatRequest.message: StrictStr`, strip + length cap 2,000 (400); per-item `StrictStr`/`StrictFloat` validation of LLM output; all semantics through `normalize_ticker` and `TradeService` rules; parameterized SQL only |
| V6 Cryptography | no | None; the key comes only from env |
| V7 Error Handling & Logging | yes | 502/503 bodies carry fixed text, never provider exception details; log `type(exc).__name__` plus a component prefix; never log the key (`Settings` field `repr=False`); LiteLLM loggers at WARNING [ASSUMED A5] |
| V8 Data Protection | partial | `.env` never copied into images (`.dockerignore`), test compose has no `env_file` |
| V13 API | yes | 422 for malformed bodies; JSON 404 catch-all already in place; action caps bound the work per request (G-21) |
| V14 Configuration | yes | Exact dependency pins + lock hashes (`uv sync --locked`); `LITELLM_LOCAL_MODEL_COST_MAP=True` removes an outbound fetch at import |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM output drives unintended trades (hallucination, re-emitting history) | Tampering | Same trade rules; caps 10+10; history replays text only; prompt "only latest request" |
| Prompt injection via user text | Tampering | Simulated money only; every action passes the server-side rules; no tools beyond trade/watchlist |
| XSS via assistant content | Tampering | Render as React text nodes, `whitespace-pre-wrap`; no markdown or HTML sink |
| API key leakage in logs or `repr` | Information disclosure | `field(repr=False)`; no key in log format strings; fixed 502 text |
| Supply-chain (litellm compromise history) | Tampering | Exact pin, lockfile hashes, human-verify checkpoint before install |
| Cost abuse of `/api/chat` when exposed on a LAN | DoS / financial | Accepted (no auth by design); README already notes LAN exposure; 2,000-char cap and one-in-flight UI |
| E2E resetting real data | Tampering (operational) | Separate compose project, tmpfs DB, no shared volume |

## Sources

### Primary (HIGH confidence)
- Codebase, read this session: `backend/app/{main,config,errors,trading,watchlist,portfolio,valuation,tickers,money,tracker}.py`, `backend/app/api/*.py`, `backend/app/db/{__init__.py,schema.sql,seed.py}`, `backend/tests/conftest.py`, `frontend/src/{components/Terminal.tsx,components/Header.tsx,store/*.ts,api/client.ts,api/types.ts,test/stubFetch.ts,domain/market.ts}`, `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.gitignore`, `.claude/skills/cerebras/SKILL.md`
- PyPI JSON API (litellm releases and requires_dist), `uv lock` probe in scratch (40 → 82 packages)
- npm registry (@playwright/test 1.64.1 dates); MCR tag list (`v1.64.1-noble` present)
- jsdom probe (no `scrollIntoView`/`scrollTo`)

### Secondary (MEDIUM confidence)
- https://inference-docs.cerebras.ai/capabilities/structured-outputs: strict-mode keyword support and limits
- https://openrouter.ai/docs/guides/routing/provider-selection: `order`, `allow_fallbacks`, `require_parameters`
- https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/litellm_core_utils/get_model_cost_map.py and `litellm/__init__.py`: import-time cost-map fetch and the env flag
- https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/llms/base_llm/base_utils.py: `type_to_response_format_param` (strict schema)
- https://docs.litellm.ai/docs/completion/json_mode: Pydantic `response_format`
- https://docs.litellm.ai/docs/completion/stream: `acompletion`
- https://playwright.dev/docs/docker: image pinning, `--ipc=host`, `--init`, package not included
- `.planning/research/STACK.md`, `PITFALLS.md` (Pitfalls 12–14, 17), `FEATURES.md` (G-11..G-21)

### Tertiary (LOW confidence)
- litellm supply-chain incident reports: https://www.bitsight.com/blog/litellm-versions-1-82-7-1-82-8-supply-chain-compromise, https://www.netspi.com/blog/executive-blog/ai-ml-pentesting/litellm-supply-chain-compromise/, https://futuresearch.ai/blog/litellm-pypi-supply-chain-attack/ (several sources agree)

## Metadata

**Confidence breakdown:**
- Integration points and reuse: HIGH (read live code, baseline suites green)
- Standard stack: MEDIUM-HIGH (versions verified on registries; both packages SUS on recency only)
- LLM boundary behavior: MEDIUM (docs and source; no live call; spike required)
- E2E architecture: MEDIUM (official Playwright docs plus repo compose; not executed)
- Pitfalls: HIGH for codebase-derived ones, MEDIUM for provider ones

**Research date:** 2026-10-28
**Valid until:** 2026-11-11 (litellm and Playwright release weekly; re-check pins at execution)
