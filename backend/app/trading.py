"""The single trade path (PLAN §7 Trade Rules): the REST route now, the AI executor in Phase 3.

`TradeService.execute` is the only code that changes cash, positions or trades. It takes
the shared state lock, fills at the cached price inside one BEGIN IMMEDIATE transaction
on a worker thread, and builds the response portfolio while still holding the lock, so
the response matches the committed state. Rule failures raise DomainError (400).

Never call the lock-taking snapshot recorder from here: it takes the same `asyncio.Lock`,
which is not reentrant, so the trade would deadlock.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass

from .db import DEFAULT_USER_ID, Database, now_iso
from .errors import DomainError
from .market import PriceCache
from .money import format_money, format_qty, notional, round4, to_cents
from .portfolio import PortfolioService
from .tickers import normalize_ticker
from .tracker import TickerTracker

logger = logging.getLogger(__name__)

DUST = 1e-6  # PLAN §7: sell tolerance and the remaining-quantity cutoff for deleting a row


@dataclass(frozen=True, slots=True)
class Trade:
    """One recorded fill (a trades row)."""

    id: str
    ticker: str
    side: str
    quantity: float
    price: float
    executed_at: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "ticker": self.ticker,
            "side": self.side,
            "quantity": self.quantity,
            "price": self.price,
            "executed_at": self.executed_at,
        }


@dataclass(frozen=True, slots=True)
class TradeResult:
    """A fill plus the portfolio as committed by it (POST /api/portfolio/trade body)."""

    trade: Trade
    portfolio: dict

    def to_dict(self) -> dict:
        return {"trade": self.trade.to_dict(), "portfolio": self.portfolio}


class TradeService:
    """Executes market orders at the cached price under the shared state lock."""

    def __init__(
        self,
        db: Database,
        cache: PriceCache,
        tracker: TickerTracker,
        portfolio: PortfolioService,
        lock: asyncio.Lock,
    ) -> None:
        self._db = db
        self._cache = cache
        self._tracker = tracker  # plan 02-02 reconciles tracked tickers after each fill
        self._portfolio = portfolio
        self._lock = lock

    async def execute(self, raw_ticker: str, quantity: float, side: str) -> TradeResult:
        """Fill `quantity` shares of `raw_ticker` on `side` ("buy" or "sell").

        Raises DomainError for a malformed ticker or side, no cached price,
        insufficient cash or insufficient shares; nothing changes on failure.
        """
        ticker = normalize_ticker(raw_ticker)
        side = side.strip().lower() if isinstance(side, str) else ""
        if side not in ("buy", "sell"):
            raise DomainError("Side must be 'buy' or 'sell'.")
        qty = round4(float(quantity))
        async with self._lock:
            trade = await asyncio.to_thread(self._trade_tx, ticker, qty, side)
            portfolio = await asyncio.to_thread(self._portfolio.view_sync)
        logger.info("Trade: %s %s %s @ %s", trade.side, trade.quantity, trade.ticker, trade.price)
        return TradeResult(trade=trade, portfolio=portfolio)

    # --- Internals ---

    def _trade_tx(self, ticker: str, qty: float, side: str) -> Trade:
        # Read under the lock: the fill price is never supplied by the client
        price = self._cache.get_price(ticker)
        if price is None:
            raise DomainError(f"No price available for {ticker}. Add it to your watchlist first.")
        executed_at = now_iso()
        with self._db.transaction() as conn:
            (cash,) = conn.execute(
                "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
            ).fetchone()
            pos = conn.execute(
                "SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
                (DEFAULT_USER_ID, ticker),
            ).fetchone()
            held, avg = (pos["quantity"], pos["avg_cost"]) if pos else (0.0, 0.0)

            if side == "buy":
                cost = notional(qty, price)
                if cost > cash:
                    raise DomainError(
                        f"Insufficient cash (need {format_money(cost)}, have {format_money(cash)})."
                    )
                filled = qty
                new_qty = round4(held + qty)
                new_avg = (held * avg + qty * price) / (held + qty)  # stored unrounded
                new_cash = to_cents(cash - cost)
                # ON CONFLICT keeps the original rowid, so positions stay in first-purchase order
                conn.execute(
                    "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?) "
                    "ON CONFLICT(user_id, ticker) DO UPDATE SET "
                    "quantity = excluded.quantity, avg_cost = excluded.avg_cost, "
                    "updated_at = excluded.updated_at",
                    (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, new_qty, new_avg, executed_at),
                )
            else:
                if qty > held + DUST:
                    raise DomainError(
                        f"Insufficient shares (need {format_qty(qty)}, have {format_qty(held)})."
                    )
                filled = min(qty, held)
                if filled != qty:
                    logger.info("Trade: sell of %s %s clamped to held %s", qty, ticker, filled)
                remaining = round4(held - filled)
                new_cash = to_cents(cash + notional(filled, price))
                if remaining < DUST:
                    conn.execute(
                        "DELETE FROM positions WHERE user_id = ? AND ticker = ?",
                        (DEFAULT_USER_ID, ticker),
                    )
                else:
                    conn.execute(
                        "UPDATE positions SET quantity = ?, updated_at = ? "
                        "WHERE user_id = ? AND ticker = ?",
                        (remaining, executed_at, DEFAULT_USER_ID, ticker),
                    )

            conn.execute(
                "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
                (new_cash, DEFAULT_USER_ID),
            )
            trade = Trade(
                id=str(uuid.uuid4()),
                ticker=ticker,
                side=side,
                quantity=filled,
                price=price,
                executed_at=executed_at,
            )
            conn.execute(
                "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    trade.id,
                    DEFAULT_USER_ID,
                    trade.ticker,
                    trade.side,
                    trade.quantity,
                    trade.price,
                    trade.executed_at,
                ),
            )
        return trade
