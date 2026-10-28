import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Portfolio,
  Position,
  PriceFrame,
  PriceTick,
  Snapshot,
  SnapshotsResponse,
  StreamStatus,
  TradeResponse,
  WatchlistEntry,
} from "@/api/types";
import Home from "@/app/page";
import { ConnectionDot } from "@/components/Header";
import { Terminal } from "@/components/Terminal";
import { usePortfolio } from "@/store/portfolio";
import { SPARK_MAX, usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";
import { FakeEventSource } from "@/test/FakeEventSource";
import { callsTo, jsonResponse, type Routes, stubApi } from "@/test/stubFetch";

// jsdom has no canvas; the chart panel's behavior is covered in ChartPanel.test.tsx.
vi.mock("lightweight-charts", async (importOriginal) => {
  const series = {
    setData: vi.fn(),
    update: vi.fn(),
    createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
    applyOptions: vi.fn(),
  };
  const chart = {
    addSeries: vi.fn(() => series),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    remove: vi.fn(),
  };
  return {
    ...(await importOriginal<typeof import("lightweight-charts")>()),
    createChart: vi.fn(() => chart),
  };
});

function entry(ticker: string, price: number | null, open: number | null): WatchlistEntry {
  return { ticker, price, open_price: open, added_at: "2026-10-09T14:00:00Z" };
}

const ENTRIES: WatchlistEntry[] = [
  entry("AAPL", 190, 190),
  entry("MSFT", 401.5, 400),
  entry("PYPL", null, null),
];

function tick(
  ticker: string,
  price: number,
  timestamp: number,
  direction: PriceTick["direction"] = "up",
  open = 190,
): PriceTick {
  return {
    ticker,
    price,
    previous_price: price,
    open_price: open,
    timestamp,
    change: 0,
    change_percent: 0,
    direction,
  };
}

function frameOf(...ticks: PriceTick[]): PriceFrame {
  return Object.fromEntries(ticks.map((t) => [t.ticker, t]));
}

/** Deliver a frame through the one open FakeEventSource. */
function emit(frame: PriceFrame) {
  act(() => FakeEventSource.latest().emitMessage(frame));
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
    weight: 1,
  };
}

function portfolioOf(cash: number, positions: Position[] = []): Portfolio {
  const positionsValue = positions.reduce((sum, p) => sum + p.market_value, 0);
  return {
    cash_balance: cash,
    positions_value: positionsValue,
    total_value: cash + positionsValue,
    unrealized_pnl: 0,
    positions,
  };
}

function tradeResponseOf(portfolio: Portfolio, side: "buy" | "sell" = "buy"): TradeResponse {
  return {
    trade: {
      id: "t-1",
      ticker: "AAPL",
      side,
      quantity: 10,
      price: 190.52,
      executed_at: "2026-10-09T14:03:22Z",
    },
    portfolio,
  };
}

function networkDown(): never {
  throw new TypeError("Failed to fetch");
}

/** stubApi with the given watchlist body plus any extra routes. */
function stubTerminalApi(entries: WatchlistEntry[] = ENTRIES, routes: Routes = {}) {
  return stubApi({ "GET /api/watchlist": { tickers: entries }, ...routes });
}

async function renderTerminal(entries: WatchlistEntry[] = ENTRIES, routes: Routes = {}) {
  const fetchMock = stubTerminalApi(entries, routes);
  render(<Terminal />);
  await act(async () => {});
  return fetchMock;
}

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  useWatchlist.setState({
    entries: [],
    loaded: false,
    loadError: null,
    selected: null,
    held: [],
  });
  usePortfolio.setState({
    cash: null,
    positions: [],
    loaded: false,
    loadError: null,
    snapshots: [],
    historyLoaded: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectionDot", () => {
  const cases: [StreamStatus, string, string][] = [
    ["open", "bg-up", "Price stream connected"],
    ["connecting", "bg-accent", "Price stream reconnecting"],
    ["closed", "bg-down", "Price stream disconnected"],
  ];

  it.each(cases)("status %s renders %s with price-stream wording", (status, cls, label) => {
    render(<ConnectionDot />);
    act(() => usePrices.setState({ status }));
    const dot = screen.getByTestId("connection-dot");
    expect(dot).toHaveAttribute("data-status", status);
    expect(dot).toHaveClass(cls);
    expect(dot).toHaveAttribute("aria-label", label);
    expect(dot).toHaveAttribute("title", label);
    expect(dot).toHaveAttribute("role", "status");
  });

  it("follows the stream through connect, open, reconnect and close", () => {
    render(<ConnectionDot />);
    const dot = screen.getByTestId("connection-dot");
    for (const status of ["connecting", "open", "connecting", "closed", "open"] as const) {
      act(() => usePrices.setState({ status }));
      expect(dot).toHaveAttribute("data-status", status);
    }
  });
});

