---
phase: "03"
slug: "ai-copilot-and-complete-terminal"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-29"
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → `POST /api/chat` | Untrusted message text, any length or encoding | Free text (capped at 2,000 code points) |
| LLM reply → parser and executor | Untrusted structured output (mock or remote model): any JSON, any types, any item count | Requested trades and watchlist changes |
| Executor → `TradeService` / `WatchlistService` | LLM-requested actions cross into money and watchlist mutations | Ticker, side, quantity, add/remove |
| Chat history → next prompt | Stored content replayed to the model | Message text plus a plain `[executed: ...]` summary |
| `ChatService` → SQLite | `chat_messages` reads and writes | Message content, actions JSON |
| Server → browser | Assistant content, action fields and error texts rendered in the chat panel | Text only |
| App → OpenRouter (HTTPS) | Prompt (portfolio context, history) and the API key leave the container | Simulated portfolio data, secret key |
| Process env → `Settings` | Secret key held in memory | `OPENROUTER_API_KEY` |
| Package registries → build | litellm, `@playwright/test`, Playwright image | Third-party code |
| E2E runner → app under test | Every test resets the account it points at | Reset/trade calls against a throwaway app |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Tampering | executor | high | mitigate | `backend/app/chat/actions.py` mutates only through `WatchlistService.add/remove` (l.111, l.114) and `TradeService.execute` (l.132) | closed |
| T-03-02 | Tampering | ChatPanel rendering | high | mitigate | No `dangerouslySetInnerHTML`/`innerHTML`/markdown renderer anywhere in `frontend/src`; content renders as React text nodes | closed |
| T-03-03 | Information disclosure | 502/503 bodies | medium | mitigate | Fixed texts `NOT_CONFIGURED`, `LLM_CALL_FAILED`, `LLM_BAD_REPLY` in `backend/app/chat/service.py:38-40`; logs carry `type(exc).__name__` only (`llm.py:138`) | closed |
| T-03-04 | Tampering | chat_messages SQL | high | mitigate | `service.py:126-128,152-153` use `?` parameters; `user_id` bound server-side | closed |
| T-03-05 | Tampering | parse_reply / execute_actions | high | mitigate | `StrictStr`/`StrictFloat` item models (`parsing.py:53-64`); non-finite numbers handled (`actions.py:165`); rules enforced by the services | closed |
| T-03-06 | Tampering | prompt history | medium | mitigate | History replays content plus `[executed: ...]` (`prompt.py:78`), never raw actions JSON | closed |
| T-03-07 | Denial of service | chat body and LLM output | medium | mitigate | `MAX_MESSAGE_CHARS = 2000` checked before storing (`service.py:44,82`); `MAX_TRADES`/`MAX_WATCHLIST_CHANGES = 10` (`actions.py:34-35,71,80`) | closed |
| T-03-08 | Tampering | prompt injection through user text | low | accept | See Accepted Risks (AR-03-01) | closed |
| T-03-09 | Tampering | chat_messages SQL | high | mitigate | Parameterized queries, `LIMIT ?` bound (`service.py:128`), `user_id` fixed server-side | closed |
| T-03-10 | Information disclosure | 502 body | medium | mitigate | Fixed `LLM_BAD_REPLY` / `LLM_CALL_FAILED` texts; raw reply never returned | closed |
| T-03-11 | Tampering | ChatPanel chips and bubbles | high | mitigate | Same as T-03-02: text nodes only, no raw-HTML sink | closed |
| T-03-12 | Tampering | reset during an in-flight chat | medium | mitigate | Exceeds plan: Reset disabled while chat is pending (`Header.tsx:88,113`), and since CR-01 fix 836898b `POST /api/reset` takes `chat_turn_lock` (`api/portfolio.py:69`), so the backend race is closed too (`TestResetDuringTurn`) | closed |
| T-03-13 | Denial of service | chat send | low | mitigate | One request in flight (`chat.ts` `pending` guard); 2,000 code-point pre-check (`chat.ts:15,27`) | closed |
| T-03-14 | Information disclosure | API key | high | mitigate | `field(default=None, repr=False)` (`config.py:53`); custom `__repr__` on the client (`llm.py:99`); logs/errors carry type names only | closed |
| T-03-15 | Information disclosure | provider errors | medium | mitigate | `LLMError(type(exc).__name__)` (`llm.py:139`); fixed `LLM_CALL_FAILED` to the client | closed |
| T-03-16 | Denial of service | event loop | medium | mitigate | `asyncio.to_thread` around the completion (`llm.py:118`) and history load (`service.py:88`) | closed |
| T-03-17 | Tampering | provider routing | medium | mitigate | `require_parameters: True`, `allow_fallbacks: False` (`llm.py:33`) | closed |
| T-03-18 | Information disclosure | import-time outbound fetch | low | mitigate | `LITELLM_LOCAL_MODEL_COST_MAP` set before import (`llm.py:110`) and in the Dockerfile ENV (l.27) | closed |
| T-03-19 | Denial of service | paid /api/chat on a LAN | medium | accept | See Accepted Risks (AR-03-02) | closed |
| T-03-20 | Tampering | E2E reset against real data | high | mitigate | `test/docker-compose.test.yml`: project `finally-test`, `tmpfs` DB, image `finally-test:latest`, no published app port; `BASE_URL` required (`playwright.config.ts:7-10`) | closed |
| T-03-21 | Information disclosure | real API key in test container | high | mitigate | No `env_file`; explicit empty `OPENROUTER_API_KEY`/`MASSIVE_API_KEY`; `LLM_MOCK: "true"` (compose l.24-26) | closed |
| T-03-SC | Tampering | npm/pip installs and images | high | mitigate | `litellm==1.106.2` pinned with uv.lock hashes, no 1.82.7/1.82.8 in the lock; `uv sync --locked` in Dockerfile; `@playwright/test` 1.64.1 and `playwright:v1.64.1-noble`; frontend package files unchanged since c1ccc90 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-08 | Single-user simulated account with fake money; every LLM-requested action still passes the server-side trade and watchlist rules; the model has no tools beyond trade and watchlist | Plan 03-02 threat model | 2026-10-29 |
| AR-03-02 | T-03-19 | No auth by design (PLAN §3); 2,000-character cap, one request in flight in the UI, and the README's LAN-exposure note from Phase 1 | Plan 03-04 threat model | 2026-10-29 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-29 | 22 | 22 | 0 | /gsd-secure-phase 03 (orchestrator, ASVS L1 grep-depth; auditor skipped per short-circuit rule) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-29
