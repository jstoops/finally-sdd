---
phase: 01-live-market-terminal
plan: 01
subsystem: infra
tags: [fastapi, starlette, uv, python-3.12, nextjs, tailwind, static-export, vitest]

requires: []
provides:
  - "Backend locked on FastAPI 0.162.0 / Starlette 1.10.0 / uvicorn 0.54.0 / python-dotenv 1.2.4, Python 3.12 pinned"
  - "frontend/ Next.js 16.4.3 static-export project with every Phase 1 npm dependency installed"
  - "Tailwind 4 @theme tokens (bg, panel, border, muted, text, accent, primary, submit, up, down) and flash-up/flash-down 500ms classes"
  - "npm scripts dev, build, lint, typecheck (tsc --noEmit), test (vitest run)"
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07]

actuals:
  tokens: 88800    # chars/4 over the full realized diff (355234 chars); ~2100 excluding uv.lock and package-lock.json
  tasks: 3
  commits: 2
plan_head_before: 243841880f7f004d85a9389ec885d56a28464dca
plan_head_after: 3e41aca231709901bed00e565079ef1bc47e0ff7

tech-stack:
  added: [fastapi 0.162.0, starlette 1.10.0, uvicorn 0.54.0, python-dotenv 1.2.4, next 16.4.3, react 19.3.0, tailwindcss 4.3.3, "@tailwindcss/postcss 4.3.3", lightweight-charts 5.2.1, zustand 5.0.16, vitest 5.0.5, vite 8.3.5, "@vitejs/plugin-react 6.1.2", jsdom 30.1.3, "@testing-library/*", typescript 5.9.3]
  patterns:
    - "Theme colors defined once as Tailwind @theme tokens in globals.css; components use bg-bg, bg-panel, text-accent, etc."
    - "Price flash via CSS keyframe classes .flash-up/.flash-down (500ms), restarted by remount"
    - "System font stacks only; no network font loader"

key-files:
  created:
    - backend/.python-version
    - frontend/package.json
    - frontend/package-lock.json
    - frontend/next.config.ts
    - frontend/postcss.config.mjs
    - frontend/src/app/globals.css
    - frontend/src/app/layout.tsx
    - frontend/src/app/page.tsx
    - frontend/tsconfig.json
    - frontend/eslint.config.mjs
    - frontend/.gitignore
    - frontend/AGENTS.md
  modified:
    - backend/pyproject.toml
    - backend/uv.lock

key-decisions:
  - "D-16 bump kept (no revert): all 139 market tests pass on FastAPI 0.162.0 / Starlette 1.10.0 without touching backend/app"
  - "pytest filterwarnings uses the exact backticked Starlette message (`httpx`, `starlette.testclient`); the plan's unbackticked text did not match"
  - "Tailwind 4 via @tailwindcss/postcss; @tailwindcss/turbopack uninstalled"

patterns-established:
  - "frontend/package.json and lockfiles are owned by 01-01; later Phase 1 plans import packages but never run npm install"
  - "npm run build, lint and typecheck are per-plan gates for frontend work"

requirements-completed: [UX-01]

coverage:
  - id: D1
    description: "Backend runs on FastAPI >= 0.135 / Starlette 1.x / Python 3.12 with all 139 market tests green"
    verification:
      - kind: unit
        ref: "uv run --directory backend --extra dev pytest -q tests/market"
        status: pass
      - kind: other
        ref: "grep -A1 'name = \"starlette\"' backend/uv.lock | grep -E 'version = \"1\\.'"
        status: pass
      - kind: other
        ref: "uv run --directory backend --extra dev python -c \"import sys; assert sys.version_info[:2] == (3, 12)\""
        status: pass
      - kind: other
        ref: "uv run --directory backend --extra dev ruff check app tests"
        status: pass
    human_judgment: false
  - id: D2
    description: "Next.js 16 static export builds frontend/out/index.html and 404.html; lint and typecheck pass; all Phase 1 npm dependencies present"
    verification:
      - kind: other
        ref: "npm --prefix frontend run build && test -f frontend/out/index.html && test -f frontend/out/404.html"
        status: pass
      - kind: other
        ref: "npm --prefix frontend run lint && npm --prefix frontend run typecheck"
        status: pass
      - kind: other
        ref: "node package.json dependency/engines/scripts check from plan Task 3 verify"
        status: pass
    human_judgment: false
  - id: D3
    description: "Dark theme tokens and flash keyframes in globals.css; no pure-black color or Google font loader under frontend/src"
    requirement: "UX-01"
    verification:
      - kind: other
        ref: "grep checks for output: \"export\", @tailwindcss/postcss, --color-bg: #0d1117, flash-up, !.env.development"
        status: pass
      - kind: other
        ref: "! grep -rniE \"#000\\b|#000000|bg-black|next/font/google\" frontend/src"
        status: pass
    human_judgment: false
  - id: D4
    description: "Built page visually shows the FinAlly wordmark in accent yellow on the #0d1117 background"
    requirement: "UX-01"
    verification:
      - kind: other
        ref: "grep FinAlly frontend/out/index.html; built CSS contains ecad0a"
        status: pass
    human_judgment: true
    rationale: "Visual appearance of the dark theme is a judgment call; verify at end-of-phase UAT once the app is served"

duration: 5min
completed: 2026-10-27
status: complete
---

# Phase 1 Plan 01: Toolchain Wave 0 Summary

