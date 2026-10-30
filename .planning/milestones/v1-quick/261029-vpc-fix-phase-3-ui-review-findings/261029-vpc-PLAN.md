---
phase: 261029-vpc-fix-phase-3-ui-review-findings
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - frontend/src/domain/chart.ts
  - frontend/src/domain/chart.test.ts
  - frontend/src/components/PnlChart.tsx
  - frontend/src/components/PnlChart.test.tsx
  - frontend/src/components/ChatPanel.tsx
  - frontend/src/components/ChatPanel.test.tsx
  - frontend/src/components/TradeBar.tsx
  - frontend/src/components/Terminal.tsx
  - frontend/src/components/terminal.test.tsx
  - test/e2e/layout.spec.ts
autonomous: true
requirements: [UX-01, UX-02, PF-08, AI-12, TST-04]

estimate:
  tokens: 80000
  raw_tokens: 80000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "The P&L chart's line and fill colors come from the terminal's --color-up / --color-down tokens, read when the chart mounts; if a token cannot be read, the colors fall back to values identical to the tokens"
    - "No frontend component uses an arbitrary pixel text size: the chat chips, system rows, loading row, prompt chips and the Trades sub-heading use the existing text-xs scale"
    - "The chat collapse toggle measures at least 24x24 CSS px when the chat is expanded and when it is collapsed, and the expanded chat header stays the same height as the other panel headers"
    - "When the chat is collapsed at xl (>=1280px), the 2.75rem rail shows the 'AI Chat' heading as visible vertical text, not only the glyph"
    - "At 768x1024 the Heatmap/P&L pair and the Positions/Trade pair each stack into one full-width column (positions panel >= 480px wide); from 1024px up they sit side by side exactly as before, and 1440x900 still shows every panel without scrolling"
    - "Frontend unit tests, lint, typecheck, the static build and the Docker E2E suite all pass"
  artifacts:
    - path: frontend/src/domain/chart.ts
      provides: "PNL_TOKEN_FALLBACK, readColorToken, hexToRgba, pnlSeriesColors (pure helpers)"
      contains: "pnlSeriesColors"
    - path: frontend/src/components/PnlChart.tsx
      provides: "BaselineSeries colored from CSS tokens read in the mount effect"
      contains: "--color-up"
    - path: frontend/src/components/ChatPanel.tsx
      provides: "24px toggle, visible vertical rail heading (data-testid chat-title), text-xs everywhere"
      contains: "chat-title"
    - path: frontend/src/components/Terminal.tsx
      provides: "PANEL_PAIR / center-row class constants that stack the pairs below lg"
      contains: "lg:grid-cols-2"
    - path: test/e2e/layout.spec.ts
      provides: "Real-browser layout checks at 768x1024, 1024x768 and 1440x900 plus token and toggle checks, with screenshots attached"
      contains: "768"
  key_links:
    - from: frontend/src/components/PnlChart.tsx
      to: frontend/src/domain/chart.ts
      via: "pnlSeriesColors(up, down) spread into chart.addSeries(BaselineSeries, ...)"
      pattern: "pnlSeriesColors\\("
    - from: frontend/src/components/PnlChart.tsx
      to: frontend/src/app/globals.css
      via: "getComputedStyle(document.documentElement).getPropertyValue('--color-up' / '--color-down') inside the mount effect"
      pattern: "--color-down"
    - from: frontend/src/components/Terminal.tsx
      to: "Heatmap/PnlChart and PositionsTable/TradePanel wrappers"
      via: "one PANEL_PAIR literal class constant used by both pair wrappers"
      pattern: "PANEL_PAIR"
    - from: test/e2e/layout.spec.ts
      to: frontend/src/components/ChatPanel.tsx
      via: "data-testid chat-toggle and chat-title (TST-04 testid-only locators)"
      pattern: "chat-title"
---

<objective>
Fix the five Phase 3 UI review findings in `.planning/phases/03-ai-copilot-and-complete-terminal/03-UI-REVIEW.md` without changing any behavior or test hook other than those findings:

