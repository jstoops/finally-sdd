import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { UTCTimestamp } from "lightweight-charts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Portfolio, Trade, TradeResponse, TradesResponse } from "@/api/types";
import { TradePanel } from "@/components/TradeBar";
import { TradeHistory } from "@/components/TradeHistory";
import { formatLocalTime } from "@/domain/chart";
import { usePortfolio } from "@/store/portfolio";
import { callsTo, stubApi } from "@/test/stubFetch";

const PORTFOLIO: Portfolio = {
  cash_balance: 8094.8,
  positions_value: 1905.2,
  total_value: 10000,
  unrealized_pnl: 0,
  positions: [],
};

function tradeOf(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    ticker: "AAPL",
    side: "buy",
    quantity: 10,
    price: 190.52,
    executed_at: "2026-10-09T14:03:22Z",
    ...overrides,
  };
}

const T1 = tradeOf("t-1", { executed_at: "2026-10-09T14:00:00Z" });
const T2 = tradeOf("t-2", { side: "sell", quantity: 4, executed_at: "2026-10-09T14:05:00Z" });

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ids = () => usePortfolio.getState().trades.map((t) => t.id);
const rows = () => screen.queryAllByTestId("trade-history-row");

beforeEach(() => {
  usePortfolio.setState({
    cash: null,
    positions: [],
    loaded: false,
    loadError: null,
    trades: [],
    tradesLoaded: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("usePortfolio trades slice", () => {
  it("loadTrades applies a {trades} body", async () => {
    stubApi({ "GET /api/trades": { trades: [T2, T1] } satisfies TradesResponse });
    await usePortfolio.getState().loadTrades();
    expect(ids()).toEqual(["t-2", "t-1"]);
    expect(usePortfolio.getState().tradesLoaded).toBe(true);
  });

  it("loadTrades ignores a malformed body", async () => {
    usePortfolio.setState({ trades: [T1] });
    stubApi({ "GET /api/trades": { items: [T2] } });
    await usePortfolio.getState().loadTrades();
    expect(ids()).toEqual(["t-1"]);
  });

  it("a fill prepends the response trade once, then refetches GET /api/trades", async () => {
    usePortfolio.setState({ trades: [T1] });
    const list = deferred<TradesResponse>();
    const fetchMock = stubApi({
      "POST /api/portfolio/trade": { trade: T2, portfolio: PORTFOLIO } satisfies TradeResponse,
      "GET /api/trades": () => list.promise,
    });
    await usePortfolio.getState().trade("AAPL", 4, "sell");
    expect(ids()).toEqual(["t-2", "t-1"]);
    expect(callsTo(fetchMock, "/api/trades")).toHaveLength(1);

    await act(async () => {
      list.resolve({ trades: [T2, T1] });
    });
    expect(ids()).toEqual(["t-2", "t-1"]);
  });

  it("does not duplicate a fill already in the list", async () => {
    usePortfolio.setState({ trades: [T2, T1] });
    stubApi({
      "POST /api/portfolio/trade": { trade: T2, portfolio: PORTFOLIO } satisfies TradeResponse,
      "GET /api/trades": () => new Promise(() => {}),
    });
    await usePortfolio.getState().trade("AAPL", 4, "sell");
    expect(ids()).toEqual(["t-2", "t-1"]);
  });

  it("discards a list requested before a fill that resolves after it", async () => {
    const stale = deferred<TradesResponse>();
    let calls = 0;
    stubApi({
      "POST /api/portfolio/trade": { trade: T2, portfolio: PORTFOLIO } satisfies TradeResponse,
      "GET /api/trades": () => {
        calls += 1;
        return calls === 1 ? stale.promise : { trades: [T2, T1] };
      },
    });
    const early = usePortfolio.getState().loadTrades();
    await usePortfolio.getState().trade("AAPL", 4, "sell");
    expect(ids()[0]).toBe("t-2");

    stale.resolve({ trades: [] });
    await early;
    expect(ids()[0]).toBe("t-2");
  });

  it("refresh() loads both the portfolio and the trades", async () => {
    const fetchMock = stubApi({ "GET /api/trades": { trades: [T1] } });
    await usePortfolio.getState().refresh();
    expect(callsTo(fetchMock, "/api/portfolio")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/trades")).toHaveLength(1);
    expect(usePortfolio.getState().cash).toBe(10000);
    expect(ids()).toEqual(["t-1"]);
  });
});

describe("TradeHistory", () => {
  it("shows 'No trades yet' with no trades", () => {
    render(<TradeHistory />);
    expect(screen.getByTestId("trade-history-empty")).toHaveTextContent("No trades yet");
    expect(rows()).toHaveLength(0);
  });

  it("renders one row per trade, newest first, with side, quantity, ticker, price and time", () => {
    const fractional = tradeOf("t-3", { quantity: 0.1 + 0.2, price: 1234.5 });
    act(() => usePortfolio.setState({ trades: [fractional, T2, T1] }));
    render(<TradeHistory />);
    expect(screen.queryByTestId("trade-history-empty")).toBeNull();

    const [first, second, third] = rows();
    expect(rows()).toHaveLength(3);
    expect(first).toHaveAttribute("data-side", "buy");
    expect(second).toHaveAttribute("data-side", "sell");

    expect(within(first).getByText("BUY")).toHaveClass("text-up");
    expect(within(second).getByText("SELL")).toHaveClass("text-down");

    expect(first).toHaveTextContent("0.3");
    expect(first).not.toHaveTextContent("0.30000000000000004");
    expect(first).toHaveTextContent("$1,234.50");
    expect(second).toHaveTextContent("4");
    expect(third).toHaveTextContent("AAPL");
    expect(third).toHaveTextContent("$190.52");
    expect(third).toHaveTextContent(formatLocalTime((Date.parse(T1.executed_at) / 1000) as UTCTimestamp));
    expect(formatLocalTime((Date.parse(T1.executed_at) / 1000) as UTCTimestamp)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("TradePanel with history", () => {
  it("a Buy fill appears at the top of the list before the refetch resolves", async () => {
    usePortfolio.setState({ trades: [T1] });
    const fill = tradeOf("t-9", { quantity: 5, executed_at: "2026-10-09T14:10:00Z" });
    stubApi({
      "POST /api/portfolio/trade": { trade: fill, portfolio: PORTFOLIO } satisfies TradeResponse,
      "GET /api/trades": () => new Promise(() => {}),
    });
    render(<TradePanel />);
    const panel = screen.getByTestId("panel-trade");
    expect(within(panel).getByTestId("trade-history")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "AAPL" } });
    fireEvent.change(screen.getByTestId("trade-qty"), { target: { value: "5" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("trade-buy"));
    });

    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveTextContent("5");
    expect(rows()[0]).toHaveAttribute("data-side", "buy");
    expect(within(panel).getByTestId("trade-message")).toHaveTextContent(
      "Bought 5 AAPL @ $190.52",
    );
  });
});
