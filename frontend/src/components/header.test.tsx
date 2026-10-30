import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Portfolio, Position, PriceFrame } from "@/api/types";
import { Header, RESET_CONFIRM } from "@/components/Header";
import { useChat } from "@/store/chat";
import { usePortfolio } from "@/store/portfolio";
import { startPriceStream, usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";
import { FakeEventSource } from "@/test/FakeEventSource";
import { callsTo, jsonResponse, stubApi } from "@/test/stubFetch";

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  usePortfolio.setState({ cash: null, positions: [], loaded: false, loadError: null });
  useChat.setState({ entries: [], pending: false, loaded: false, collapsed: false });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null, held: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Header", () => {
  it("shows the wordmark, the connection dot and exactly one button, the reset button", () => {
    render(<Header />);
    const header = screen.getByRole("banner");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^FinAlly$/);
    const buttons = header.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe(screen.getByTestId("reset-button"));
    expect(buttons[0]).toHaveAttribute("type", "button");
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

describe("Header reset", () => {
  const DIRTY: Portfolio = {
    cash_balance: 8094.8,
    positions_value: 0,
    total_value: 8094.8,
    unrealized_pnl: 0,
    positions: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function reset() {
    fireEvent.click(screen.getByTestId("reset-button"));
  }

  it("asks for confirmation and sends nothing on cancel", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = stubApi({ "POST /api/reset": { status: "ok" } });
    render(<Header />);
    await act(async () => reset());
    expect(confirm).toHaveBeenCalledWith(RESET_CONFIRM);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on confirm posts once, then refetches portfolio, trades, history and watchlist", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubApi({ "POST /api/reset": { status: "ok" } });
    render(<Header />);
    act(() => usePortfolio.setState({ cash: DIRTY.cash_balance, positions: [] }));
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$8,094.80");

    await act(async () => reset());
    await act(async () => {});

    expect(callsTo(fetchMock, "/api/reset", "POST")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/portfolio")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/trades")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/portfolio/history")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/watchlist")).toHaveLength(1);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls[0]).toBe("/api/reset");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
    expect(screen.queryByTestId("reset-error")).toBeNull();
    expect(screen.getByTestId("reset-button")).not.toBeDisabled();
  });

  it("disables the reset button while the request is pending", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let release: (res: Response) => void = () => {};
    stubApi({
      "POST /api/reset": () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    render(<Header />);
    await act(async () => reset());
    expect(screen.getByTestId("reset-button")).toBeDisabled();

    await act(async () => release(jsonResponse({ status: "ok" })));
    await act(async () => {});
    expect(screen.getByTestId("reset-button")).not.toBeDisabled();
  });

  it("shows a failed reset inline and re-enables the button", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = stubApi({
      "POST /api/reset": () => jsonResponse({ error: "Reset failed on the server" }, 500),
    });
    render(<Header />);
    await act(async () => reset());
    await act(async () => {});

    const error = screen.getByTestId("reset-error");
    expect(error).toHaveTextContent("Reset failed on the server");
    expect(error).toHaveClass("text-down");
    expect(screen.getByTestId("reset-button")).not.toBeDisabled();
    expect(callsTo(fetchMock, "/api/portfolio")).toHaveLength(0);
    expect(callsTo(fetchMock, "/api/watchlist")).toHaveLength(0);
  });

  describe("PF-10", () => {
    const WATCHLIST = ["AAPL", "GOOGL", "MSFT"].map((ticker) => ({
      ticker,
      price: 100,
      open_price: 100,
      added_at: "2026-10-09T14:00:00Z",
    }));

    /** Dirty local state: a conversation, sparklines and a non-first selection. */
    function seedDirtyState() {
      useChat.setState({
        entries: [
          {
            kind: "message",
            message: {
              id: "m-1",
              role: "user",
              content: "buy",
              actions: null,
              created_at: "2026-10-09T14:03:22Z",
            },
          },
        ],
      });
      usePrices.setState({ spark: { AAPL: [1, 2], GOOGL: [3, 4] }, lastTs: { AAPL: 2 } });
      useWatchlist.setState({ entries: WATCHLIST, selected: "GOOGL", loaded: true });
    }

    it("reset is disabled while a chat request is pending and never asks to confirm", async () => {
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      const fetchMock = stubApi({ "POST /api/reset": { status: "ok" } });
      render(<Header />);
      act(() => useChat.setState({ pending: true }));

      const button = screen.getByTestId("reset-button");
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("title", "Wait for FinAlly to finish replying");
      await act(async () => reset());
      expect(confirm).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();

      act(() => useChat.setState({ pending: false }));
      expect(screen.getByTestId("reset-button")).not.toBeDisabled();
      expect(screen.getByTestId("reset-button")).not.toHaveAttribute("title");
    });

    it("a confirmed reset clears the chat and sparklines and selects the first default ticker", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const fetchMock = stubApi({
        "POST /api/reset": { status: "ok" },
        "GET /api/watchlist": { tickers: WATCHLIST },
      });
      render(<Header />);
      seedDirtyState();

      await act(async () => reset());
      await act(async () => {});

      expect(useChat.getState().entries).toEqual([]);
      expect(usePrices.getState().spark).toEqual({});
      // lastTs stays, so frames already seen never re-append to the cleared sparklines.
      expect(usePrices.getState().lastTs).toEqual({ AAPL: 2 });
      expect(useWatchlist.getState().selected).toBe("AAPL");
      for (const path of ["/api/portfolio", "/api/trades", "/api/portfolio/history", "/api/watchlist"]) {
        expect(callsTo(fetchMock, path)).toHaveLength(1);
      }
    });

    it("a failed reset leaves the chat, sparklines and selection untouched", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      stubApi({
        "POST /api/reset": () => jsonResponse({ error: "Reset failed on the server" }, 500),
      });
      render(<Header />);
      seedDirtyState();

      await act(async () => reset());
      await act(async () => {});

      expect(screen.getByTestId("reset-error")).toHaveTextContent("Reset failed on the server");
      expect(useChat.getState().entries).toHaveLength(1);
      expect(usePrices.getState().spark).toEqual({ AAPL: [1, 2], GOOGL: [3, 4] });
      expect(useWatchlist.getState().selected).toBe("GOOGL");
    });
  });
});

describe("store reset helpers", () => {
  it("clearSparklines empties every sparkline and keeps the last timestamps", () => {
    usePrices.setState({ spark: { AAPL: [1, 2] }, lastTs: { AAPL: 5 } });
    usePrices.getState().clearSparklines();
    expect(usePrices.getState().spark).toEqual({});
    expect(usePrices.getState().lastTs).toEqual({ AAPL: 5 });
  });

  it("clearSelection sets the selection to null", () => {
    useWatchlist.setState({ selected: "GOOGL" });
    useWatchlist.getState().clearSelection();
    expect(useWatchlist.getState().selected).toBeNull();
  });
});
