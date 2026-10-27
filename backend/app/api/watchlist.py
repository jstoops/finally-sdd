"""Watchlist endpoints (PLAN §8)."""

from __future__ import annotations

from fastapi import APIRouter

from ..watchlist import WatchlistService


def create_watchlist_router(service: WatchlistService) -> APIRouter:
    """Create the watchlist router bound to `service` (a new router per call)."""
    router = APIRouter(tags=["watchlist"])

    @router.get("/api/watchlist")
    async def list_watchlist() -> dict:
        """Watched tickers with latest prices, in `added_at` order."""
        return {"tickers": await service.list_entries()}

    return router
