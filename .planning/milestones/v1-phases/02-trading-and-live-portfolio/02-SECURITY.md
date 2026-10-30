---
phase: "02"
slug: "trading-and-live-portfolio"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-28"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Browser → `POST /api/portfolio/trade` | Untrusted ticker, quantity and side from the trade bar (and, in Phase 3, the AI executor calling `TradeService.execute` directly) | Order parameters; no price, no user id |
| Browser → `POST /api/reset` | Any POST resets the simulated account (PLAN §8 contract, user decision U-1) | None (no body) |
| Server → Browser (REST + SSE) | Tickers, error text and fills rendered in the terminal | Simulated money values, regex-constrained tickers, fixed error strings |
| Build → runtime dependencies | npm / uv lockfiles | Third-party packages (unchanged this phase) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering | `TradeService.execute` quantity | high | mitigate | `math.isfinite` and `> 0` check before rounding in `backend/app/trading.py:123`; tests in `test_trading.py` | closed |
| T-02-02 | Tampering | parallel trades (overspend) | high | mitigate | `async with self._lock` (`trading.py:101`) around one `BEGIN IMMEDIATE` transaction (`db.transaction()`); 20-way parallel-buy test | closed |
| T-02-03 | Tampering | fill price | high | mitigate | `TradeRequest` has no price field; price read via `self._cache.get_price(ticker)` inside the lock (`trading.py:132`) | closed |
| T-02-04 | Tampering | trade SQL | high | mitigate | `normalize_ticker` allowlist before SQL (`trading.py:96`); all values bound with `?` parameters | closed |
| T-02-05 | Denial of service | lock re-entry deadlock | medium | mitigate | Snapshot written with `insert_snapshot(conn, …)` on the trade's own connection, never the lock-taking recorder | closed |
| T-02-06 | Information disclosure | error responses | low | mitigate | `DomainError` / `NotFoundError` render fixed `{"error": …}` text (`backend/app/errors.py`) | closed |
| T-02-07 | Elevation of privilege | user identity | low | mitigate | No request model carries `user_id`; services use `DEFAULT_USER_ID` | closed |
| T-02-08 | Tampering | heatmap labels, positions cells | low | mitigate | No `dangerouslySetInnerHTML` / `innerHTML` anywhere in `frontend/src`; tickers rendered as text nodes | closed |
| T-02-09 | Denial of service | Zustand selectors in PositionsTable / Heatmap | medium | mitigate | Raw-field selectors plus `useMemo` derivation in both components | closed |
| T-02-10 | Denial of service | `PortfolioService.list_trades` | low | mitigate | `LIMIT ?` bound to `TRADES_LIMIT = 100` (`backend/app/portfolio.py:18,85`) | closed |
| T-02-11 | Repudiation | trade confirmation and history | low | mitigate | Confirmation built from the recorded fill (`trade.quantity`, `trade.ticker`, `trade.price` in `TradeBar.tsx:94`) | closed |
| T-02-12 | Tampering | inline error and history rendering | low | mitigate | Server text and tickers rendered as React text nodes only | closed |
| T-02-13 | Tampering | `POST /api/reset` cross-site request | medium | accept | See Accepted Risks Log (AR-02-01) | closed |
| T-02-14 | Tampering | reset racing trades and watchlist edits | medium | mitigate | `PortfolioService.reset` holds `self._lock` and runs one `BEGIN IMMEDIATE` transaction (`portfolio.py:114,127`); concurrency test | closed |
| T-02-15 | Denial of service | `GET /api/portfolio/history` growth | low | accept | See Accepted Risks Log (AR-02-02) | closed |
| T-02-16 | Tampering | accidental reset from the UI | low | mitigate | `window.confirm(RESET_CONFIRM)` in the click handler; cancel sends nothing (header test) | closed |
| T-02-17 | Denial of service | Zustand selectors in Header / Terminal | medium | mitigate | Raw-field selectors plus `useMemo` in `Header.tsx` | closed |
| T-02-SC | Tampering | npm / pip installs | high | mitigate | `git diff --quiet 245a40c -- backend/pyproject.toml backend/uv.lock frontend/package.json frontend/package-lock.json` is clean after all six plans | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-13 | User decision U-1 keeps the PLAN §8 contract: any POST to `/api/reset` resets, with no body or header precondition, so a cross-site form POST can reset the account. Money is simulated, the app is a single local user with no login, and the impact is limited to losing demo state. | User (decision U-1, Phase 2 planning) | 2026-10-27 |
| AR-02-02 | T-02-15 | PLAN §7 says snapshots are never pruned (about 2,900 rows a day). Single local user; the history payload stays small for a demo session. | Plan (PLAN §7) | 2026-10-27 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-28 | 18 | 18 | 0 | secure-phase (L1 grep verification, orchestrator) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-28
