@AGENTS.md

# FinAlly frontend

Next.js (TypeScript, Tailwind) built as a static export (`output: "export"`) and served by
FastAPI on port 8000. In production every request is same-origin: `/api/*` and
`/api/stream/prices`. The contract is `planning/PLAN.md` sections 6, 8 and 10.

## Dev loop

Two terminals:

1. Backend, from `backend/`:
   `DEV_CORS_ORIGIN=http://localhost:3000 uv run --extra dev uvicorn app.main:create_app --factory --reload --port 8000`
2. Frontend, from the repo root: `npm --prefix frontend run dev`, then open http://localhost:3000.

`next dev` loads `frontend/.env.development` (`NEXT_PUBLIC_API_BASE=http://localhost:8000`), so
REST calls and the EventSource go to uvicorn, and `DEV_CORS_ORIGIN` lets that origin through.
`next build` never reads `.env.development`, so the export keeps an empty API base.
Next.js rewrites are not used because static export does not support them.

Never create `frontend/.env.local`: `next build` reads it and would bake a dev API origin
into the production bundle.

## Conventions

- Read `NEXT_PUBLIC_API_BASE` only through `src/api/client.ts`, as a direct
  `process.env.NEXT_PUBLIC_API_BASE` property access, so Next inlines it at build time.
  Build URLs with `apiUrl()` and call the API with `apiFetch()`.
- Touch browser APIs (`EventSource`, `window`, `ResizeObserver`, Lightweight Charts) only
  inside effects. The export prerenders every page, so module or render scope breaks the build.
- Exactly one `EventSource` exists, owned by the prices store (`src/store/prices.ts`).
  Components read prices through store selectors; never open a second stream.
- No charting libraries besides Lightweight Charts. Sparklines are inline SVG polylines; the
  heatmap is positioned divs.
- No `next/font/google`: it downloads fonts during `next build`. Use the system font stacks.

## Testing

```bash
npm --prefix frontend test        # Vitest + Testing Library
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run build   # static export to frontend/out
```
