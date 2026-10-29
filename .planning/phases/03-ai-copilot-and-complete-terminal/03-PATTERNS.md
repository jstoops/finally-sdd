# Phase 3: AI Copilot and Complete Terminal - Pattern Map

**Mapped:** 2026-10-29
**Files analyzed:** 33 (new + modified)
**Analogs found:** 29 / 33 (all analogs verified git-tracked via `git ls-files`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `backend/app/chat/__init__.py` (new) | package API | — | `backend/app/market/__init__.py`, `backend/app/api/__init__.py` | exact |
| `backend/app/chat/service.py` (new) | service | request-response + CRUD | `backend/app/watchlist.py` (WatchlistService) + `backend/app/portfolio.py` (`list_trades`) | role-match |
| `backend/app/chat/llm.py` (new) | client seam | request-response (external) | `backend/app/market/massive_client.py` (to_thread around blocking SDK, injectable client) | partial |
| `backend/app/chat/mock.py` (new) | utility | transform | `backend/app/tickers.py` (pure fn + regex) | partial |
| `backend/app/chat/parsing.py` (new) | utility | transform | `backend/app/tickers.py`, `TradeRequest` in `backend/app/api/portfolio.py` | partial |
| `backend/app/chat/actions.py` (new) | service helper | batch | `TradeService.execute` / `WatchlistService.add/remove` callers; `backend/app/money.py` formatters | partial |
| `backend/app/chat/prompt.py` (new) | utility | transform | `backend/app/watchlist.py` `_entry` dict shape | partial |
| `backend/app/api/chat.py` (new) | route | request-response | `backend/app/api/portfolio.py` | exact |
| `backend/app/api/__init__.py` (mod) | package API | — | itself | exact |
| `backend/app/config.py` (mod) | config | — | itself (`Settings`, `_env`) | exact |
| `backend/app/errors.py` (mod) | utility | — | itself (`NotFoundError`) | exact |
| `backend/app/main.py` (mod) | wiring | — | itself (`source_factory` seam, router order) | exact |
| `backend/pyproject.toml` / `uv.lock` (mod) | config | — | — | n/a (`uv add`) |
| `Dockerfile` (mod: `LITELLM_LOCAL_MODEL_COST_MAP`) | config | — | `Dockerfile:22-26` ENV block | exact |
| `backend/tests/conftest.py` (mod: `FakeLLMClient`, `llm_client` kwarg) | test fixture | — | `RecordingSource` + `make_app` in same file | exact |
| `backend/tests/test_chat_api.py` | test | request-response | `backend/tests/test_portfolio_api.py` | exact |
| `backend/tests/test_chat_actions.py` | test | batch | `backend/tests/test_trading.py` / `test_watchlist.py` (use `trade_env`) | exact |
| `backend/tests/test_chat_parsing.py`, `test_chat_mock.py`, `test_chat_prompt.py` | test | transform | `backend/tests/test_money.py`, `test_config.py` | role-match |
| `frontend/src/api/types.ts` (mod) | types | — | itself (`Trade`, `TradeResponse`) | exact |
| `frontend/src/store/chat.ts` (new) | store | request-response | `frontend/src/store/portfolio.ts` | exact |
| `frontend/src/store/prices.ts` (mod: `clearSparklines`) | store | — | itself (`setStatus`) | exact |
| `frontend/src/store/watchlist.ts` (mod: `select(null)` / `clearSelection`) | store | — | itself | exact |
| `frontend/src/components/ChatPanel.tsx` (new) | component | event-driven | `TradeBar.tsx` (form + store action) + `TradeHistory.tsx` (list rows) | role-match |
| `frontend/src/components/ChatPanel.test.tsx` (new) | test | — | `frontend/src/components/TradeBar.test.tsx` | exact |
| `frontend/src/components/Terminal.tsx` (mod) | component | — | itself, lines ~99-104 (`ComingSoon panel-chat`) | exact |
| `frontend/src/components/Header.tsx` (mod: PF-10) | component | — | itself, `ResetButton` lines 67-104 | exact |
| `frontend/src/components/PnlChart.tsx` (mod: `data-point-count`) | component | — | itself, line 98 | exact |
| `frontend/src/test/stubFetch.ts` (mod) | test helper | — | itself, `DEFAULT_API` lines 27-32 | exact |
| `frontend/src/components/terminal.test.tsx`, `header.test.tsx` (mod) | test | — | `terminal.test.tsx` beforeEach lines 137-154 | exact |
| `test/docker-compose.test.yml` (new) | config | — | `docker-compose.yml` | role-match (must diverge, see below) |
| `test/Dockerfile`, `test/package.json`, `test/playwright.config.ts`, `test/e2e/*.spec.ts` | E2E | — | none | no analog |

## Pattern Assignments

### `backend/app/api/chat.py` (route, request-response)

**Analog:** `backend/app/api/portfolio.py` (whole file, 62 lines)

Imports + strict body model (lines 1-25):
```python
"""Portfolio endpoints (PLAN §8): ..."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, StrictFloat

from ..portfolio import PortfolioService
from ..trading import TradeService


class TradeRequest(BaseModel):
    """POST body. No Literal or pattern here: a bad side or ticker must be a 400, not a 422. ..."""
    ticker: str
    quantity: StrictFloat
    side: str
```
For chat: `class ChatRequest(BaseModel): message: StrictStr` (non-string = 422; empty/>2000 = 400 raised by the service as `DomainError`).

Router factory (lines 28-41, 48-51):
```python
def create_portfolio_router(trade_service: TradeService, portfolio: PortfolioService) -> APIRouter:
    """Create the portfolio router bound to the given services (a new router per call)."""
    router = APIRouter(tags=["portfolio"])

    @router.post("/api/portfolio/trade")
    async def trade(body: TradeRequest) -> dict:
        result = await trade_service.execute(body.ticker, body.quantity, body.side)
        return result.to_dict()

    @router.get("/api/trades")
    async def list_trades() -> dict:
        return {"trades": await portfolio.list_trades()}

    return router
```
No try/except in routes: services raise `DomainError` subclasses and `error_handlers()` renders them. Export from `backend/app/api/__init__.py` (add to imports and `__all__`, alphabetical).

---

### `backend/app/errors.py` (add `ChatUnavailableError` 503, `LLMFailedError` 502)

**Analog:** same file lines 14-27 and 40-49:
```python
class NotFoundError(DomainError):
    """A missing resource; mapped to 404 `{"error": message}`."""
    status_code = 404

def error_handlers() -> dict:
    return {
        DomainError: _domain_error,
        NotFoundError: _domain_error,
        StarletteHTTPException: _http_error,
    }
```
Add each new subclass with its own `status_code` and register it explicitly with `_domain_error`. Warning: the chat executor catches `DomainError` from services; since these new classes subclass it, they must only be raised by `ChatService` outside the executor loop.

---

### `backend/app/config.py` (add `openrouter_api_key`, `llm_mock`)

**Analog:** same file lines 39-72. Fields need defaults because `conftest.py:68-70` builds `Settings(db_path=..., static_dir=...)`:
```python
@dataclass(frozen=True, slots=True)
class Settings:
    """... Any secret field added later must use `field(repr=False)` ..."""
    db_path: str
    static_dir: str
    dev_cors_origin: str | None = None
    # add: openrouter_api_key: str | None = field(default=None, repr=False)
    # add: llm_mock: bool = False

    @classmethod
    def from_env(cls, env_file: Path | None = None) -> Settings:
        load_dotenv(env_file or REPO_ROOT / ".env", override=False)
        return cls(
            db_path=_env("DB_PATH") or str(DEFAULT_DB_PATH),
            ...
            dev_cors_origin=_env("DEV_CORS_ORIGIN"),
        )

def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None
```
`llm_mock=(_env("LLM_MOCK") or "").lower() == "true"`. Update the "Holds no secrets" docstring. Tests in `backend/tests/test_config.py` use `patch.dict(os.environ, {...}, clear=True)`.

---

### `backend/app/main.py` (wiring)

**Analog:** same file.
- Test seam signature (lines 39-44): add `llm_client: LLMClient | None = None` beside `source_factory`; choose client once: override, else `MockLLMClient()` if `settings.llm_mock`, else `OpenRouterLLMClient(key)` if key, else `None` (mock check before key check).
- Service construction (lines 57-62): `watchlist` is a local, not on `app.state`; build `ChatService(db, portfolio, watchlist, trade_service, llm_client)` here. Never pass `state_lock` into chat; optionally a separate `chat_lock`.
- Lifespan (lines 64-84): real-mode warm-up `await asyncio.to_thread(client.warm)` after `db.init`, before `yield`.
- `app.state.*` (lines 87-93): add `app.state.chat_service` for tests.
- Router order (lines 106-111): `app.include_router(create_chat_router(chat_service))` BEFORE `install_api_not_found(app)`.
- Logging: `logger.info("App: ...", ...)` lazy `%s`; log mode ("mock"/"openrouter"/"disabled"), never the key.

---

### `backend/app/chat/service.py` (service, request-response + CRUD)

**Analog:** `backend/app/watchlist.py` (structure) + `backend/app/portfolio.py:67-90` (ordered read).

Constructor DI + `# --- Internals ---` banner (watchlist.py lines 22-42, 80):
```python
class WatchlistService:
    """Watchlist reads and mutations in the PLAN §8 shape. ..."""
    def __init__(self, db: Database, cache: PriceCache, tracker: TickerTracker, lock: asyncio.Lock) -> None:
        self._db = db
        ...
```
Insert in a transaction off-loop (watchlist.py lines 61, 99-104):
```python
row, created = await asyncio.to_thread(self._add_tx, ticker)
...
def _add_tx(self, ticker: str):
    with self._db.transaction() as conn:
        added_at = now_iso()
        conn.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, added_at),
        )
```
Newest-N read with rowid tiebreak (portfolio.py lines 71-88):
```python
def _load_trades(self, limit: int) -> list[dict]:
    """Blocking read. rowid breaks ties so trades in the same second keep execution order."""
    with closing(self._db.connect()) as conn:
        return [ {...} for row in conn.execute(
            "SELECT ... FROM trades "
            "WHERE user_id = ? ORDER BY executed_at DESC, rowid DESC LIMIT ?",
            (DEFAULT_USER_ID, limit),
        )]
```
For chat: `ORDER BY created_at DESC, rowid DESC LIMIT 50`, reverse in Python, `json.loads(actions)` when not null. Imports: `from ..db import DEFAULT_USER_ID, Database, now_iso`, `from ..errors import DomainError, ...`, `logger = logging.getLogger(__name__)`.

---

### `backend/app/chat/actions.py` (executor)

**Analog (callee contracts):** `backend/app/watchlist.py:54-75`:
```python
async def add(self, raw: str) -> tuple[dict, bool]:      # created=False is NOT an error (G-20)
async def remove(self, raw: str) -> None:
    ...
        raise NotFoundError(f"{ticker} is not on your watchlist")
```
`TradeService.execute(raw_ticker, quantity, side) -> TradeResult` (`backend/app/trading.py:94`); use `result.trade.price` and `result.trade.quantity` (filled qty). Catch `DomainError` (covers `NotFoundError`) → `e.message`; then broad `except Exception: logger.exception("Chat: action failed")`, matching the background-loop convention in `backend/app/market/simulator.py`. `normalize_ticker` calls `raw.strip()` (`backend/app/tickers.py:12-18`), so type-check items as `str` first. Notes use `format_money` / `format_qty` from `backend/app/money.py:51-63`.

---

### `backend/app/chat/llm.py` (client seam, external I/O)

**Analog:** `backend/app/market/massive_client.py` — blocking SDK call via `asyncio.to_thread` in `_poll_once`, injectable `client=` constructor param, `self._api_key` never logged. Protocol `LLMClient.complete(messages) -> str`; lazy `import litellm` inside the sync function after `os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")`. Code skeleton in 03-RESEARCH.md "OpenRouter client"; parameters per `.claude/skills/cerebras/SKILL.md`.

### `backend/app/chat/mock.py`, `parsing.py`, `prompt.py` (pure transforms)

**Analog:** `backend/app/tickers.py` (module-level compiled regex + pure function raising `DomainError`) and `backend/app/money.py` (pure formatters with unit tests in `test_money.py`). Mock rule code is given verbatim in 03-RESEARCH.md "Mock rules". Prompt context reuses `PortfolioService.view()` (`backend/app/portfolio.py:42-44`) and `WatchlistService.list_entries()` dicts `{"ticker","price","open_price","added_at"}` (`watchlist.py:122-129`).

---

### `backend/tests/conftest.py` (add `FakeLLMClient`, pass-through `llm_client`)

**Analog:** same file. `RecordingSource` (lines 28-59) is the fake template (records calls, no network). `make_app` (lines 73-96) already forwards `**kwargs` to `create_app`, so `make_app(llm_client=FakeLLMClient(...))` works once `create_app` accepts it. `trade_env` (lines 130-150) gives `TradeEnv` with `.trades`, `.watchlist`, `.portfolio`, `.price(ticker, value)` — use it for `test_chat_actions.py` and `test_chat_prompt.py`.

### `backend/tests/test_chat_api.py`

**Analog:** `backend/tests/test_portfolio_api.py` lines 1-40: module docstring, `ISO_RE`, exact key-order lists (`TRADE_KEYS = [...]`), `run_sql(db_path, sql)` helper with `closing(sqlite3.connect(...))` to assert stored rows (e.g. 503/400 store nothing, 502 stores only the user row). Use `client` fixture; `client.app.state.*` for services.

---

### `frontend/src/store/chat.ts` (store, request-response)

**Analog:** `frontend/src/store/portfolio.ts`.
- Imports + error text (lines 5-24):
```ts
import { create } from "zustand";
import { ApiError, apiFetch } from "@/api/client";
const NETWORK_ERROR = "Could not reach the server. Try again.";
function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
}
```
- Sequence guard (lines 33-48, and `loadHistory` lines 132-144): module-level `sequence`/`applied` counters; `send` and `clear` bump it so a stale `GET /api/chat/history` is discarded.
- Shape guard `isSnapshotList` (lines 73-79) → write `isChatHistory(body)`.
- Action returns outcome to the caller instead of cross-store calls (`trade` lines 178-198, `reset` lines 199-207: "The caller reloads the watchlist (the stores never import each other)").
- Interface with JSDoc per field (lines 88-121).

### `frontend/src/store/prices.ts` (add `clearSparklines`)

Same file lines 26-51: add `clearSparklines: () => set({ spark: {} })` next to `setStatus`; keep `lastTs` (prevents re-appending old frames).

---

### `frontend/src/components/ChatPanel.tsx` (component, event-driven)

**Analogs:** `TradeBar.tsx` (form, store action, inline error, testids) and `TradeHistory.tsx` (list rendering):
```tsx
"use client";
// Trade history (TRD-10): ...
import type { Trade } from "@/api/types";
import { formatPrice } from "@/domain/market";
import { formatQty } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";

const SIDE_CLASS = { buy: "text-up", sell: "text-down" } as const;
function TradeRow({ trade }: { trade: Trade }) {
  return (
    <li data-testid="trade-history-row" data-side={trade.side} className="... border-b border-border/50 px-2 py-0.5">
      <span className={`font-semibold ${SIDE_CLASS[trade.side]}`}>{trade.side === "buy" ? "BUY" : "SELL"}</span>
      <span className="text-right">{formatQty(trade.quantity)}</span>
      <span className="font-semibold text-text">{trade.ticker}</span>
      <span className="text-right">${formatPrice(trade.price)}</span>
```
(TradeHistory.tsx lines 1-34). Chips reuse this BUY/qty/ticker/$price composition with `data-testid="chat-action" data-kind data-status`; failed chips `border-down text-down`. Cross-store refresh after a reply with actions follows the Header precedent (component calls `usePortfolio.getState().refresh()` and `useWatchlist.getState().loadWatchlist()`). Auto-scroll via `scrollTop = scrollHeight` (jsdom has no `scrollIntoView`).

### `frontend/src/components/ChatPanel.test.tsx`

**Analog:** `frontend/src/components/TradeBar.test.tsx` lines 1-60: imports `act, fireEvent, render, screen`, `userEvent`, `stubApi/callsTo/jsonResponse` from `@/test/stubFetch`; typed fixture builders (`tradeOf(overrides)`); testid accessor helpers; `clickAndSettle` wrapping `fireEvent.click` in `await act(async () => ...)`. Reset stores in `beforeEach` with `setState` as in `terminal.test.tsx:137-154`; `afterEach(() => vi.unstubAllGlobals())`.

---

### `frontend/src/components/Header.tsx` (PF-10)

**Analog:** same file `ResetButton` lines 67-104:
```tsx
const err = await usePortfolio.getState().reset();
if (err === null) void useWatchlist.getState().loadWatchlist();
else setResetError(err);
...
disabled={resetting}
```
Extend: `const chatPending = useChat((s) => s.pending)`; `disabled={resetting || chatPending}`; on `null`: `useChat.getState().clear()`, `usePrices.getState().clearSparklines()`, clear selection, then `loadWatchlist()`.

### `frontend/src/components/Terminal.tsx`

Replace the `ComingSoon testId="panel-chat"` block (lines ~99-104) with `<ChatPanel />` keeping `className="min-h-64 md:col-start-2 xl:col-start-3 xl:row-start-1 xl:min-h-0"` and `data-testid="panel-chat"`. Grid `xl:grid-cols-[260px_minmax(0,1fr)_360px]` (line ~84) is where a collapsed rail width would switch.

### `frontend/src/test/stubFetch.ts`

`DEFAULT_API` lines 27-32: add `"GET /api/chat/history": { messages: [] }` (unmatched routes return 404 and would show an error bubble in every Terminal test).

### `frontend/src/components/PnlChart.tsx`

Line 98: `<div data-testid="pnl-chart" ...>` → add `data-point-count={snapshots.length}` for E2E.

---

### `test/docker-compose.test.yml` (config)

**Analog:** root `docker-compose.yml` (`name: finally`, `build: .`, `image: finally:latest`, `env_file .env`, `finally-data:/app/db`, healthcheck via `python -c "urllib.request.urlopen('http://localhost:8000/api/health')"`). Copy the healthcheck and `build` (context `..`), but MUST diverge: `name: finally-test`, `image: finally-test:latest`, no `env_file`, `tmpfs: [/app/db]`, explicit `LLM_MOCK: "true"`, `MASSIVE_API_KEY: ""`, `OPENROUTER_API_KEY: ""`, and the Playwright service `depends_on: app: condition: service_healthy`, `ipc: host`, `init: true`.

## Shared Patterns

### Error envelope
**Source:** `backend/app/errors.py:14-49`. All chat 400/502/503 go through `DomainError` subclasses; no per-route `JSONResponse`.

### Blocking I/O off the loop
**Source:** `backend/app/watchlist.py:51,61` (`await asyncio.to_thread(self._load_rows)`), `backend/app/main.py:67`. Applies to every chat DB call and the litellm call.

### Lock discipline
**Source:** `backend/app/main.py:55-57` comment: "asyncio.Lock is not reentrant: never call a lock-taking method while holding it." Chat never takes `state_lock`; services take it themselves.

### Router factory + registration order
**Source:** `backend/app/api/portfolio.py:28-30`, `backend/app/main.py:106-111`.

### Logging
`logger = logging.getLogger(__name__)`; `logger.info("Watchlist: added %s", ticker)` style → `"Chat: ..."`; never log the API key.

### Frontend: stores never import each other
**Source:** `Terminal.tsx` effect comment ("The stores never import each other; this effect is the only bridge") and `Header.tsx:78-79`. Cross-store effects live in components.

### Frontend API access
`apiFetch` / `ApiError` from `@/api/client` only; failure text via `failureMessage` (`portfolio.ts:22-24`).

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `test/package.json`, `test/playwright.config.ts` | E2E config | No Playwright project exists; use RESEARCH.md §Pitfalls 6-7 (workers 1, pin 1.64.1) |
| `test/Dockerfile` | E2E image | Only the app `Dockerfile` exists; FROM `mcr.microsoft.com/playwright:v1.64.1-noble` + `npm ci` |
| `test/e2e/*.spec.ts` | E2E tests | None yet; use testids audited in RESEARCH.md "Existing TST-04 hooks" |
| `backend/app/chat/llm.py` (litellm specifics) | external client | No LLM code; follow `.claude/skills/cerebras/SKILL.md` + RESEARCH.md code example |

## Metadata

**Analog search scope:** `backend/app/`, `backend/tests/`, `frontend/src/`, root `Dockerfile`, `docker-compose.yml`
**Files scanned:** ~20 read
**Pattern extraction date:** 2026-10-29
