import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Portfolio, Position, PriceFrame } from "@/api/types";
import { Header } from "@/components/Header";
import { usePortfolio } from "@/store/portfolio";
import { startPriceStream, usePrices } from "@/store/prices";
import { FakeEventSource } from "@/test/FakeEventSource";
import { callsTo, stubApi } from "@/test/stubFetch";

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  usePortfolio.setState({ cash: null, positions: [], loaded: false, loadError: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Header", () => {
  it("shows the wordmark, the connection dot and no buttons", () => {
    render(<Header />);
    const header = screen.getByRole("banner");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^FinAlly$/);
    expect(header.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByTestId("connection-dot")).toBeInTheDocument();
  });

  it("shows Cash as an em dash until the portfolio loads", async () => {
    stubApi();
    render(<Header />);
    const cash = screen.getByTestId("header-cash");
    expect(cash).toHaveTextContent("—");
    expect(cash).toHaveClass("tabular-nums");
    expect(screen.getByRole("banner")).toHaveTextContent("Cash");

    await act(async () => {
      await usePortfolio.getState().loadPortfolio();
    });
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
  });

  it("shows em dashes for Total and P&L until the portfolio loads", () => {
    render(<Header />);
    expect(screen.getByTestId("header-total")).toHaveTextContent("—");
    expect(screen.getByTestId("header-pnl")).toHaveTextContent("—");
    expect(screen.getByTestId("header-pnl")).toHaveAttribute("data-sign", "flat");
    const banner = screen.getByRole("banner");
    expect(banner).toHaveTextContent("Total");
    expect(banner).toHaveTextContent("P&L since start");
  });
});

describe("Header live values", () => {
  const AAPL: Position = {
    ticker: "AAPL",
    quantity: 10,
    avg_cost: 190.5,
    current_price: 190.52,
    market_value: 1905.2,
    unrealized_pnl: 0.2,
    unrealized_pnl_percent: 0.0105,
    weight: 1,
  };
  const PORTFOLIO: Portfolio = {
    cash_balance: 8094.8,
    positions_value: 1905.2,
    total_value: 10000,
    unrealized_pnl: 0.2,
    positions: [AAPL],
  };

  function aaplFrame(price: number, timestamp: number): PriceFrame {
    return {
      AAPL: {
        ticker: "AAPL",
        price,
        previous_price: price,
        open_price: 190,
        timestamp,
        change: 0,
        change_percent: 0,
        direction: "flat",
      },
    };
  }

  let stopStream: () => void = () => {};

  afterEach(() => {
    stopStream();
  });

  async function renderLoaded() {
    const fetchMock = stubApi({ "GET /api/portfolio": PORTFOLIO });
    render(<Header />);
    await act(async () => {
      await usePortfolio.getState().loadPortfolio();
    });
    stopStream = startPriceStream();
    act(() => FakeEventSource.latest().emitOpen());
    return fetchMock;
  }

  it("shows Total, Cash and a flat P&L since start from the loaded portfolio", async () => {
    await renderLoaded();
    expect(screen.getByTestId("header-total")).toHaveTextContent("$10,000.00");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$8,094.80");
    const pnl = screen.getByTestId("header-pnl");
    expect(pnl).toHaveTextContent("+$0.00");
    expect(pnl).toHaveAttribute("data-sign", "flat");
    expect(pnl).toHaveClass("text-muted");
  });

  it("recomputes Total and P&L on every frame without fetching the portfolio", async () => {
    const fetchMock = await renderLoaded();
    const portfolioLoads = () => callsTo(fetchMock, "/api/portfolio").length;
    expect(portfolioLoads()).toBe(1);

    act(() => FakeEventSource.latest().emitMessage(aaplFrame(191.52, 1)));
    expect(screen.getByTestId("header-total")).toHaveTextContent("$10,010.00");
    let pnl = screen.getByTestId("header-pnl");
    expect(pnl).toHaveTextContent("+$10.00");
    expect(pnl).toHaveAttribute("data-sign", "up");
    expect(pnl).toHaveClass("text-up");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$8,094.80");

    act(() => FakeEventSource.latest().emitMessage(aaplFrame(189.52, 2)));
    expect(screen.getByTestId("header-total")).toHaveTextContent("$9,990.00");
    pnl = screen.getByTestId("header-pnl");
    expect(pnl).toHaveTextContent("-$10.00");
    expect(pnl).toHaveAttribute("data-sign", "down");
    expect(pnl).toHaveClass("text-down");

    expect(portfolioLoads()).toBe(1);
  });

  it("shows a sub-cent P&L as a flat +$0.00", async () => {
    // Cash 9999.996 puts the total a fraction of a cent under 10,000 before rounding.
    stubApi();
    render(<Header />);
    act(() => usePortfolio.setState({ cash: 9999.996, positions: [] }));
    const pnl = screen.getByTestId("header-pnl");
    expect(pnl).toHaveTextContent("+$0.00");
    expect(pnl).toHaveAttribute("data-sign", "flat");
    expect(pnl).toHaveClass("text-muted");
  });
});
