"""Portfolio endpoints (PLAN §8): the portfolio, trades, snapshot history and reset."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, StrictFloat

from ..portfolio import PortfolioService
from ..trading import TradeService


class TradeRequest(BaseModel):
    """POST body. No Literal or pattern here: a bad side or ticker must be a 400, not a 422.

    There is deliberately no price field: the fill price always comes from the cache.

    `quantity` is strict: only a JSON number parses (integers included). A boolean, a
    string or null is a malformed body and gets FastAPI's 422 (PLAN §8), so JSON true
    can never buy 1 share and "10" can never buy 10. NaN, Infinity, 1e400 and huge
    numbers still parse, and the service rejects them with a 400.
    """

    ticker: str
    quantity: StrictFloat
    side: str


def create_portfolio_router(trade_service: TradeService, portfolio: PortfolioService) -> APIRouter:
    """Create the portfolio router bound to the given services (a new router per call)."""
    router = APIRouter(tags=["portfolio"])

    @router.get("/api/portfolio")
    async def get_portfolio() -> dict:
        """Cash, positions valued at cached prices, totals and unrealized P&L."""
        return await portfolio.view()

    @router.post("/api/portfolio/trade")
    async def trade(body: TradeRequest) -> dict:
        """Fill a market order at the cached price; returns the trade and the new portfolio."""
        result = await trade_service.execute(body.ticker, body.quantity, body.side)
        return result.to_dict()

    @router.get("/api/portfolio/history")
    async def history() -> dict:
        """Portfolio value snapshots for the P&L chart, oldest first (never pruned)."""
        return {"snapshots": await portfolio.history()}

    @router.get("/api/trades")
    async def list_trades() -> dict:
        """The most recent trades (at most TRADES_LIMIT), newest first."""
        return {"trades": await portfolio.list_trades()}

    @router.post("/api/reset")
    async def reset() -> dict:
        """Reset the account to its seeded state.

        Takes no body and reads no headers, so any POST resets (PLAN §8, user decision U-1).
        """
        await portfolio.reset()
        return {"status": "ok"}

    return router