1. Typography: collapse the off-scale arbitrary pixel text sizes (four in `frontend/src/components/ChatPanel.tsx`, one in `frontend/src/components/TradeBar.tsx`) onto the existing `text-xs` scale.
2. Spacing/layout: the two fixed two-column panel pairs in `frontend/src/components/Terminal.tsx` (Heatmap/P&L, Positions/Trade) stack below the `lg` breakpoint so the positions table is not cramped at 768px.
3. Color: `frontend/src/components/PnlChart.tsx` reads the terminal's up/down CSS color tokens in its mount effect instead of hardcoding them.
4. Minor: the chat collapse toggle gets a touch target of at least 24px.
5. Minor: the collapsed xl chat rail shows a visible label (the "AI Chat" heading as vertical text).

Purpose: the terminal uses one type scale and one color source, and stays usable on a tablet (UX-02). Frontend unit tests and the Playwright E2E suite stay green.
Output: updated components and unit tests, plus a new `test/e2e/layout.spec.ts` that checks the layout in a real browser and attaches 768x1024 and 1024x768 screenshots to the Playwright report.

Coverage (source audit): finding 1 -> Task 2; finding 2 -> Task 3; finding 3 -> Task 1; finding 4 -> Task 2; finding 5 -> Task 2; "confirm with 768x1024 screenshots" -> Task 3; "keep unit tests and E2E green" -> Task 3 verify. Not in scope: the review notes that executed chips need no success cue, so that item is not planned. Not in scope: CHART_THEME / ChartPanel colors and the heatmap's pnlColor constants, because the review did not flag them.
</objective>

<execution_context>
@E:/Development/AI-Coding/finally-std/.claude/gsd-core/workflows/execute-plan.md
@E:/Development/AI-Coding/finally-std/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/03-ai-copilot-and-complete-terminal/03-UI-REVIEW.md
@frontend/CLAUDE.md
@frontend/src/app/globals.css
@frontend/src/domain/chart.ts
@frontend/src/components/PnlChart.tsx
@frontend/src/components/ChatPanel.tsx
@frontend/src/components/Terminal.tsx
@test/e2e/helpers.ts
@test/e2e/fresh-start.spec.ts

Facts observed at planning time (HEAD 821d14a):
- Tailwind v4 `@theme` in `frontend/src/app/globals.css` defines `--color-up` / `--color-down`. The existing static export (`frontend/out/_next/static/chunks/*.css`) emits both variables at `:root`, because the `text-up` / `text-down` utilities are used. No component reads CSS variables at runtime yet. `CHART_THEME` in `frontend/src/domain/chart.ts` and the heatmap RGB constants in `frontend/src/domain/portfolio.ts` hardcode the values instead.
- jsdom (`frontend` vitest env) resolves custom properties through `getComputedStyle(document.documentElement).getPropertyValue(...)` from both stylesheet rules and inline `style.setProperty`. Unset properties return `""`, and the vitest run does not load `globals.css`.
- Layout breakpoints in `Terminal.tsx`: `md` (768px) gives watchlist 240px | center, with the chat stacked under the center column and a scrolling page. `xl` (1280px) gives the 3-column grid with h-screen and the chat rail. At 768px each half of a fixed pair is about 250px wide. At 1024px it is about 386px, and at the accepted 1280px xl layout it is about 324px.
- E2E (`test/playwright.config.ts`) defaults to a 1440x900 viewport. `fresh-start.spec.ts` asserts that every panel is in the viewport and the page does not scroll at 1440x900. Per `test/e2e/helpers.ts`, E2E locates elements only by `data-testid` / `data-*` (TST-04).
- No unit or E2E test asserts the arbitrary text-size classes, the pair wrapper classes or the P&L colors. `terminal.test.tsx` asserts the xl `grid-cols-[...]` strings on `<main>`, and those stay unchanged.
- Gate baselines at HEAD: 5 arbitrary px text sizes in non-test `.tsx` files, 6 hardcoded green/red color strings in `PnlChart.tsx`, 2 fixed pair wrappers in `Terminal.tsx`, 0 `lg:grid-cols-2`. `npm --prefix frontend test` reports 328 passed in about 6s. Docker 29.8.0 is installed and the daemon responds.
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: P&L chart colors from the terminal's up/down tokens (CSS token -> build -> mount effect -> series)</name>
  <files>frontend/src/domain/chart.ts, frontend/src/domain/chart.test.ts, frontend/src/components/PnlChart.tsx, frontend/src/components/PnlChart.test.tsx</files>
  <read_first>frontend/src/app/globals.css, frontend/src/domain/chart.ts, frontend/src/components/PnlChart.tsx, frontend/src/components/PnlChart.test.tsx (the hoisted Lightweight Charts fake), frontend/CLAUDE.md (browser APIs only inside effects)</read_first>
  <behavior>
    - readColorToken({ getPropertyValue: () => " #00ff00 " }, "--color-up", fb) returns "#00ff00" (trimmed)
    - readColorToken returns the fallback for "", whitespace only, and non-hex values such as "red" or "oklch(0.7 0.2 150)"
    - readColorToken accepts 3-digit hex ("#0f0") as written
    - hexToRgba("#00ff00", 0.28) returns "rgba(0,255,0,0.28)"; hexToRgba("#0f0", 0.05) returns "rgba(0,255,0,0.05)" (no spaces, matching the current option string format)
    - pnlSeriesColors(up, down) returns exactly six keys: topLineColor = up, topFillColor1 = up at 0.28, topFillColor2 = up at 0.05, bottomLineColor = down, bottomFillColor1 = down at 0.05, bottomFillColor2 = down at 0.28
    - pnlSeriesColors(PNL_TOKEN_FALLBACK.up, PNL_TOKEN_FALLBACK.down) produces the same six strings PnlChart passes today, so the default look does not change
    - PnlChart test: with document.documentElement.style.setProperty("--color-up", "#00ff00") and ("--color-down", "#ff0000"), the addSeries options carry topLineColor "#00ff00", bottomLineColor "#ff0000" and the derived rgba fills; baseValue stays { type: "price", price: 10000 }
    - PnlChart test: with no tokens set (jsdom default), the addSeries options equal pnlSeriesColors(PNL_TOKEN_FALLBACK.up, PNL_TOKEN_FALLBACK.down)
  </behavior>
  <action>
