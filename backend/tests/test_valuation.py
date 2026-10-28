"""Tests for value_portfolio, the shared valuation behind the API and snapshots (PF-01)."""

import pytest

from app.valuation import value_portfolio


def no_price(ticker: str) -> None:
    return None


def one_row(quantity: float, avg_cost: float, price: float | None) -> dict:
    result = value_portfolio(0.0, [("X", quantity, avg_cost)], lambda t: price)
    return result["positions"][0]


class TestEmpty:
    def test_no_positions(self):
        result = value_portfolio(10000.0, [], no_price)
        assert result == {
            "cash_balance": 10000.0,
            "positions_value": 0.0,
            "total_value": 10000.0,
            "unrealized_pnl": 0.0,
            "positions": [],
        }

    def test_single_position_has_weight_one(self):
        assert one_row(10, 190.5, 190.52)["weight"] == 1.0


class TestUncachedPrice:
    def test_falls_back_to_served_avg_cost(self):
        row = one_row(3, 100.33333333333333, None)
        assert row["avg_cost"] == 100.3333
        assert row["current_price"] == 100.3333
        assert row["unrealized_pnl"] == 0.0
        assert row["unrealized_pnl_percent"] == 0.0

    def test_round_avg_cost_fallback(self):
        row = one_row(2, 60.0, None)
        assert row["current_price"] == row["avg_cost"] == 60.0
        assert row["market_value"] == 120.0


class TestPrecision:
    def test_plan_example_row(self):
        row = one_row(10, 190.5, 190.52)
        assert row["market_value"] == 1905.2
        assert row["unrealized_pnl"] == 0.2
        assert row["unrealized_pnl_percent"] == 0.0105

    def test_cash_plus_positions_value_is_total_exactly(self):
        positions = [("A", 0.0005, 250.0), ("B", 0.0125, 190.5), ("C", 1.5, 1.67)]
        prices = {"A": 250.0, "B": 190.5, "C": 1.67}
        result = value_portfolio(1234.56, positions, prices.get)
        assert result["positions_value"] == 5.02  # 0.13 + 2.38 + 2.51
        assert result["cash_balance"] + result["positions_value"] == result["total_value"]
        assert result["total_value"] == 1239.58

    def test_weights_round_to_four_places(self):
        result = value_portfolio(0.0, [("A", 1, 1.0), ("B", 1, 2.0)], {"A": 1.0, "B": 2.0}.get)
        assert [p["weight"] for p in result["positions"]] == [0.3333, 0.6667]

    def test_avg_cost_served_at_four_places(self):
        assert one_row(15, 1505 / 15, 101.0)["avg_cost"] == 100.3333

    def test_positions_keep_input_order(self):
        positions = [("MSFT", 1, 400.0), ("AAPL", 1, 190.0)]
        result = value_portfolio(0.0, positions, no_price)
        assert [p["ticker"] for p in result["positions"]] == ["MSFT", "AAPL"]


class TestParityTable:
    """The half-cent cases plan 02-03 asserts with the same literals in portfolio.test.ts."""

    @pytest.mark.parametrize(
        ("quantity", "avg_cost", "price", "market_value"),
        [(0.0005, 250.00, 250.00, 0.13), (0.0125, 190.50, 190.50, 2.38), (1.5, 1.67, 1.67, 2.51)],
    )
    def test_market_value(self, quantity, avg_cost, price, market_value):
        assert one_row(quantity, avg_cost, price)["market_value"] == market_value

    @pytest.mark.parametrize(
        ("quantity", "avg_cost", "price", "pnl"),
        [
            (0.5, 10.00, 10.01, 0.01),
            (49.9999, 99.9999, 100.00, 0.0),
            (0.5, 10.01, 10.00, -0.01),
            (0.25, 190.50, 190.52, 0.01),
        ],
    )
    def test_unrealized_pnl(self, quantity, avg_cost, price, pnl):
        assert one_row(quantity, avg_cost, price)["unrealized_pnl"] == pnl
