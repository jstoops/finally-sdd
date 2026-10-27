---
phase: "01"
slug: "live-market-terminal"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-27"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → FastAPI `/api/*` | Unauthenticated single-user REST and SSE on port 8000 | Ticker symbols (untrusted input), watchlist JSON, simulated prices |
| Host env / `.env` → backend | Settings loaded at startup | API keys (secret; never logged, never baked into the image) |
| Package registries → build | npm, PyPI and Docker Hub / GHCR artifacts | Third-party code (supply chain) |
| Host network → container | `8000:8000` published on all interfaces | Same as the API boundary; LAN-reachable by design (A2) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-SC | Tampering | npm/pip installs, base images | high | mitigate | User-approved legitimacy gate (01-01 T1, 2026-10-27); excluded packages absent from `frontend/package.json`; lockfiles unchanged since 01-01; Dockerfile uses `npm ci` and `uv sync --locked`; pinned base images | closed |
| T-01-01 | Tampering | lockfile integrity | medium | mitigate | `npm ci` and `uv sync --locked` in `Dockerfile` | closed |
| T-01-02 | Information disclosure | scaffold font loader | low | mitigate | No `next/font/google` under `frontend/src`; system font stack | closed |
| T-01-03 | Tampering | `app/db`, `app/watchlist.py` SQL | high | mitigate | All queries bind `?` parameters; no string-built SQL found | closed |
| T-01-04 | Information disclosure | `app/config.py`, logging | high | mitigate | `load_dotenv(override=False)`; no logging of environment values or keys | closed |
| T-01-05 | Information disclosure | CORS in `app/main.py` | medium | mitigate | `CORSMiddleware` only when `settings.dev_cors_origin` is set (`main.py:89`); `test_main.py` asserts no ACAO header by default | closed |
| T-01-06 | Information disclosure | static mount | low | mitigate | `StaticFiles(..., html=True)` mounted only when the export exists | closed |
| T-01-07 | Information disclosure | error responses | low | mitigate | Fixed `{"error": "Not found"}` envelope; no debug mode | closed |
| T-01-08 | Information disclosure | test imports | medium | mitigate | No module-level `app =` in `app/main.py` (factory only) | closed |
| T-01-09 | Information disclosure | Docker build context | high | mitigate | `.dockerignore` excludes `.env*` and `frontend/.env.development` | closed |
| T-01-10 | Elevation of privilege | port mapping 8000:8000 | medium | accept | See accepted risk AR-01; README documents LAN exposure and the `127.0.0.1:8000:8000` alternative | closed |
| T-01-11 | Elevation of privilege | container user (root) | low | accept | See accepted risk AR-02 | closed |
| T-01-12 | Tampering | start/stop scripts | low | mitigate | Negative grep: no volume removal, `Set-ExecutionPolicy` or `sudo` in `scripts/` | closed |
| T-01-13 | Information disclosure | static bundle | medium | mitigate | Dev API base only in `frontend/.env.development`; `frontend/out` contains no `localhost:8000` | closed |
| T-01-14 | Tampering | `normalize_ticker` | high | mitigate | ASCII check plus `^[A-Z][A-Z0-9.]{0,9}$` in `app/tickers.py` on body and path; 400 on violation (tested) | closed |
| T-01-15 | Denial of service | watchlist add / Cholesky rebuild | medium | mitigate | `WATCHLIST_CAP = 50` with `COUNT(*)` inside `db.transaction()` (BEGIN IMMEDIATE) under `state_lock` | closed |
| T-01-16 | Tampering | concurrent mutations | low | mitigate | Shared `state_lock` (`app.state.state_lock`); `UNIQUE (user_id, ticker)` in `schema.sql` | closed |
| T-01-17 | Tampering | watchlist SQL | high | mitigate | Bound parameters only; ticker normalized before SQL | closed |
| T-01-18 | Information disclosure | error responses | low | mitigate | Fixed `{"error": message}` envelope from the normalized ticker | closed |
| T-01-19 | Tampering | watchlist rows, header | medium | mitigate | No `dangerouslySetInnerHTML`/`innerHTML` anywhere in `frontend/src`; React text rendering | closed |
| T-01-20 | Denial of service | priceStream JSON parsing | low | mitigate | `JSON.parse` wrapped in try/catch; malformed frames dropped (tested) | closed |
| T-01-21 | Denial of service | reconnect loop | low | mitigate | Capped 1s/2s/5s backoff; cleanup clears pending timers | closed |
| T-01-22 | Tampering | history URL construction | low | mitigate | `encodeURIComponent(selected)` in `ChartPanel.tsx` | closed |
| T-01-23 | Denial of service | stale/out-of-order chart data | low | mitigate | Request-id guard and `isNewer` in `domain/chart.ts` | closed |
| T-01-24 | Tampering | client ticker validation | low | accept | See accepted risk AR-03 | closed |
| T-01-25 | Tampering | inline error rendering | low | mitigate | React text rendering; DELETE path uses `encodeURIComponent` (`store/watchlist.ts`) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-10 | Port published on all interfaces (user decision A2). Simulated money, no auth surface worth protecting, no secrets served over HTTP; README offers the loopback-only mapping | User (planning decision A2) | 2026-10-26 |
| AR-02 | T-01-11 | Single-user local container runs as root in `python:3.12-slim`; only the named `finally-data` volume is mounted | Plan 01-03 threat model | 2026-10-26 |
| AR-03 | T-01-24 | Client-side ticker validation is UX only; the server's `normalize_ticker` is authoritative | Plan 01-07 threat model | 2026-10-26 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-27 | 25 | 25 | 0 | secure-phase (orchestrator, L1 grep-depth; auditor skipped per short-circuit) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-27