Implements review finding 3 (Color pillar). Write the failing tests first (RED), then implement (GREEN).

In frontend/src/domain/chart.ts (pure module with no DOM access; keep the existing exports unchanged) add:
- `PNL_TOKEN_FALLBACK` (as const, keys `up` and `down`). Set its values to the exact `--color-up` / `--color-down` values copied from frontend/src/app/globals.css. Add a one-line comment saying they mirror those tokens and are used only when a variable cannot be read (unit tests, or a stylesheet without the token).
- `readColorToken(style: Pick<CSSStyleDeclaration, "getPropertyValue">, name: string, fallback: string): string`. It trims the value and returns it only if it is a 3- or 6-digit hex color (`/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i`); otherwise it returns `fallback`. Hex-only validation keeps the fill derivation below well-defined.
- `hexToRgba(hex: string, alpha: number): string`. It expands 3-digit hex and returns `rgba(r,g,b,a)` with no spaces.
- `pnlSeriesColors(up: string, down: string)`. It returns the six BaselineSeries color options with the alphas listed in the behavior block: top line/fills from `up` at 0.28 then 0.05, bottom line/fills from `down` at 0.05 then 0.28. Type the return value as `Pick<BaselineStyleOptions, ...>` from lightweight-charts, or as an explicit object of six strings.

In frontend/src/components/PnlChart.tsx, inside the existing create-once mount effect (the only place that may touch browser APIs, per frontend/CLAUDE.md, because the export prerenders the page): read `getComputedStyle(document.documentElement)` once, resolve `up` / `down` with `readColorToken(style, "--color-up", PNL_TOKEN_FALLBACK.up)` and the matching call for `--color-down`, then spread `...pnlSeriesColors(up, down)` into the `chart.addSeries(BaselineSeries, {...})` options. These six options replace the hardcoded green/red hex line colors and rgba fill strings now on lines 56-61. Keep `baseValue`, `lineWidth: 2` and `priceLineVisible: false` unchanged. Update the file header comment to say the series uses the terminal's up/down color tokens above and below the starting cash. Do not write any hex or rgba color literal into PnlChart.tsx, including in comments, because the verify gate greps that file for them. Do not change CHART_THEME, ChartPanel or the heatmap color helpers (out of scope).

