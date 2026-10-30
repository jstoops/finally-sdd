# Phase 1: Live Market Terminal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-26
**Phase:** 01-live-market-terminal
**Areas discussed:** Screen layout, Watchlist add/remove UX, Main chart presentation, Dev loop & start scripts

---

## Screen layout

| Option | Description | Selected |
|--------|-------------|----------|
| Full grid, placeholders | Final grid now; unbuilt panels as dimmed "Coming soon" slots | ✓ |
| Grow per phase | Phase 1 shows only header, watchlist and a large chart; re-flow later | |
| Full grid, empty slots | Final grid with blank bordered panels, no labels | |

| Option | Description | Selected |
|--------|-------------|----------|
| Logo + status dot only | Header values and Reset arrive in Phase 2 | ✓ |
| All slots, placeholder values | Total/Cash `$—` and a disabled Reset now | |

| Option | Description | Selected |
|--------|-------------|----------|
| One compact line | Ticker · price · Chg % · sparkline, ~28px | ✓ |
| Two-line rows | Larger, scrolls sooner | |

| Option | Description | Selected |
|--------|-------------|----------|
| Blue left bar + tint | 2px #209dd7 border + tint | ✓ |
| Yellow left bar + tint | #ecad0a variant | |
| You decide | Leave to UI phase | |

**User's choice:** All recommended options.

---

## Watchlist add/remove UX

| Option | Description | Selected |
|--------|-------------|----------|
| Pinned at panel top | Input + `+` under the title | ✓ |
| Pinned at panel bottom | Under the list | |
| '+' icon opens inline input | Hidden until clicked | |

| Option | Description | Selected |
|--------|-------------|----------|
| × on row hover | Hover/focus, visible on touch, no confirm | ✓ |
| Always-visible × | Simpler, noisier | |

| Option | Description | Selected |
|--------|-------------|----------|
| Inline under input | Red text, clears on next keystroke | ✓ |
| Toast | Transient corner toast | |

| Option | Description | Selected |
|--------|-------------|----------|
| Normalize only, server validates | Single source of truth on server | |
| Mirror regex client-side | Block malformed symbols before request | ✓ |

**User's choice:** Recommended for placement, remove and errors. Chose to mirror the regex client-side instead of the recommended server-only validation.
**Notes:** The server still validates. The cap error and other 400s come from the server.

---

## Main chart presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Area with gradient | Blue line + fading fill | ✓ |
| Plain line | Minimal blue line | |
| Line colored by session move | Green/red vs open | |

| Option | Description | Selected |
|--------|-------------|----------|
| Ticker · price · Chg % | Live header | ✓ |
| Ticker only | Minimal | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, dashed price line | "Open" reference line | ✓ |
| No | Clean chart | |

| Option | Description | Selected |
|--------|-------------|----------|
| Centered muted message | Loading / empty / waiting text | ✓ |
| You decide | Leave to UI phase | |

**User's choice:** All recommended options.

---

## Dev loop & start scripts

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-in CORS + API base | `next dev` + `NEXT_PUBLIC_API_BASE` + `DEV_CORS_ORIGIN` | ✓ |
| Build export, FastAPI serves it | Production path, no hot reload | |
| Both, documented | Support both | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, after health is OK | Wait for /api/health, open browser, `--no-open` | ✓ |
| Print URL only | No auto-open | |

| Option | Description | Selected |
|--------|-------------|----------|
| Copy .env.example, warn | Create .env, note about OPENROUTER_API_KEY | ✓ |
| Tolerate missing file | compose `required: false` only | |

| Option | Description | Selected |
|--------|-------------|----------|
| Bump now, re-run 139 tests | FastAPI >=0.135 / Starlette 1.x | ✓ |
| Stay on locked 0.128.7 | No upgrade risk | |

**User's choice:** All recommended options.

---

## Claude's Discretion

- Grid proportions and placeholder styling
- Sparkline window, color and stroke
- Connection-dot tooltip
- Chart time window, crosshair, price-scale formatting
- Duplicate-add feedback

## Deferred Ideas

None.