describe("page", () => {
  it("leaves exactly one open EventSource under StrictMode", async () => {
    stubApi();
    render(
      <StrictMode>
        <Home />
      </StrictMode>,
    );
    await act(async () => {});
    expect(FakeEventSource.open()).toHaveLength(1);
    const [first] = FakeEventSource.instances;
    if (FakeEventSource.instances.length > 1) expect(first.closed).toBe(true);
  });

  it("renders the terminal", async () => {
    stubTerminalApi();
    render(<Home />);
    await act(async () => {});
    expect(screen.getByTestId("panel-watchlist")).toBeInTheDocument();
  });
});

describe("prices store ingestFrame", () => {
  const ingest = (frame: PriceFrame) => usePrices.getState().ingestFrame(frame);

  it("appends a sparkline point only for a new timestamp", () => {
    ingest(frameOf(tick("AAPL", 190, 1)));
    ingest(frameOf(tick("AAPL", 191, 2)));
    expect(usePrices.getState().spark.AAPL).toEqual([190, 191]);
    ingest(frameOf(tick("AAPL", 191, 2)));
    expect(usePrices.getState().spark.AAPL).toEqual([190, 191]);
    ingest(frameOf(tick("AAPL", 192, 1.5)));
    expect(usePrices.getState().spark.AAPL).toEqual([190, 191]);
  });

  it("keeps the newest SPARK_MAX points, dropping the oldest first", () => {
    expect(SPARK_MAX).toBe(300);
    for (let i = 1; i <= 305; i += 1) ingest(frameOf(tick("AAPL", i, i)));
    const spark = usePrices.getState().spark.AAPL;
    expect(spark).toHaveLength(300);
    expect(spark[0]).toBe(6);
    expect(spark[299]).toBe(305);
  });

  it("replaces the map: an empty frame empties ticks and spark", () => {
    ingest(frameOf(tick("AAPL", 190, 1), tick("MSFT", 400, 1)));
    ingest(frameOf(tick("AAPL", 191, 2)));
    expect(Object.keys(usePrices.getState().ticks)).toEqual(["AAPL"]);
    expect(usePrices.getState().spark.MSFT).toBeUndefined();
    ingest({});
    expect(usePrices.getState().ticks).toEqual({});
    expect(usePrices.getState().spark).toEqual({});
  });

  it("keeps a held-but-unwatched ticker from the frame", async () => {
    await renderTerminal();
    emit(frameOf(tick("AAPL", 190, 1), tick("TSLA", 250, 1)));
    expect(usePrices.getState().ticks.TSLA?.price).toBe(250);
    expect(screen.queryByTestId("watchlist-row-TSLA")).toBeNull();
  });
});

