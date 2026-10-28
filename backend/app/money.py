"""Money and quantity math with explicit half-up rounding points (PLAN §7 Trade Rules).

Every value goes through `Decimal(str(x))`, so a float such as 2.675 is treated as the
decimal it prints as. Never use the builtin `round` on money: it rounds half-to-even on
binary floats (round(2.675, 2) == 2.67, round(0.125, 2) == 0.12).
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

_CENT = Decimal("0.01")
_FOUR_DP = Decimal("0.0001")


def _dec(value: float) -> Decimal:
    return Decimal(str(value))


def to_cents(value: float) -> float:
    """Round a dollar amount half-up to cents."""
    return float(_dec(value).quantize(_CENT, rounding=ROUND_HALF_UP))


def round4(value: float) -> float:
    """Round half-up to 4 dp: share quantities, served avg_cost, weight and percent."""
    return float(_dec(value).quantize(_FOUR_DP, rounding=ROUND_HALF_UP))


def notional(quantity: float, price: float) -> float:
    """Exact quantity x price, rounded half-up to cents (inputs are 4 dp and 2 dp)."""
    return float((_dec(quantity) * _dec(price)).quantize(_CENT, rounding=ROUND_HALF_UP))


def position_pnl(quantity: float, price: float, avg_cost: float) -> float:
    """Unrealized P&L `(price - avg_cost) x quantity`, exact in Decimal, half-up to cents.

    A float product first would misround exact half cents: 0.5 x (10.01 - 10.00) is
    0.004999... in float but 0.005, and so 0.01, in Decimal.
    """
    pnl = (_dec(price) - _dec(avg_cost)) * _dec(quantity)
    return float(pnl.quantize(_CENT, rounding=ROUND_HALF_UP))


def format_money(value: float) -> str:
    """Dollar text with thousands separators, e.g. "$12,450.00" or "-$12.50"."""
    cents = _dec(value).quantize(_CENT, rounding=ROUND_HALF_UP)
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents):,.2f}"


def format_qty(value: float) -> str:
    """A quantity at 4 dp with trailing zeros and dot trimmed: 10.5 -> "10.5", 3.0 -> "3"."""
    text = f"{_dec(value).quantize(_FOUR_DP, rounding=ROUND_HALF_UP):f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text
