import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Portfolio, Position, PriceTick } from "@/api/types";
import { Heatmap } from "@/components/Heatmap";
import { pnlColor } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

const BOX_W = 400;
const BOX_H = 200;

/** A ResizeObserver that reports a fixed 400 x 200 content box as soon as it observes. */
class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    const entry = {
      target,
      contentRect: { width: BOX_W, height: BOX_H } as DOMRectReadOnly,
    } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
  unobserve(): void {}
  disconnect(): void {}
}

function position(ticker: string, quantity: number, avgCost: number, price = avgCost): Position {
  return {
    ticker,
    quantity,
    avg_cost: avgCost,
    current_price: price,
    market_value: quantity * price,
    unrealized_pnl: (price - avgCost) * quantity,
    unrealized_pnl_percent: 0,
    weight: 0,
  };
}

function portfolioOf(positions: Position[]): Portfolio {
  return {
    cash_balance: 5000,
    positions_value: 0,
    total_value: 5000,
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

function frame(...ticks: PriceTick[]) {
  act(() => usePrices.setState({ ticks: Object.fromEntries(ticks.map((t) => [t.ticker, t])) }));
}

function hold(...positions: Position[]) {
  act(() => usePortfolio.getState().applyPortfolio(portfolioOf(positions)));
}

const tile = (ticker: string) => screen.getByTestId(`heatmap-tile-${ticker}`);
const allTiles = () => screen.queryAllByTestId(/^heatmap-tile-/);
const pct = (value: string) => Number.parseFloat(value);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FixedResizeObserver);
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  usePortfolio.setState({ cash: null, positions: [], loaded: false, loadError: null });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null, held: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Heatmap", () => {
  it("shows the exact empty text and no tiles with no positions", () => {
    render(<Heatmap />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Heatmap");
    expect(screen.getByTestId("heatmap-empty").textContent).toBe(
      "No positions — buy something or ask FinAlly",
    );
    expect(allTiles()).toHaveLength(0);
    expect(screen.getByTestId("panel-heatmap")).not.toHaveTextContent(
      /real|live account|brokerage/i,
    );
  });

  it("fills the whole box with a single position", () => {
    render(<Heatmap />);
    hold(position("AAPL", 10, 100));
    expect(screen.queryByTestId("heatmap-empty")).toBeNull();
    const only = tile("AAPL");
    expect(pct(only.style.left)).toBe(0);
    expect(pct(only.style.top)).toBe(0);
    expect(pct(only.style.width)).toBeCloseTo(100, 9);
    expect(pct(only.style.height)).toBeCloseTo(100, 9);
  });

  it("colors tiles by P&L % with data-sign, a title and a visible label", () => {
    render(<Heatmap />);
    hold(position("AAPL", 10, 100), position("TSLA", 10, 100));
    frame(tick("AAPL", 101.23), tick("TSLA", 95));

    const aapl = tile("AAPL");
    expect(aapl.tagName.toLowerCase()).toBe("button");
    expect(aapl).toHaveAttribute("type", "button");
    expect(aapl).toHaveAttribute("data-sign", "up");
    expect(aapl).toHaveAttribute("title", "AAPL +1.23%");
    expect(aapl.style.backgroundColor).toBe(pnlColor(1.23));
    expect(aapl).toHaveTextContent("AAPL");
    expect(aapl).toHaveTextContent("+1.23%");

    const tsla = tile("TSLA");
    expect(tsla).toHaveAttribute("data-sign", "down");
    expect(tsla).toHaveAttribute("title", "TSLA -5.00%");
    expect(tsla.style.backgroundColor).toBe(pnlColor(-5));
  });

  it("marks a P&L % that rounds to +0.00% as flat", () => {
    render(<Heatmap />);
    hold(position("FLAT", 1, 100), position("AAPL", 1, 100));
    frame(tick("FLAT", 100.004), tick("AAPL", 100));
    expect(tile("FLAT")).toHaveAttribute("data-sign", "flat");
    expect(tile("FLAT")).toHaveAttribute("title", "FLAT +0.00%");
  });

  it("sizes tiles by live market value after a price frame", () => {
    render(<Heatmap />);
    hold(position("AAPL", 10, 100), position("TSLA", 10, 100));
    expect(pct(tile("AAPL").style.width)).toBeCloseTo(50, 6);
    expect(pct(tile("TSLA").style.width)).toBeCloseTo(50, 6);

    frame(tick("AAPL", 300), tick("TSLA", 100));
    expect(pct(tile("AAPL").style.width)).toBeCloseTo(75, 6);
    expect(pct(tile("TSLA").style.width)).toBeCloseTo(25, 6);
  });

  it("drops the label of a tile under the size threshold but keeps its title", () => {
    render(<Heatmap />);
    hold(position("AAPL", 1000, 100), position("TINY", 1, 100));
    const tiny = tile("TINY");
    expect(pct(tiny.style.width)).toBeLessThan(6);
    expect(tiny.textContent).toBe("");
    expect(tiny).toHaveAttribute("title", "TINY +0.00%");
    expect(tile("AAPL")).toHaveTextContent("AAPL");
  });

  it("gives no tile to a position whose live market value is 0", () => {
    render(<Heatmap />);
    hold(position("AAPL", 10, 100), position("ZERO", 5, 20));
    frame(tick("AAPL", 100), tick("ZERO", 0));
    expect(screen.queryByTestId("heatmap-tile-ZERO")).toBeNull();
    expect(tile("AAPL")).toBeInTheDocument();
  });

  it("selects the ticker on tile click", () => {
    render(<Heatmap />);
    hold(position("AAPL", 10, 100), position("TSLA", 10, 100));
    fireEvent.click(tile("TSLA"));
    expect(useWatchlist.getState().selected).toBe("TSLA");
  });

  it("removes a sold-out tile in the same render the portfolio is applied", () => {
    render(<Heatmap />);
    hold(position("AAPL", 10, 100), position("TSLA", 10, 100));
    hold(position("TSLA", 10, 100));
    expect(screen.queryByTestId("heatmap-tile-AAPL")).toBeNull();
    expect(pct(tile("TSLA").style.width)).toBeCloseTo(100, 9);
    hold();
    expect(screen.getByTestId("heatmap-empty")).toBeInTheDocument();
  });

  it("disconnects its ResizeObserver on unmount", () => {
    const disconnect = vi.fn();
    class Spy extends FixedResizeObserver {
      disconnect(): void {
        disconnect();
      }
    }
    vi.stubGlobal("ResizeObserver", Spy);
    const { unmount } = render(<Heatmap />);
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