describe("portfolio store", () => {
  it("loads a portfolio and marks it loaded", async () => {
    stubApi({ "GET /api/portfolio": portfolioOf(8094.8, [position("AAPL", 10, 190.52)]) });
    await usePortfolio.getState().loadPortfolio();
    const state = usePortfolio.getState();
    expect(state.cash).toBe(8094.8);
    expect(state.positions.map((p) => p.ticker)).toEqual(["AAPL"]);
    expect(state.loaded).toBe(true);
    expect(state.loadError).toBeNull();
  });

  it("rejects a body that is not a portfolio", async () => {
    stubApi({ "GET /api/portfolio": { tickers: [] } });
    await usePortfolio.getState().loadPortfolio();
    expect(usePortfolio.getState().cash).toBeNull();
    expect(usePortfolio.getState().loadError).toBe("Could not load the portfolio.");
  });

  it("sets the load error when the server cannot be reached", async () => {
    stubApi({ "GET /api/portfolio": networkDown });
    await usePortfolio.getState().loadPortfolio();
    expect(usePortfolio.getState().cash).toBeNull();
    expect(usePortfolio.getState().loadError).toBe("Could not load the portfolio.");
  });

  it("refresh() awaits the portfolio load", async () => {
    stubApi({ "GET /api/portfolio": portfolioOf(1234.5) });
    await usePortfolio.getState().refresh();
    expect(usePortfolio.getState().cash).toBe(1234.5);
  });

  it("discards a load requested before a trade response that resolves after it", async () => {
    let release: (body: Portfolio) => void = () => {};
    stubApi({
      "GET /api/portfolio": () =>
        new Promise<Portfolio>((resolve) => {
          release = resolve;
        }),
      "POST /api/portfolio/trade": tradeResponseOf(portfolioOf(8094.8)),
    });
    const load = usePortfolio.getState().loadPortfolio();
    await usePortfolio.getState().trade("AAPL", 10, "buy");
    expect(usePortfolio.getState().cash).toBe(8094.8);

    release(portfolioOf(10000));
    await load;
    expect(usePortfolio.getState().cash).toBe(8094.8);
  });

  it("applies a load requested after the trade response", async () => {
    stubApi({
      "GET /api/portfolio": portfolioOf(9000),
      "POST /api/portfolio/trade": tradeResponseOf(portfolioOf(8094.8)),
    });
    await usePortfolio.getState().trade("AAPL", 10, "buy");
    expect(usePortfolio.getState().cash).toBe(8094.8);
    await usePortfolio.getState().loadPortfolio();
    expect(usePortfolio.getState().cash).toBe(9000);
  });
});

describe("portfolio store history", () => {
  const SNAPS: Snapshot[] = [
    { total_value: 10000, recorded_at: "2026-10-09T14:00:00Z" },
    { total_value: 10012.5, recorded_at: "2026-10-09T14:00:30Z" },
  ];

  it("loadHistory applies the snapshots and marks the history loaded", async () => {
    stubApi({ "GET /api/portfolio/history": { snapshots: SNAPS } });
    await usePortfolio.getState().loadHistory();
    expect(usePortfolio.getState().snapshots).toEqual(SNAPS);
    expect(usePortfolio.getState().historyLoaded).toBe(true);
  });

  it("loadHistory ignores a malformed body", async () => {
    stubApi({ "GET /api/portfolio/history": { trades: [] } });
    await usePortfolio.getState().loadHistory();
    expect(usePortfolio.getState().snapshots).toEqual([]);
    expect(usePortfolio.getState().historyLoaded).toBe(false);
  });

  it("discards an older history response that resolves after a newer one", async () => {
    const releases: ((body: SnapshotsResponse) => void)[] = [];
    stubApi({
      "GET /api/portfolio/history": () =>
        new Promise<SnapshotsResponse>((resolve) => {
          releases.push(resolve);
        }),
    });
    const older = usePortfolio.getState().loadHistory();
    const newer = usePortfolio.getState().loadHistory();
    await act(async () => {});
    releases[1]({ snapshots: SNAPS });
    await newer;
    releases[0]({ snapshots: [SNAPS[0]] });
    await older;
    expect(usePortfolio.getState().snapshots).toEqual(SNAPS);
  });

  it("a successful trade refetches the history", async () => {
    const fetchMock = stubApi({
      "POST /api/portfolio/trade": tradeResponseOf(portfolioOf(8094.8)),
      "GET /api/portfolio/history": { snapshots: SNAPS },
    });
    await usePortfolio.getState().trade("AAPL", 10, "buy");
    await act(async () => {});
    expect(callsTo(fetchMock, "/api/portfolio/history")).toHaveLength(1);
    expect(usePortfolio.getState().snapshots).toEqual(SNAPS);
  });

  it("refresh() loads the portfolio, the trades and the history", async () => {
    const fetchMock = stubApi({ "GET /api/portfolio/history": { snapshots: SNAPS } });
    await usePortfolio.getState().refresh();
    expect(callsTo(fetchMock, "/api/portfolio")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/trades")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/portfolio/history")).toHaveLength(1);
    expect(usePortfolio.getState().snapshots).toEqual(SNAPS);
  });
});