Tests: add `describe` blocks for the three helpers in frontend/src/domain/chart.test.ts. In frontend/src/components/PnlChart.test.tsx, add the two token tests from the behavior block, reading the options from `lw.chart.addSeries.mock.calls[0]`. Set tokens with `document.documentElement.style.setProperty(...)` and always remove them in `afterEach` (`removeProperty` for both names) so other tests stay isolated.
  </action>
  <verify>
    <automated>npm --prefix frontend test -- src/domain/chart.test.ts src/components/PnlChart.test.tsx && ! grep -nE '#22c55e|#ef4444|rgba\(34,197,94|rgba\(239,68,68' frontend/src/components/PnlChart.tsx && npm --prefix frontend run build && grep -l -- '--color-up:' frontend/out/_next/static/chunks/*.css && grep -l -- '--color-down:' frontend/out/_next/static/chunks/*.css</automated>
  </verify>
  <done>The helper and PnlChart tests pass, including both token tests. PnlChart.tsx contains no green/red color literals (6 at HEAD, 0 now). The static export builds and its CSS still defines --color-up and --color-down, so the token path from globals.css through the build to the mount effect works.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: One type scale, a 24px chat toggle and a visible vertical label on the collapsed xl rail</name>
  <files>frontend/src/components/ChatPanel.tsx, frontend/src/components/TradeBar.tsx, frontend/src/components/ChatPanel.test.tsx</files>
  <read_first>frontend/src/components/ChatPanel.tsx (Chip ~L69, EntryRow ~L128, header/toggle L199-225, loading row ~L243, prompt chips ~L257), frontend/src/components/TradeBar.tsx (TradePanel ~L167-185), frontend/src/components/ChatPanel.test.tsx (the "collapse" describe ~L582)</read_first>
  <behavior>
    - A failed and an executed action chip, a system/error row (chat-system), the loading row (chat-loading) and every prompt chip (chat-prompt) have class text-xs
    - chat-toggle has classes h-6 and min-w-6 when expanded and when collapsed, and keeps type="button", aria-expanded, aria-controls and the aria-labels unchanged
    - The heading has data-testid="chat-title" and text "AI Chat" in both states. Collapsed, it has class xl:[writing-mode:vertical-rl] and not xl:sr-only. Expanded, it has neither
  </behavior>
  <action>
Implements review findings 1 (Typography), 4 (touch target) and 5 (rail label).

Finding 1: in frontend/src/components/ChatPanel.tsx, replace each of the four bracketed 11px arbitrary size utilities (Chip `li`, EntryRow system `li`, the "FinAlly is thinking…" loading `li`, the prompt-chip `button`) with `text-xs`. In frontend/src/components/TradeBar.tsx, replace the bracketed 10px size on the "Trades" `h3` with `text-xs`. Claude's discretion, recorded here: reuse the existing `text-xs` (12px) instead of defining a new 2xs token. The terminal otherwise uses only text-xs and text-sm, and a new token would keep the extra small size the review flagged. The Trades sub-heading stays distinct through its border-y and tighter padding. Do not change any other classes on these elements.

Finding 4: give the `chat-toggle` button `inline-flex h-6 min-w-6 items-center justify-center` (a 24x24px minimum box) and keep its existing classes. The expanded header row has `py-1`, so add `-my-1` to the toggle. The header then stays the same height as the other panels' headers, and the xl top row's borders stay aligned. In the collapsed branch, next to the existing `xl:mx-auto`, add `xl:my-0` so the negative margin does not apply in the vertical rail.

Finding 5: the collapsed xl rail now hides the heading with a screen-reader-only utility. Change the collapsed classes on the `h2` to `xl:order-last xl:[writing-mode:vertical-rl]`. The rail then shows the « toggle at the top and the "AI Chat" heading below it as visible vertical text, using one heading element, so no duplicate accessible text is added. Add `data-testid="chat-title"` to that `h2` (TST-04 hook for E2E). Below xl, the collapsed chat is still its normal horizontal header row, so all new classes stay `xl:`-scoped.

Tests (frontend/src/components/ChatPanel.test.tsx): add assertions for the behavior block. Reuse the file's existing fixtures and helpers for rendering a reply with executed and failed actions, an error row, the pending state and the empty-state prompts. Extend the "collapse" describe with the toggle-size and chat-title assertions. jsdom has no media queries, so these are class assertions. Task 3's E2E checks real geometry.
  </action>
  <verify>
    <automated>npm --prefix frontend test -- src/components/ChatPanel.test.tsx src/components/TradeBar.test.tsx src/components/terminal.test.tsx && ! grep -rnE 'text-\[[0-9]+px\]' frontend/src --include=*.tsx --exclude=*.test.tsx</automated>
  </verify>
  <done>The ChatPanel, TradeBar and terminal tests pass. No non-test component uses an arbitrary pixel text size (5 at HEAD, 0 now). The toggle carries the 24px sizing classes in both states, and the collapsed heading is visible vertical text at xl with data-testid chat-title.</done>
</task>

<task type="auto">
  <name>Task 3: Stack the panel pairs below lg, add the real-browser layout E2E, run the full suite</name>
  <files>frontend/src/components/Terminal.tsx, frontend/src/components/terminal.test.tsx, test/e2e/layout.spec.ts</files>
  <read_first>frontend/src/components/Terminal.tsx (layout comment L3-8, class constants L25-31, center grid L81-91), frontend/src/components/terminal.test.tsx (the "collapses and expands the chat column" test ~L616), test/e2e/helpers.ts (freshApp), test/e2e/fresh-start.spec.ts, test/playwright.config.ts</read_first>
  <precondition>The Docker daemon is running: `docker info` exits 0 (it did at planning time, server 29.8.0).</precondition>
  <action>
Implements review finding 2 (Spacing) and its "confirm with 768x1024 screenshots" note.

Breakpoint choice (Claude's discretion, recorded): the pairs stack below `lg` (1024px), not below `md`. `md` starts at 768px, so an md breakpoint would keep the cramped pair at the 768px width the review measured. At 1024px each half is about 386px, wider than the about 324px halves of the accepted 1280px xl layout, so stacking from 1024 up to xl is unnecessary.

In frontend/src/components/Terminal.tsx, next to the existing GRID_*/CHAT_* constants (Tailwind only generates complete literal class strings), add two constants and use them:
- `PANEL_PAIR` = `grid min-h-0 grid-cols-1 auto-rows-[minmax(12rem,auto)] gap-1 lg:auto-rows-auto lg:grid-cols-2`. Use it for both pair wrappers (Heatmap/PnlChart and PositionsTable/TradePanel), replacing the two fixed two-column wrappers on lines 83 and 87. Below lg each stacked panel gets a 12rem floor and grows with its content. From lg up the result is exactly the current two-column grid with auto rows.
- `CENTER_ROWS` = `grid min-h-0 gap-1 grid-rows-[minmax(18rem,auto)_auto_auto] lg:grid-rows-[minmax(16rem,50fr)_minmax(10rem,25fr)_minmax(12rem,25fr)] xl:grid-rows-[50fr_25fr_25fr]`. Use it for the center column div on line 81. Rationale: below xl the page scrolls, so the container height is indefinite. With fr rows, all flexible tracks share one fr size, and stacked pairs would push the chart row to twice the tallest pair (several hundred px). Content-sized rows below lg keep the chart at an 18rem floor. At lg the template is the current one, and at xl it is unchanged.
- Update the layout comment block (lines 3-8) with one line: below lg, the Heatmap/P&L and Positions/Trade pairs stack into one column.
Do not change GRID_EXPANDED, GRID_COLLAPSED, CHAT_EXPANDED or CHAT_COLLAPSED. terminal.test.tsx and the 1440x900 E2E depend on them.

