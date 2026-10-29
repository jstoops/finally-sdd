"""Tests for half-up Decimal money and quantity math (TRD-04)."""

import pytest

from app.money import format_money, format_qty, notional, position_pnl, round4, to_cents
from app.trading import MAX_QUANTITY


class TestToCents:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [(0.125, 0.13), (2.675, 2.68), (-0.005, -0.01), (9667.0, 9667.0), (0.0, 0.0)],
    )
    def test_rounds_half_up(self, value, expected):
        assert to_cents(value) == expected


class TestRound4:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [(0.00005, 0.0001), (0.00004, 0.0), (0.1 + 0.2, 0.3), (1.23455, 1.2346)],
    )
    def test_rounds_half_up_to_four_places(self, value, expected):
        assert round4(value) == expected

    def test_max_quantity_stays_in_decimal_range(self):
        assert round4(MAX_QUANTITY) == 1e9
        assert notional(MAX_QUANTITY, 1_000_000.0) == 1e15
        assert format_qty(MAX_QUANTITY) == "1000000000"
        assert format_money(notional(MAX_QUANTITY, 190.0)) == "$190,000,000,000.00"


class TestNotional:
    def test_exact_half_cent_rounds_up(self):
        assert notional(0.0005, 250.0) == 0.13

    def test_fractional_quantity(self):
        assert notional(0.0125, 190.5) == 2.38


class TestPositionPnl:
    @pytest.mark.parametrize(
        ("quantity", "price", "avg_cost", "expected"),
        [
            (0.5, 10.01, 10.0, 0.01),  # float arithmetic gives 0.00
            (0.5, 10.0, 10.01, -0.01),
            (49.9999, 100.0, 99.9999, 0.0),
        ],
    )
    def test_exact_decimal_pnl(self, quantity, price, avg_cost, expected):
        assert position_pnl(quantity, price, avg_cost) == expected


class TestFormat:
    def test_format_money(self):
        assert format_money(12450.0) == "$12,450.00"

    @pytest.mark.parametrize(
        ("value", "expected"), [(10.5, "10.5"), (3.0, "3"), (0.0001, "0.0001")]
    )
    def test_format_qty(self, value, expected):
        assert format_qty(value) == expected