describe("watchlist rows", () => {
  it("render in watchlist order regardless of frame key order", async () => {
    await renderTerminal();
    emit(frameOf(tick("PYPL", 60, 1), tick("MSFT", 402, 1), tick("AAPL", 191, 1)));
    const rows = within(screen.getByTestId("watchlist")).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "watchlist-row-AAPL",
      "watchlist-row-MSFT",
      "watchlist-row-PYPL",
    ]);
  });

  it("show the REST price before the first frame and an em dash when unpriced", async () => {
    await renderTerminal();
    expect(screen.getByTestId("price-MSFT")).toHaveTextContent("401.50");
    expect(screen.getByTestId("chg-MSFT")).toHaveTextContent("+0.38%");
    expect(screen.getByTestId("price-PYPL")).toHaveTextContent("—");
    expect(screen.getByTestId("chg-PYPL")).toHaveTextContent("—");
    expect(screen.getByTestId("chg-PYPL")).toHaveAttribute("data-sign", "flat");
  });

  it("flash on up ticks, re-flash on a new timestamp, and not on flat or repeated ticks", async () => {
    await renderTerminal();
    emit(frameOf(tick("AAPL", 190.5, 1, "up")));
    const first = screen.getByTestId("price-AAPL");
    expect(first).toHaveClass("flash-up");
    expect(first).toHaveAttribute("data-direction", "up");

    emit(frameOf(tick("AAPL", 190.5, 2, "up")));
    const second = screen.getByTestId("price-AAPL");
    expect(second).not.toBe(first);
    expect(second).toHaveClass("flash-up");

    emit(frameOf(tick("AAPL", 190.5, 2, "up")));
    expect(screen.getByTestId("price-AAPL")).toBe(second);

    emit(frameOf(tick("AAPL", 190.1, 3, "down")));
    expect(screen.getByTestId("price-AAPL")).toHaveClass("flash-down");

    emit(frameOf(tick("AAPL", 190.1, 4, "flat")));
    const flat = screen.getByTestId("price-AAPL");
    expect(flat).not.toHaveClass("flash-up");
    expect(flat).not.toHaveClass("flash-down");
  });

  it("show Chg % with sign, color and tabular numerals", async () => {
    await renderTerminal();
    emit(frameOf(tick("AAPL", 190.52, 1, "up", 190)));
    const up = screen.getByTestId("chg-AAPL");
    expect(up).toHaveTextContent("+0.27%");
    expect(up).toHaveAttribute("data-sign", "up");
    expect(up).toHaveClass("text-up", "tabular-nums");
    expect(screen.getByTestId("price-AAPL")).toHaveClass("tabular-nums");

    emit(frameOf(tick("AAPL", 190, 2, "down", 190)));
    const flat = screen.getByTestId("chg-AAPL");
    expect(flat).toHaveTextContent("+0.00%");
    expect(flat).toHaveAttribute("data-sign", "flat");
    expect(flat).toHaveClass("text-muted");

    emit(frameOf(tick("AAPL", 188, 3, "down", 190)));
    const down = screen.getByTestId("chg-AAPL");
    expect(down).toHaveTextContent("-1.05%");
    expect(down).toHaveAttribute("data-sign", "down");
    expect(down).toHaveClass("text-down");
  });

  it("draw a sparkline polyline only once points arrive", async () => {
    await renderTerminal();
    const spark = () => screen.getByTestId("spark-AAPL");
    expect(spark().tagName.toLowerCase()).toBe("svg");
    expect(spark().querySelector("polyline")).toBeNull();
    emit(frameOf(tick("AAPL", 190, 1)));
    emit(frameOf(tick("AAPL", 191, 2)));
    const line = spark().querySelector("polyline");
    expect(line).not.toBeNull();
    expect(line?.getAttribute("points")?.split(" ")).toHaveLength(2);
  });
});

