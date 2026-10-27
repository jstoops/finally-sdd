# FinAlly — AI Trading Workstation

An AI-powered trading terminal: live streaming prices, a simulated $10,000 portfolio, and an LLM copilot that analyzes positions and executes trades through chat. Built entirely by coding agents.

> **Status:** the live market terminal is in progress: streaming watchlist, container, and start/stop scripts. Trading, the portfolio views and AI chat are still to be built. See [`planning/PLAN.md`](planning/PLAN.md) for the full spec.

## Quick start

You need Docker (Docker Desktop on macOS and Windows). One command builds the image on first run, starts the container, waits until it is healthy and opens http://localhost:8000.

macOS / Linux:

```bash
./scripts/start_mac.sh
./scripts/stop_mac.sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start_windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\stop_windows.ps1
```

`-ExecutionPolicy Bypass` applies to that one invocation only. The scripts never change your execution policy or any other system setting.

- `--build` rebuilds the image (after pulling new code). The Windows script also accepts `-Build`.
- `--no-open` skips opening the browser. The Windows script also accepts `-NoOpen`.
- On first run the start script copies `.env.example` to `.env`. The market simulator needs no keys; AI chat needs `OPENROUTER_API_KEY` in `.env`.
- Both scripts are safe to run more than once. If the app is not healthy within 60 seconds, the start script prints the last 50 log lines and exits with an error.
- Your data (watchlist, and later positions and chat) lives in the `finally-data` Docker volume. The stop scripts keep it. Only `docker volume rm finally-data` deletes it.

Without the scripts: `docker compose up -d --build --wait`, then `docker compose down`.

## Security note

FinAlly has no login. The `8000:8000` port mapping in `docker-compose.yml` publishes the app on all network interfaces, so other machines on your local network can open it and trade your simulated portfolio. To restrict it to this machine, change the mapping in `docker-compose.yml` to:

```yaml
    ports:
      - "127.0.0.1:8000:8000"
```

## Connection indicator

The dot in the header shows the live price stream:

- **Green:** connected and streaming.
- **Yellow:** reconnecting. Stopping the container usually shows yellow, because the browser keeps retrying every second.
- **Red:** the stream was closed by the server.

It turns green again on its own once the server is back.

## Features (planned)

- Live prices over SSE with flash animations and sparklines
- Market orders with instant fills — no fees, no login
- Portfolio heatmap, P&L chart and positions table
- AI chat assistant that trades and manages the watchlist
- One-click account reset

## Stack

Next.js (static export, TypeScript, Tailwind) · FastAPI + uv · SQLite · SSE · LiteLLM → OpenRouter (Cerebras) · one Docker container on port 8000.

## Development

The dev loop runs the backend and the Next.js dev server side by side, with hot reload on both.

Terminal 1, from `backend/`:

```bash
uv sync --extra dev
DEV_CORS_ORIGIN=http://localhost:3000 uv run --extra dev uvicorn app.main:create_app --factory --reload --port 8000
```

Terminal 2, from the repo root:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

Then open http://localhost:3000. `next dev` reads `frontend/.env.development`, which points API calls and the price stream at `http://localhost:8000`; `DEV_CORS_ORIGIN` lets the backend accept that one origin. Next.js rewrites are not used because static export does not support them. The production build never sets either value, so the container stays single-origin with no CORS.

On Windows PowerShell, set the variable first: `$env:DEV_CORS_ORIGIN = "http://localhost:3000"`, then run the `uv run` command.

Tests:

```bash
cd backend && uv run --extra dev pytest -v       # backend
npm --prefix frontend test                       # frontend unit tests
uv run market_data_demo.py                       # terminal demo of the price simulator (from backend/)
```

## Configuration

Set in `.env` at the project root (copy `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Enables AI chat |
| `MASSIVE_API_KEY` | empty | Real market data via Massive (Polygon.io); simulator if unset |
| `MASSIVE_POLL_INTERVAL` | `15` | Seconds between Massive polls |
| `LLM_MOCK` | `false` | Deterministic mock LLM responses for testing |
| `DB_PATH` | `db/finally.db` | SQLite file location (`/app/db/finally.db` in Docker; leave unset) |
| `DEV_CORS_ORIGIN` | unset | Local development only: allow `next dev` (e.g. `http://localhost:3000`) to call the backend. Never set in Docker |

## Layout

```
backend/    FastAPI uv project (API, SQLite, market data)
frontend/   Next.js app, built as a static export served by FastAPI
scripts/    start/stop scripts wrapping docker compose (macOS/Linux and Windows)
planning/   Specs and agent docs
test/       Playwright E2E tests (to come)
Dockerfile, docker-compose.yml   single-container build and run config
```

## License

See [LICENSE](LICENSE).
