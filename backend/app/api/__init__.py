"""HTTP routers for the FinAlly API (router factories, no module-level state)."""

from .portfolio import create_portfolio_router
from .system import create_system_router
from .watchlist import create_watchlist_router

__all__ = ["create_portfolio_router", "create_system_router", "create_watchlist_router"]
