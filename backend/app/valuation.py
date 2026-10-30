"""Pure portfolio valuation in the PLAN §8 `GET /api/portfolio` shape.

Shared by the portfolio API now and by snapshots from plan 02-02, so the two can
never disagree by a cent.

Rounding points (assumption A4): avg_cost is stored at full precision and served at
4 dp. P&L, P&L % and the uncached-price fallback use that served 4 dp avg_cost, so a
client holding only the wire values reproduces the server's P&L to the cent.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from .money import notional, position_pnl, round4, to_cents


def value_portfolio(
    cash: float,
    positions: Iterable[tuple[str, float, float]],
    price_of: Callable[[str], float | None],
) -> dict:
    """Value `cash` plus each `(ticker, quantity, avg_cost)` at its cached price.

    A ticker with no cached price is valued at its served avg_cost (PLAN §8).
    Totals sum the rounded per-row values, so `cash_balance + positions_value ==
    total_value` exactly as displayed.
    """
    rows: list[dict] = []
    for ticker, quantity, avg_cost in positions:
        avg4 = round4(avg_cost)
        cached = price_of(ticker)
        price = cached if cached is not None else avg4
        pnl_pct = round4((price - avg4) / avg4 * 100) if avg4 > 0 else 0.0
        rows.append(
            {
                "ticker": ticker,
                "quantity": quantity,
                "avg_cost": avg4,
                "current_price": price,
                "market_value": notional(quantity, price),
                "unrealized_pnl": position_pnl(quantity, price, avg4),
                "unrealized_pnl_percent": pnl_pct,
                "weight": 0.0,
            }
        )

    positions_value = to_cents(sum(row["market_value"] for row in rows))
    for row in rows:
        row["weight"] = (
            round4(row["market_value"] / positions_value) if positions_value > 0 else 0.0
        )

    return {
        "cash_balance": to_cents(cash),
        "positions_value": positions_value,
        "total_value": to_cents(cash + positions_value),
        "unrealized_pnl": to_cents(sum(row["unrealized_pnl"] for row in rows)),
        "positions": rows,
    }