describe("selection", () => {
  it("selects the first row on load and moves on click", async () => {
    await renderTerminal();
    const aapl = screen.getByTestId("select-AAPL");
    expect(aapl).toHaveAttribute("aria-pressed", "true");
    expect(aapl).toHaveClass("border-primary");
    expect(screen.getByTestId("select-MSFT")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("select-MSFT"));
    expect(screen.getByTestId("select-MSFT")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("select-MSFT")).toHaveClass("border-primary");
    expect(screen.getByTestId("select-AAPL")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("select-AAPL")).not.toHaveClass("border-primary");
    expect(within(screen.getByTestId("panel-chart")).getByText("MSFT")).toBeInTheDocument();
  });

  it("reconciles when the selected ticker leaves the list", () => {
    const { setEntries, select } = useWatchlist.getState();
    setEntries(ENTRIES);
    expect(useWatchlist.getState().selected).toBe("AAPL");
    select("MSFT");
    setEntries([ENTRIES[0], ENTRIES[2]]);
    expect(useWatchlist.getState().selected).toBe("AAPL");
    select("PYPL");
    setEntries([ENTRIES[1], ENTRIES[2]]);
    expect(useWatchlist.getState().selected).toBe("PYPL");
    setEntries([]);
    expect(useWatchlist.getState().selected).toBeNull();
  });

  it("keeps a held but unwatched selection across watchlist changes until it is no longer held", () => {
    const { setEntries, setHeld, select } = useWatchlist.getState();
    setEntries(ENTRIES);
    setHeld(["TSLA"]);
    select("TSLA");
    setEntries([ENTRIES[0], ENTRIES[1]]);
    expect(useWatchlist.getState().selected).toBe("TSLA");
    useWatchlist.getState().setHeld([]);
    expect(useWatchlist.getState().selected).toBe("AAPL");
  });

  it("charts a held unwatched ticker and falls back when the position is sold to zero", async () => {
    await renderTerminal(ENTRIES, {
      "GET /api/portfolio": portfolioOf(5000, [position("TSLA", 2, 250)]),
      "POST /api/portfolio/trade": tradeResponseOf(portfolioOf(5500), "sell"),
    });
    expect(useWatchlist.getState().held).toEqual(["TSLA"]);

    act(() => useWatchlist.getState().select("TSLA"));
    expect(within(screen.getByTestId("panel-chart")).getByText("TSLA")).toBeInTheDocument();

    // A watchlist add keeps the held selection.
    act(() => useWatchlist.getState().setEntries([...ENTRIES, entry("NFLX", 600, 600)]));
    expect(useWatchlist.getState().selected).toBe("TSLA");

    // Selling TSLA to zero drops it from the held set: the selection falls back.
    await act(async () => {
      await usePortfolio.getState().trade("TSLA", 2, "sell");
    });
    expect(useWatchlist.getState().held).toEqual([]);
    expect(useWatchlist.getState().selected).toBe("AAPL");
    expect(within(screen.getByTestId("panel-chart")).getByText("AAPL")).toBeInTheDocument();
  });
  it("charts a held unwatched ticker from its positions row and keeps it across a watchlist add", async () => {
    await renderTerminal(ENTRIES, {
      "GET /api/portfolio": portfolioOf(5000, [position("TSLA", 2, 250)]),
    });
    expect(screen.queryByTestId("watchlist-row-TSLA")).toBeNull();

    fireEvent.click(screen.getByTestId("position-row-TSLA"));
    expect(useWatchlist.getState().selected).toBe("TSLA");
    expect(within(screen.getByTestId("panel-chart")).getByText("TSLA")).toBeInTheDocument();
    expect(screen.getByTestId("position-row-TSLA")).toHaveAttribute("aria-selected", "true");

    // The heatmap tile charts it too (the default ResizeObserver stub never fires: 16:9 box).
    act(() => useWatchlist.getState().select("AAPL"));
    fireEvent.click(screen.getByTestId("heatmap-tile-TSLA"));
    expect(useWatchlist.getState().selected).toBe("TSLA");

    act(() => useWatchlist.getState().setEntries([...ENTRIES, entry("NFLX", 600, 600)]));
    expect(useWatchlist.getState().selected).toBe("TSLA");
    expect(within(screen.getByTestId("panel-chart")).getByText("TSLA")).toBeInTheDocument();
  });
});

