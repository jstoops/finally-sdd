"""FinAlly FastAPI application factory.

Run with: uvicorn app.main:create_app --factory --workers 1 --host 0.0.0.0 --port 8000

There is deliberately no module-level app: importing this module loads no .env,
reads no environment and starts nothing. All startup work happens in `lifespan`.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import create_system_router, create_watchlist_router
from .config import Settings, configure_logging
from .db import Database
from .errors import error_handlers
from .market import MarketDataSource, PriceCache, create_market_data_source, create_stream_router
from .tracker import TickerTracker
from .watchlist import WatchlistService

logger = logging.getLogger(__name__)

SourceFactory = Callable[[PriceCache], MarketDataSource]


def create_app(
    settings: Settings | None = None,
    *,
    source_factory: SourceFactory | None = None,
) -> FastAPI:
    """Build the app. Objects are inert until lifespan runs (PLAN §3 startup order)."""
    configure_logging()
    # Settings.from_env loads .env BEFORE the market factory reads MASSIVE_API_KEY
    settings = settings or Settings.from_env()
    cache = PriceCache()
    source = (source_factory or create_market_data_source)(cache)
    db = Database(settings.db_path)
    # One lock serializes every state mutation: watchlist now, trades and reset in Phase 2
    state_lock = asyncio.Lock()
    tracker = TickerTracker(db, source)
    watchlist = WatchlistService(db, cache, tracker, state_lock)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info("App: database at %s", Path(db.path).resolve())
        await asyncio.to_thread(db.init)
        tracked = await asyncio.to_thread(db.tracked_tickers)
        await source.start(tracked)  # PLAN §6: watchlist ∪ held positions
        try:
            yield
        finally:
            await source.stop()

    app = FastAPI(lifespan=lifespan, title="FinAlly", exception_handlers=error_handlers())
    app.state.settings = settings
    app.state.cache = cache
    app.state.source = source
    app.state.db = db
    app.state.state_lock = state_lock

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
