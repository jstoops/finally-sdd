"""FinAlly FastAPI application factory.

Run with: uvicorn app.main:create_app --factory --workers 1 --host 0.0.0.0 --port 8000

There is deliberately no module-level app: importing this module loads no .env,
reads no environment and starts nothing. All startup work happens in `lifespan`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import (
    create_chat_router,
    create_portfolio_router,
    create_system_router,
    create_watchlist_router,
)
from .chat import ChatService, LLMClient, MockLLMClient
from .config import Settings, configure_logging
from .db import Database
from .errors import error_handlers
from .market import MarketDataSource, PriceCache, create_market_data_source, create_stream_router
from .portfolio import PortfolioService
from .snapshots import SNAPSHOT_INTERVAL, SnapshotRecorder, run_snapshot_loop
from .tracker import TickerTracker
from .trading import TradeService
from .watchlist import WatchlistService

logger = logging.getLogger(__name__)

SourceFactory = Callable[[PriceCache], MarketDataSource]


def create_app(
    settings: Settings | None = None,
    *,
    source_factory: SourceFactory | None = None,
    snapshot_interval: float = SNAPSHOT_INTERVAL,
    llm_client: LLMClient | None = None,
) -> FastAPI:
    """Build the app. Objects are inert until lifespan runs (PLAN §3 startup order).

    `snapshot_interval` is a test seam; production uses the 30-second default.
    `llm_client` is a test seam like `source_factory`: when given it answers every
    chat; otherwise LLM_MOCK=true selects the mock client, and with neither the
    chat endpoint returns 503.
    """
    configure_logging()
    # Settings.from_env loads .env BEFORE the market factory reads MASSIVE_API_KEY
    settings = settings or Settings.from_env()
    cache = PriceCache()
    source = (source_factory or create_market_data_source)(cache)
    db = Database(settings.db_path)
    # One lock serializes every state mutation: watchlist edits, trades, reset and snapshots.
    # asyncio.Lock is not reentrant: never call a lock-taking method while holding it.
    state_lock = asyncio.Lock()
    tracker = TickerTracker(db, source)
    watchlist = WatchlistService(db, cache, tracker, state_lock)
    recorder = SnapshotRecorder(db, cache, state_lock)
    portfolio = PortfolioService(db, cache, tracker, state_lock)
    trade_service = TradeService(db, cache, tracker, portfolio, state_lock)
    # The client is chosen once: override, then the mock (checked before any key), else none.
    # Chat gets the services, never the lock: they take it themselves.
    chat_client = llm_client
    if chat_client is None and settings.llm_mock:
        chat_client = MockLLMClient()
    chat_service = ChatService(db, portfolio, watchlist, trade_service, chat_client)
    chat_mode = "custom" if llm_client is not None else "mock" if chat_client else "disabled"
    logger.info("App: chat mode %s", chat_mode)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info("App: database at %s", Path(db.path).resolve())
        await asyncio.to_thread(db.init)
        tracked = await asyncio.to_thread(db.tracked_tickers)
        await source.start(tracked)  # PLAN §6: watchlist ∪ held positions
        task: asyncio.Task | None = None
        try:
            await recorder.record()  # OPS-01: initial snapshot before requests are served
            task = asyncio.create_task(
                run_snapshot_loop(recorder, snapshot_interval), name="snapshot-loop"
            )
            app.state.snapshot_task = task
            yield
        finally:
            # Stop the snapshot task first, so no snapshot runs against a stopped source
            if task is not None:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
            await source.stop()

    app = FastAPI(lifespan=lifespan, title="FinAlly", exception_handlers=error_handlers())
    app.state.settings = settings
    app.state.cache = cache
    app.state.source = source
    app.state.db = db
    app.state.state_lock = state_lock
    app.state.trade_service = trade_service
    app.state.portfolio_service = portfolio
    app.state.chat_service = chat_service

    # D-13: CORS only for the `next dev` loop; never enabled by default or in Docker.
    if settings.dev_cors_origin:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[settings.dev_cors_origin],
            allow_methods=["*"],
            allow_headers=["*"],
        )
        logger.info("App: dev CORS enabled for %s", settings.dev_cors_origin)

    # No GZip middleware: it would buffer the SSE stream.
    app.include_router(create_stream_router(cache))
    app.include_router(create_watchlist_router(watchlist))
    app.include_router(create_portfolio_router(trade_service, portfolio))
    app.include_router(create_chat_router(chat_service))
    app.include_router(create_system_router())
    install_api_not_found(app)  # after every /api router
    mount_static(app, settings.static_dir)  # last: "/" would shadow anything after it
    return app


def install_api_not_found(app: FastAPI) -> None:
    """Answer unmatched /api/* paths with a JSON 404, never the frontend's index.html.

    All methods are listed so e.g. POST /api/unknown doesn't fall through to
    StaticFiles (405). Side effect: a wrong method on a real /api route is a 404.
    """

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        include_in_schema=False,
    )
    async def api_not_found(path: str) -> JSONResponse:
        return JSONResponse({"error": "Not found"}, status_code=404)


def mount_static(app: FastAPI, static_dir: str) -> None:
    """Serve the Next.js static export at "/" when a build exists; else run API-only."""
    if (Path(static_dir) / "index.html").is_file():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
        logger.info("App: serving frontend from %s", static_dir)
    else:
        logger.info("App: no frontend build at %s; serving API only", static_dir)