describe("Terminal", () => {
  it("renders every D-01 panel, with coming-soon labels only where still unbuilt", async () => {
    await renderTerminal();
    for (const id of [
      "panel-watchlist",
      "panel-chart",
      "panel-heatmap",
      "panel-pnl",
      "panel-positions",
      "panel-trade",
      "panel-chat",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("panel-heatmap")).not.toHaveTextContent(
      "Heatmap — coming in Phase 2",
    );
    expect(screen.getByTestId("heatmap-empty")).toHaveTextContent(
      "No positions — buy something or ask FinAlly",
    );
    expect(screen.getByTestId("panel-pnl")).not.toHaveTextContent("P&L — coming in Phase 2");
    expect(screen.getByTestId("pnl-chart")).toBeInTheDocument();
    expect(screen.queryAllByText(/coming in Phase/)).toHaveLength(1);
    expect(screen.getByTestId("panel-positions")).not.toHaveTextContent(
      "Positions — coming in Phase 2",
    );
    expect(screen.getByTestId("positions-table")).toBeInTheDocument();
    expect(screen.getByTestId("positions-empty")).toHaveTextContent("No positions yet");
    expect(screen.getByTestId("panel-trade")).toBeInTheDocument();
    expect(screen.getByTestId("panel-chat")).toHaveTextContent("AI Chat — coming in Phase 3");
  });

  it("opens one stream and loads the watchlist and the portfolio once", async () => {
    const fetchMock = await renderTerminal();
    expect(FakeEventSource.open()).toHaveLength(1);
    // The chart panel also requests the selected ticker's history; count by URL.
    expect(callsTo(fetchMock, "/api/watchlist")).toHaveLength(1);
    expect(callsTo(fetchMock, "/api/portfolio")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
  });

  it("shows the empty states for an empty watchlist", async () => {
    await renderTerminal([]);
    expect(screen.getByTestId("panel-watchlist")).toHaveTextContent("Your watchlist is empty");
    expect(screen.getByTestId("panel-chart")).toHaveTextContent("Add a ticker to start charting");
  });

  it("shows the generic network message when the first load cannot reach the server", async () => {
    await renderTerminal(ENTRIES, {
      "GET /api/watchlist": networkDown,
      "GET /api/portfolio": networkDown,
    });
    expect(screen.getByText("Could not reach the server. Try again.")).toHaveClass("text-down");
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("re-fetches a failed first load once the stream opens", async () => {
    // WR-04: the backend was down at mount; the stream opening means it is back.
    let up = false;
    await renderTerminal(ENTRIES, {
      "GET /api/watchlist": () => (up ? { tickers: ENTRIES } : networkDown()),
      "GET /api/portfolio": () => (up ? portfolioOf(10000) : networkDown()),
    });
    expect(screen.getByText("Could not reach the server. Try again.")).toBeInTheDocument();
    expect(screen.getByTestId("header-cash")).toHaveTextContent("—");

    up = true;
    await act(async () => FakeEventSource.latest().emitOpen());
    expect(screen.queryByText("Could not reach the server. Try again.")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
  });

  it("re-fetches only the failed portfolio on the first open", async () => {
    let up = false;
    const fetchMock = await renderTerminal(ENTRIES, {
      "GET /api/portfolio": () => (up ? portfolioOf(10000) : networkDown()),
    });
    expect(usePortfolio.getState().loadError).toBe("Could not load the portfolio.");

    up = true;
    await act(async () => FakeEventSource.latest().emitOpen());
    expect(callsTo(fetchMock, "/api/portfolio")).toHaveLength(2);
    expect(callsTo(fetchMock, "/api/watchlist")).toHaveLength(1);
    expect(usePortfolio.getState().cash).toBe(10000);
  });

  it("re-fetches the watchlist and the portfolio on reconnect, not on the first open", async () => {
    const fetchMock = await renderTerminal();
    const watchlistLoads = () => callsTo(fetchMock, "/api/watchlist").length;
    const portfolioLoads = () => callsTo(fetchMock, "/api/portfolio").length;

    const es = FakeEventSource.latest();
    await act(async () => es.emitOpen());
    expect(watchlistLoads()).toBe(1);
    expect(portfolioLoads()).toBe(1);

    await act(async () => es.emitError(FakeEventSource.CONNECTING));
    await act(async () => es.emitOpen());
    expect(watchlistLoads()).toBe(2);
    expect(portfolioLoads()).toBe(2);

    // Frames while open are not reconnects.
    emit(frameOf(tick("AAPL", 191, 1)));
    await act(async () => {});
    expect(watchlistLoads()).toBe(2);
    expect(portfolioLoads()).toBe(2);
  });

  it("stops listening for reconnects after unmount", async () => {
    const fetchMock = stubTerminalApi();
    const { unmount } = render(<Terminal />);
    await act(async () => {});
    unmount();
    const calls = fetchMock.mock.calls.length;
    act(() => usePrices.setState({ status: "open" }));
    act(() => usePrices.setState({ status: "connecting" }));
    act(() => usePrices.setState({ status: "open" }));
    await act(async () => {});
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("shows a load error inline", async () => {
    await renderTerminal(ENTRIES, {
      "GET /api/watchlist": () => jsonResponse({ error: "Backend unavailable" }, 500),
    });
    const error = screen.getByText("Backend unavailable");
    expect(error).toHaveClass("text-down");
  });

  it("buys from the trade bar and confirms the fill", async () => {
    const tradeResponse: TradeResponse = {
      trade: {
        id: "t-1",
        ticker: "AAPL",
        side: "buy",
        quantity: 10,
        price: 190.52,
        executed_at: "2026-10-09T14:03:22Z",
      },
      portfolio: {
        cash_balance: 8094.8,
        positions_value: 1905.2,
        total_value: 10000,
        unrealized_pnl: 0,
        positions: [
          {
            ticker: "AAPL",
            quantity: 10,
            avg_cost: 190.52,
            current_price: 190.52,
            market_value: 1905.2,
            unrealized_pnl: 0,
            unrealized_pnl_percent: 0,
            weight: 1,
          },
        ],
      },
    };
    const fetchMock = await renderTerminal(ENTRIES, {
      "POST /api/portfolio/trade": tradeResponse,
    });
    const confirmSpy = vi.spyOn(window, "confirm");
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");

    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "aapl" } });
    fireEvent.change(screen.getByTestId("trade-qty"), { target: { value: "10" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("trade-buy"));
    });

    const tradeCalls = callsTo(fetchMock, "/api/portfolio/trade", "POST");
    expect(tradeCalls).toHaveLength(1);
    const [, init] = tradeCalls[0];
    expect((init as RequestInit | undefined)?.method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit | undefined)?.body))).toEqual({
      ticker: "AAPL",
      quantity: 10,
      side: "buy",
    });

    const message = screen.getByTestId("trade-message");
    expect(message).toHaveTextContent("Bought 10 AAPL @ $190.52");
    expect(message).toHaveAttribute("data-kind", "success");
    expect(usePortfolio.getState().cash).toBe(8094.8);
    expect(usePortfolio.getState().positions.map((p) => p.ticker)).toEqual(["AAPL"]);
    // Cash moves by exactly the trade cost: 10 x 190.52 = 1,905.20.
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$8,094.80");
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("shows a trade error inline", async () => {
    await renderTerminal(ENTRIES, {
      "POST /api/portfolio/trade": () =>
        jsonResponse({ error: "No price available for ZZZZ. Add it to your watchlist first." }, 400),
    });

    fireEvent.change(screen.getByTestId("trade-ticker"), { target: { value: "zzzz" } });
    fireEvent.change(screen.getByTestId("trade-qty"), { target: { value: "1" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("trade-sell"));
    });

    const message = screen.getByTestId("trade-message");
    expect(message).toHaveTextContent(
      "No price available for ZZZZ. Add it to your watchlist first.",
    );
    expect(message).toHaveAttribute("data-kind", "error");
    expect(message).toHaveAttribute("role", "alert");
    expect(message).toHaveClass("text-down");
    // The rejected trade leaves the loaded portfolio untouched.
    expect(usePortfolio.getState().cash).toBe(10000);
  });
});
