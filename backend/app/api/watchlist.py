"""Watchlist endpoints (PLAN §8)."""

from __future__ import annotations

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..watchlist import WatchlistService


class WatchlistAdd(BaseModel):
    """POST body. No regex here: a malformed ticker must be a 400, not a 422."""

    ticker: str


def create_watchlist_router(service: WatchlistService) -> APIRouter:
    """Create the watchlist router bound to `service` (a new router per call)."""
    router = APIRouter(tags=["watchlist"])

    @router.get("/api/watchlist")
    async def list_watchlist() -> dict:
        """Watched tickers with latest prices, in `added_at` order."""
        return {"tickers": await service.list_entries()}

    @router.post("/api/watchlist")
    async def add_to_watchlist(body: WatchlistAdd) -> JSONResponse:
        """Add a ticker: 201 when new, 200 with the existing entry when already watched."""
        entry, created = await service.add(body.ticker)
        return JSONResponse(entry, status_code=201 if created else 200)

    @router.delete("/api/watchlist/{ticker}")
    async def remove_from_watchlist(ticker: str) -> Response:
        """Remove a ticker: 204, or 404 when it is not on the watchlist."""
        await service.remove(ticker)
        return Response(status_code=204)

    return router