**Backend locked on FastAPI 0.162 / Starlette 1.10 / Python 3.12 with 139 market tests green, plus a Next.js 16.4.3 static-export frontend on Tailwind 4 (PostCSS) with every Phase 1 dependency installed and the dark theme tokens in place**

## Performance

- **Duration:** about 5 min
- **Started:** 2026-10-27T07:34:18Z
- **Completed:** 2026-10-27T07:39:12Z
- **Tasks:** 3 (1 checkpoint already approved, 2 executed)
- **Files modified:** 14

## Accomplishments
- Task 1 (package and image legitimacy gate): the user replied "approved" to the full list with nothing dropped. The orchestrator confirmed every npm version resolves and the PyPI release pages return 200. Only listed packages were installed. `@tailwindcss/turbopack` came with the scaffold and was uninstalled. `vite-tsconfig-paths` was never installed.
- Backend bumped per D-16: fastapi 0.162.0, starlette 0.52.1 -> 1.10.0, uvicorn 0.40.0 -> 0.54.0, python-dotenv 1.2.4. Venv recreated on CPython 3.12.15. 139/139 tests pass and ruff is clean. `backend/app/` is unchanged.
- `frontend/` scaffolded with create-next-app 16.4.3 (`--no-cache-components`). Static export config, Tailwind 4 via PostCSS, engines `^22.22.0`, and scripts `dev`/`build`/`lint`/`typecheck`/`test`.
- `globals.css` defines all ten `--color-*` tokens plus `.flash-up`/`.flash-down` (500ms ease-out). `layout.tsx` uses system fonts. `page.tsx` renders `data-testid="app-shell"` with the accent-yellow FinAlly wordmark.
- `npm run build` writes `frontend/out/index.html` and `404.html`. Lint and typecheck exit 0. `node_modules`, `.next`, `out` and `next-env.d.ts` stay ignored.

## Task Commits

1. **Task 1: Package and image legitimacy gate**: no commit (verification only; user replied "approved")
2. **Task 2: Bump backend to FastAPI >= 0.135 on Starlette 1.x and pin Python 3.12**: `72b7f5c` (chore)
3. **Task 3: Scaffold Next.js 16 static-export frontend with all Phase 1 deps and dark theme**: `3e41aca` (feat)

## Files Created/Modified
- `backend/pyproject.toml`: `fastapi>=0.135`, `python-dotenv>=1.2`, pytest `filterwarnings` for the Starlette httpx deprecation
- `backend/uv.lock`: locked graph with Starlette 1.10.0
- `backend/.python-version`: `3.12`
- `frontend/package.json` / `package-lock.json`: all Phase 1 dependencies, engines, scripts
- `frontend/next.config.ts`: `output: "export"`, `images: { unoptimized: true }`
- `frontend/postcss.config.mjs`: `@tailwindcss/postcss`
- `frontend/src/app/globals.css`: theme tokens and flash keyframes
- `frontend/src/app/layout.tsx`: root layout, system fonts, metadata
- `frontend/src/app/page.tsx`: scaffold app shell with the wordmark
- `frontend/.gitignore`: scaffold rules plus `!.env.development`
- `frontend/AGENTS.md`, `tsconfig.json`, `eslint.config.mjs`: kept as generated

## Decisions Made
- Kept the D-16 bump. No market-subsystem change was needed.
- Left the npm-written caret ranges (`^4.3.3` and so on). `package-lock.json` pins the exact approved versions. React is 19.3.0 (the scaffold's exact pin), which falls within the approved 19.3.x.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] pytest filterwarnings text did not match the real Starlette message**
- **Found during:** Task 2
- **Issue:** The plan's filter `ignore:Using httpx with starlette.testclient` left the warning in place. The real message is ``Using `httpx` with `starlette.testclient` is deprecated…`` (with backticks).
- **Fix:** Used `ignore:Using `httpx` with `starlette.testclient`` (message-only, no category, as the plan intended).
- **Files modified:** backend/pyproject.toml
- **Verification:** `pytest -q tests/market` now prints `139 passed` with no warnings
- **Committed in:** 72b7f5c

**2. [Rule 1 - Bug] Explanatory comment tripped the Google-font grep gate**
- **Found during:** Task 3
- **Issue:** A comment in `layout.tsx` contained the literal `next/font/google`, so the plan's grep gate failed.
- **Fix:** Reworded the comment ("a Google-hosted font loader").
- **Files modified:** frontend/src/app/layout.tsx
- **Verification:** The grep gate prints nothing. Build, lint and typecheck re-run green.
- **Committed in:** 3e41aca

---

**Total deviations:** 2 auto-fixed (2 Rule 1)
**Impact on plan:** Both are small fixes so the plan's own gates pass. No scope change.

## Issues Encountered
- `uv lock --upgrade-package uvicorn` also upgraded the transitive `httptools` 0.7.1 -> 0.9.0 (a `uvicorn[standard]` extra already in the graph). It is a transitive upgrade of an existing dependency, not a new package.
- The first `uv add` resolved python-dotenv 1.2.1. The explicit upgrade step moved it to the approved 1.2.4.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness
- 01-02 (tracer) can build on Starlette 1.x lifespan-only APIs and the frontend toolchain. It replaces `page.tsx`.
- 01-03 writes `frontend/CLAUDE.md` and `frontend/.env.development` (already un-ignored), plus the Dockerfile that runs `npm ci` / `uv sync --locked` on these lockfiles.
- Vitest config and setup files are not created here. The first plan that adds frontend tests must add `vitest.config.mts` (`npm test` currently has no tests).

---
*Phase: 01-live-market-terminal*
*Completed: 2026-10-27*
