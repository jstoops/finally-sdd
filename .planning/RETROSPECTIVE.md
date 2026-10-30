# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1 — MVP

**Shipped:** 2026-10-30
**Phases:** 3 | **Plans:** 19 | **Tasks:** 43 | **Commits:** 200 over 5 days

### What Was Built
- One-command container (Node 22 static export, Python 3.12 + uv, SQLite volume) with idempotent bash and PowerShell start/stop scripts
- Live market terminal: reconnecting SSE store, flashing watchlist with Chg % and sparklines, Lightweight Charts main chart seeded from history
- Correct-to-the-cent trading through one `TradeService` (single transaction under a shared lock, half-up Decimal math) plus a live client-side portfolio: header, positions, heatmap, P&L chart, trade history and reset
- AI copilot over LiteLLM → OpenRouter/Cerebras with strict structured output and `LLM_MOCK`, independent per-action execution through the same services, and templated failure notes
- Test pyramid: 577 backend, 347 frontend and 17 Playwright E2E tests, with E2E in its own container

### What Worked
- Vertical MVP slices: every phase ended with a working app at `localhost:8000`, so integration problems showed up early instead of at the end
- Freezing the PLAN §6/§8 contract as backend response models and `src/api/types.ts` with exact-key tests let backend and frontend plans run in parallel worktrees
- Shared invariants decided early (one `state_lock`, `TickerTracker.reconcile` as the only source caller, `DomainError` for every business failure) made the Phase 3 AI executor a thin layer over existing services
- Code review → disposition → gap-closure plans (for example 02-07) caught real defects: a 500 on a huge quantity, `true` buying a share, and reset racing a chat turn

### What Was Inefficient
- Later phases edited files that Phase 1 and 2 verifications cover, which left those reports stale at close and forced an override closeout
- Stale `finally:latest` images hid fixes during UAT twice (UAT 01 and UAT 02 test 5) because the start scripts don't rebuild automatically
- Review dispositions drifted: `02-REVIEW-DISPOSITION.md` still lists items that later plans closed
- Phase 3 Nyquist validation was never reconciled (`03-VALIDATION.md` is still a draft)

### Patterns Established
- `create_*_router(deps)` factories with dependencies built in `lifespan`; no module-level state
- Sequence guards on every frontend load that can race a newer mutation
- Exact pins for supply-chain-sensitive dependencies (`litellm==1.106.2`)
- `data-testid` and P&L-sign `data-*` hooks added as each panel is built, not retrofitted

### Key Lessons
1. Re-run the verifier for earlier phases (or run a final re-verify pass) when a later phase touches their covered files, so the milestone can close as verified rather than overridden.
2. Make start scripts rebuild when sources are newer than the image before relying on them for UAT.
3. Update review-disposition files in the same plan that closes an item.
4. Run `/gsd-validate-phase` before marking a phase complete, so Nyquist status doesn't lag.

### Cost Observations
- Model profile: quality (opus-heavy), with parallel worktree executors
- Notable: 19 plans in 5 days; most rework came from review findings, not from requirement misses (64/64 requirements met)

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1 | 3 | 19 | Vertical MVP slices, parallel worktrees, review → gap-closure loop |

### Cumulative Quality

| Milestone | Backend tests | Frontend tests | E2E tests |
|-----------|---------------|----------------|-----------|
| v1 | 577 | 347 | 17 |

### Top Lessons (Verified Across Milestones)

1. *(Needs a second milestone to cross-validate.)*