In frontend/src/components/terminal.test.tsx, add a test "stacks the panel pairs below lg and sets them side by side from lg". It checks that panel-heatmap and panel-pnl share a parent, that panel-positions and panel-trade share a parent, and that each parent has classes `grid-cols-1` and `lg:grid-cols-2` and does not have the bare token `grid-cols-2`.

Create test/e2e/layout.spec.ts. Locate elements only by data-testid (TST-04, as stated in helpers.ts) and start every test with `freshApp(page, request)`. Read geometry with `locator.boundingBox()`, and use a 1px tolerance on edge comparisons.
- describe "768x1024" with `test.use({ viewport: { width: 768, height: 1024 } })`: the top of panel-pnl is at or below the bottom of panel-heatmap, and the top of panel-trade is at or below the bottom of panel-positions. panel-positions is at least 480px wide. Each of panel-heatmap, panel-pnl, panel-positions and panel-trade is at least 180px tall, and panel-chart is at least 250px tall. Attach `page.screenshot({ fullPage: true })` as "layout-768x1024" via `testInfo.attach` (image/png).
- describe "1024x768": panel-heatmap and panel-pnl share a top edge (within 1px) and panel-pnl starts at or right of the right edge of panel-heatmap. The same holds for panel-positions and panel-trade. Attach a "layout-1024x768" full-page screenshot.
- default 1440x900 viewport: (a) the chat-toggle box is at least 23.5px wide and tall when expanded and again after one click (collapsed). (b) Collapsed, the chat-title box is taller than it is wide and at least 40px tall, and lies inside the panel-chat box. (c) In the page, `getComputedStyle(document.documentElement).getPropertyValue` for "--color-up" and "--color-down", trimmed, each match `/^#[0-9a-f]{6}$/i`. This shows the tokens that PnlChart reads (Task 1) exist in the production export.

