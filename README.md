# FinAlly — AI Trading Workstation

An AI-powered trading terminal: live streaming prices, a simulated $10,000 portfolio, and an LLM copilot that analyzes positions and executes trades through chat. Built entirely by coding agents.

> **Status:** v1 is complete. Every feature in [`planning/PLAN.md`](planning/PLAN.md) is built: the live market terminal, manual trading with a live portfolio, and the AI copilot. Backend, frontend and Playwright E2E test suites are included.

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

- `--build` rebuilds the image. The Windows script also accepts `-Build`. Without it, the scripts reuse an existing `finally:latest` image, so **pass `--build` after pulling or changing code**.
- `--no-open` skips opening the browser. The Windows script also accepts `-NoOpen`.
- On first run the start script copies `.env.example` to `.env`. The market simulator needs no keys; AI chat needs `OPENROUTER_API_KEY` in `.env`.
- Both scripts are safe to run more than once. If the app is not healthy within 60 seconds, the start script prints the last 50 log lines and exits with an error.
- Your data (cash, watchlist, positions, trades, P&L history and chat) lives in the `finally-data` Docker volume. The stop scripts keep it. Only `docker volume rm finally-data` deletes it.

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
- **Yellow:** reconnecting after a brief drop. The browser retries every second.
- **Red:** disconnected: three reconnect attempts in a row have failed (about 3 seconds, e.g. the container is stopped) or the server closed the stream. The browser keeps retrying.

It turns green again on its own once the server is back.

## Features

- **Watchlist:** live prices over SSE with green/red flashes, Chg % since session open and sparklines. Add or remove tickers (up to 50).
- **Main chart:** click a ticker to chart it, starting from the last ~5 minutes of prices and extended live.
- **Trading:** market orders from the trade bar with instant fills at the current price. No fees, no login, fractional shares. Errors show inline, and a trade history sits under the bar.
- **Portfolio:** the header shows total value, cash and P&L. A positions table, a P&L-colored heatmap and a portfolio-value chart all update live.
- **AI copilot:** ask FinAlly about your portfolio, or tell it to trade and edit the watchlist. Actions run automatically and show inline as executed or failed. Without `OPENROUTER_API_KEY` the chat panel says it is not configured; `LLM_MOCK=true` gives deterministic replies with no key.
- **Reset:** one click (after a confirmation) restores $10,000 and the default watchlist, and clears positions, trades, P&L history and chat.

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

End-to-end tests (Playwright) run in Docker against the real app image with `LLM_MOCK=true`. They need no API keys and use a throwaway database. From the repo root:

```bash
docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from playwright
docker compose -f test/docker-compose.test.yml down -v
```

Reports land in `test/playwright-report/` and `test/test-results/` (both gitignored).

To check the real LLM path, `uv run --directory backend python chat_llm_spike.py` makes one paid call to OpenRouter (Cerebras) and validates the structured reply. It needs `OPENROUTER_API_KEY`.

## Configuration

Set in `.env` at the project root (copy `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | — | Enables AI chat (without it, chat returns "not configured") |
| `MASSIVE_API_KEY` | empty | Real market data via Massive (Polygon.io); simulator if unset |
| `MASSIVE_POLL_INTERVAL` | `15` | Seconds between Massive polls |
| `LLM_MOCK` | `false` | Deterministic mock LLM responses for testing |
| `DB_PATH` | `db/finally.db` | SQLite file location for local dev (Docker always uses `/app/db/finally.db`, pinned in `docker-compose.yml`) |
| `DEV_CORS_ORIGIN` | unset | Local development only: allow `next dev` (e.g. `http://localhost:3000`) to call the backend. Never set in Docker |

## Layout

```
backend/    FastAPI uv project (API, SQLite, market data, trading, LLM chat)
frontend/   Next.js app, built as a static export served by FastAPI
scripts/    start/stop scripts wrapping docker compose (macOS/Linux and Windows)
planning/   Specs and agent docs (PLAN.md is the contract)
.planning/  GSD planning state: roadmap, milestones and archived phase records
test/       Playwright E2E suite and docker-compose.test.yml
Dockerfile, docker-compose.yml   single-container build and run config
```

## License

See [LICENSE](LICENSE).
