import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceFrame, PriceTick, StreamStatus, WatchlistEntry } from "@/api/types";
import Home from "@/app/page";
import { ConnectionDot, Header } from "@/components/Header";
import { Terminal } from "@/components/Terminal";
import { SPARK_MAX, usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";
import { FakeEventSource } from "@/test/FakeEventSource";

// jsdom has no canvas; the chart panel's behavior is covered in ChartPanel.test.tsx.
vi.mock("lightweight-charts", async (importOriginal) => {
  const series = {
    setData: vi.fn(),
    update: vi.fn(),
    createPriceLine: vi.fn(() => ({ applyOptions: vi.fn() })),
    removePriceLine: vi.fn(),
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => jsonResponse(body, status));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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

async function renderTerminal(entries: WatchlistEntry[] = ENTRIES) {
  stubFetch({ tickers: entries });
  render(<Terminal />);
  await act(async () => {});
}

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null });
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

describe("Header", () => {
  it("shows only the wordmark and the connection dot", () => {
    render(<Header />);
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent(/^FinAlly$/);
    expect(header.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByTestId("connection-dot")).toBeInTheDocument();
  });
});

describe("page", () => {
  it("leaves exactly one open EventSource under StrictMode", async () => {
    stubFetch({ tickers: [] });
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
    stubFetch({ tickers: ENTRIES });
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
});

describe("Terminal", () => {
  it("renders every D-01 panel with the coming-soon labels", async () => {
    await renderTerminal();
    for (const id of [
      "panel-watchlist",
      "panel-chart",
      "panel-heatmap",
      "panel-pnl",
      "panel-positions",
      "panel-chat",
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId("panel-heatmap")).toHaveTextContent("Heatmap — coming in Phase 2");
    expect(screen.getByTestId("panel-pnl")).toHaveTextContent("P&L — coming in Phase 2");
    expect(screen.getByTestId("panel-positions")).toHaveTextContent(
      "Positions & Trade — coming in Phase 2",
    );
    expect(screen.getByTestId("panel-chat")).toHaveTextContent("AI Chat — coming in Phase 3");
    expect(screen.getByRole("banner")).toHaveTextContent(/^FinAlly$/);
    expect(screen.getByRole("banner").querySelectorAll("button")).toHaveLength(0);
  });

  it("opens one stream and loads the watchlist once", async () => {
    const fetchMock = stubFetch({ tickers: ENTRIES });
    render(<Terminal />);
    await act(async () => {});
    expect(FakeEventSource.open()).toHaveLength(1);
    // The chart panel also requests the selected ticker's history; count watchlist loads only.
    const watchlistCalls = fetchMock.mock.calls.filter(
      (call) => String((call as unknown[])[0]) === "/api/watchlist",
    );
    expect(watchlistCalls).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows the empty states for an empty watchlist", async () => {
    await renderTerminal([]);
    expect(screen.getByTestId("panel-watchlist")).toHaveTextContent("Your watchlist is empty");
    expect(screen.getByTestId("panel-chart")).toHaveTextContent("Add a ticker to start charting");
  });

  it("shows the generic network message when the first load cannot reach the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<Terminal />);
    await act(async () => {});
    expect(screen.getByText("Could not reach the server. Try again.")).toHaveClass("text-down");
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("re-fetches a failed first load once the stream opens", async () => {
    // WR-04: the backend was down at mount; the stream opening means it is back.
    let up = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (!up) throw new TypeError("Failed to fetch");
      if (String(input) === "/api/watchlist") return jsonResponse({ tickers: ENTRIES });
      return jsonResponse({ ticker: "AAPL", points: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal />);
    await act(async () => {});
    expect(screen.getByText("Could not reach the server. Try again.")).toBeInTheDocument();

    up = true;
    await act(async () => FakeEventSource.latest().emitOpen());
    expect(screen.queryByText("Could not reach the server. Try again.")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("re-fetches the watchlist when the stream reconnects, not on the first open", async () => {
    const fetchMock = stubFetch({ tickers: ENTRIES });
    render(<Terminal />);
    await act(async () => {});
    const watchlistLoads = () =>
      fetchMock.mock.calls.filter((call) => String((call as unknown[])[0]) === "/api/watchlist")
        .length;

    const es = FakeEventSource.latest();
    await act(async () => es.emitOpen());
    expect(watchlistLoads()).toBe(1);

    await act(async () => es.emitError(FakeEventSource.CONNECTING));
    await act(async () => es.emitOpen());
    expect(watchlistLoads()).toBe(2);

    // Frames while open are not reconnects.
    emit(frameOf(tick("AAPL", 191, 1)));
    await act(async () => {});
    expect(watchlistLoads()).toBe(2);
  });

  it("stops listening for reconnects after unmount", async () => {
    const fetchMock = stubFetch({ tickers: ENTRIES });
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
    stubFetch({ error: "Backend unavailable" }, 500);
    render(<Terminal />);
    await act(async () => {});
    const error = screen.getByText("Backend unavailable");
    expect(error).toHaveClass("text-down");
  });
});
