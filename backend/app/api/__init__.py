"""HTTP routers for the FinAlly API (router factories, no module-level state)."""

from .watchlist import create_watchlist_router

__all__ = ["create_watchlist_router"]
