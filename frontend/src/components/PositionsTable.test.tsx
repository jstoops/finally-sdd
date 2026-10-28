import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { Portfolio, Position, PriceTick } from "@/api/types";
import { PositionsTable } from "@/components/PositionsTable";
import { usePortfolio } from "@/store/portfolio";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

function position(
  ticker: string,
  quantity: number,
  avgCost: number,
  price: number,
  pnlPercent = 0,
): Position {
  return {
    ticker,
    quantity,
    avg_cost: avgCost,
    current_price: price,
    market_value: quantity * price,
    unrealized_pnl: (price - avgCost) * quantity,
    unrealized_pnl_percent: pnlPercent,
    weight: 0,
  };
}

function portfolioOf(cash: number, positions: Position[]): Portfolio {
  return {
    cash_balance: cash,
    positions_value: 0,
    total_value: cash,
    unrealized_pnl: 0,
    positions,
  };
}

function tick(ticker: string, price: number, timestamp = 1): PriceTick {
  return {
    ticker,
    price,
    previous_price: price,
    open_price: price,
    timestamp,
    change: 0,
    change_percent: 0,
    direction: "flat",
  };
}

/** Replace the ticks map, as one SSE frame does. */
function frame(...ticks: PriceTick[]) {
  act(() => usePrices.setState({ ticks: Object.fromEntries(ticks.map((t) => [t.ticker, t])) }));
}

function hold(...positions: Position[]) {
  act(() => usePortfolio.getState().applyPortfolio(portfolioOf(5000, positions)));
}

const AAPL = position("AAPL", 10, 190.5, 190.52, 0.0105);

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  usePortfolio.setState({ cash: null, positions: [], loaded: false, loadError: null });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null, held: [] });
});

describe("PositionsTable", () => {
  it("shows the panel title, the six column headers and the empty text", () => {
    render(<PositionsTable />);
    const panel = screen.getByTestId("panel-positions");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Positions");
    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Ticker", "Qty", "Avg Cost", "Price", "P&L", "P&L %"]);
    expect(screen.getByTestId("positions-empty")).toHaveTextContent("No positions yet");
    expect(panel).not.toHaveTextContent(/real|live account|brokerage/i);
  });

  it("lists a position with formatted cells and a percent that is never multiplied by 100", () => {
    render(<PositionsTable />);
    hold(AAPL);
    expect(screen.queryByTestId("positions-empty")).toBeNull();
    expect(screen.getByTestId("position-row-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("position-select-AAPL")).toHaveTextContent("AAPL");
    expect(screen.getByTestId("position-qty-AAPL")).toHaveTextContent(/^10$/);
    expect(screen.getByTestId("position-avg-AAPL")).toHaveTextContent("190.50");
    expect(screen.getByTestId("position-price-AAPL")).toHaveTextContent("190.52");
    const pnl = screen.getByTestId("position-pnl-AAPL");
    expect(pnl).toHaveTextContent("+$0.20");
    expect(pnl).toHaveAttribute("data-sign", "up");
    expect(pnl).toHaveClass("text-up", "tabular-nums");
    const pct = screen.getByTestId("position-pnlpct-AAPL");
    expect(pct).toHaveTextContent("+0.01%");
    expect(pct).toHaveAttribute("data-sign", "up");
  });

  it("recomputes price and P&L on every price frame", () => {
    render(<PositionsTable />);
    hold(AAPL);
    frame(tick("AAPL", 191.5));
    expect(screen.getByTestId("position-price-AAPL")).toHaveTextContent("191.50");
    expect(screen.getByTestId("position-pnl-AAPL")).toHaveTextContent("+$10.00");
    expect(screen.getByTestId("position-pnlpct-AAPL")).toHaveTextContent("+0.52%");
    frame(tick("AAPL", 189.5, 2));
    expect(screen.getByTestId("position-pnl-AAPL")).toHaveTextContent("-$10.00");
  });

  it("shows a losing position in the down color", () => {
    render(<PositionsTable />);
    hold(position("TSLA", 2, 250, 240));
    const pnl = screen.getByTestId("position-pnl-TSLA");
    expect(pnl).toHaveTextContent("-$20.00");
    expect(pnl).toHaveAttribute("data-sign", "down");
    expect(pnl).toHaveClass("text-down");
    const pct = screen.getByTestId("position-pnlpct-TSLA");
    expect(pct).toHaveTextContent("-4.00%");
    expect(pct).toHaveAttribute("data-sign", "down");
    expect(pct).toHaveClass("text-down");
  });

  it("shows a P&L that rounds to zero as muted and flat, never red", () => {
    render(<PositionsTable />);
    hold(position("FLAT", 1, 100, 100));
    frame(tick("FLAT", 99.996));
    const pnl = screen.getByTestId("position-pnl-FLAT");
    expect(pnl).toHaveTextContent("+$0.00");
    expect(pnl).toHaveAttribute("data-sign", "flat");
    expect(pnl).toHaveClass("text-muted");
    const pct = screen.getByTestId("position-pnlpct-FLAT");
    expect(pct).toHaveTextContent("+0.00%");
    expect(pct).toHaveAttribute("data-sign", "flat");
    expect(pct).toHaveClass("text-muted");
  });

  it("shows a live move from avg 100 to 101.5 as +1.50%", () => {
    render(<PositionsTable />);
    hold(position("MOVE", 3, 100, 100));
    frame(tick("MOVE", 101.5));
    expect(screen.getByTestId("position-pnlpct-MOVE")).toHaveTextContent("+1.50%");
    expect(screen.getByTestId("position-pnl-MOVE")).toHaveTextContent("+$4.50");
  });

  it("selects the ticker on row click and marks the selected row", () => {
    render(<PositionsTable />);
    hold(AAPL, position("TSLA", 2, 250, 240));
    fireEvent.click(screen.getByTestId("position-row-AAPL"));
    expect(useWatchlist.getState().selected).toBe("AAPL");
    const row = screen.getByTestId("position-row-AAPL");
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(row).toHaveClass("border-primary");
    expect(screen.getByTestId("position-row-TSLA")).toHaveAttribute("aria-selected", "false");
  });

  it("selects the ticker with Enter on the row's select button", async () => {
    const user = userEvent.setup();
    render(<PositionsTable />);
    hold(AAPL, position("TSLA", 2, 250, 240));
    screen.getByTestId("position-select-TSLA").focus();
    await user.keyboard("{Enter}");
    expect(useWatchlist.getState().selected).toBe("TSLA");
    expect(screen.getByTestId("position-row-TSLA")).toHaveAttribute("aria-selected", "true");
  });

  it("removes a sold-out position in the same render the portfolio is applied", () => {
    render(<PositionsTable />);
    hold(AAPL, position("TSLA", 2, 250, 240));
    hold(position("TSLA", 2, 250, 240));
    expect(screen.queryByTestId("position-row-AAPL")).toBeNull();
    expect(screen.getByTestId("position-row-TSLA")).toBeInTheDocument();
    hold();
    expect(screen.getByTestId("positions-empty")).toBeInTheDocument();
  });
});