Then run the full gate below. If an existing unit or E2E test fails only because of a class or geometry change this plan makes, update that test and record it in the SUMMARY. Do not weaken unrelated assertions.
  </action>
  <verify>
    <automated>npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend run build && ! grep -n 'grid min-h-0 grid-cols-2 gap-1' frontend/src/components/Terminal.tsx && grep -q 'lg:grid-cols-2' frontend/src/components/Terminal.tsx && (docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright; status=$?; docker compose -f test/docker-compose.test.yml down -v; exit $status)</automated>
    <human-check>At end of phase, open test/playwright-report/index.html, open the layout spec and view the "layout-768x1024" attachment. The Heatmap, P&L, Positions and Trade panels are each full width of the center column and stacked, and the positions table columns are readable.</human-check>
  </verify>
  <done>Unit tests (328 at baseline plus the new ones), lint, typecheck and build pass. Terminal.tsx has no fixed two-column pair wrapper (2 at HEAD, 0 now) and uses lg:grid-cols-2. The Docker E2E suite exits 0, including the new layout spec at 768x1024, 1024x768 and 1440x900 and the existing 1440x900 fit check in fresh-start.spec.ts.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| app stylesheet -> chart options | PnlChart reads CSS custom properties from the app's own same-origin stylesheet and passes them to Lightweight Charts. No user or network input reaches these values. |
| E2E runner -> app under test | The new layout spec POSTs /api/reset, so it must only ever run against the throwaway compose app |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-261029-vpc-01 | Tampering | readColorToken / PnlChart mount effect | low | mitigate | Only 3- or 6-digit hex values are accepted, and anything else falls back to PNL_TOKEN_FALLBACK. An unexpected or malformed token can't produce a malformed color string for the chart (unit-tested in Task 1). |
| T-261029-vpc-02 | Tampering | test/e2e/layout.spec.ts | low | mitigate | Every test uses freshApp (reset) and runs only through test/docker-compose.test.yml, whose BASE_URL guard in playwright.config.ts refuses to run without the throwaway app. The database is a tmpfs volume, so no real portfolio can be wiped. |
| T-261029-vpc-03 | Information Disclosure | Playwright screenshot attachments | low | accept | The screenshots show only seeded mock data from a throwaway LLM_MOCK app with no API keys. playwright-report/ is a local test artifact. |
| T-261029-vpc-04 | Tampering (XSS) | ChatPanel heading/chips class changes | low | mitigate | Only className strings and one data-testid change. Chat content keeps rendering as plain React text with no HTML injection path. The existing ChatPanel plain-text tests stay green in Task 2's verify. |
| T-261029-vpc-SC | Tampering | npm/pip/cargo installs | low | accept | No packages are added or upgraded. package.json and lockfiles in frontend/ and test/ are unchanged, so the package-legitimacy gate does not apply. |
</threat_model>

<verification>
- `npm --prefix frontend test && npm --prefix frontend run lint && npm --prefix frontend run typecheck && npm --prefix frontend run build` pass
- Negative gates (all failing at HEAD, passing after): no arbitrary pixel text sizes in non-test `.tsx`; no green/red color literals in `frontend/src/components/PnlChart.tsx`; no fixed two-column pair wrapper in `frontend/src/components/Terminal.tsx`
- `docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright` exits 0, followed by `down -v`
- Built CSS in `frontend/out/_next/static/chunks/*.css` still defines `--color-up` and `--color-down`
</verification>

<success_criteria>
- All five UI-review findings are fixed as specified, with no other visual or behavioral changes at lg/xl widths
- The P&L chart's colors follow the CSS tokens. Changing `--color-up`/`--color-down` in globals.css alone recolors the chart
- At 768x1024 the positions table spans the full center column (>= 480px), verified in a real browser with a screenshot attached to the report
- Unit tests, lint, typecheck, build and E2E are all green
</success_criteria>

<output>
Create `.planning/quick/261029-vpc-fix-phase-3-ui-review-findings/261029-vpc-SUMMARY.md` when done
</output>
