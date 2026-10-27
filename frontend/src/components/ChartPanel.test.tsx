import { act, render, screen } from "@testing-library/react";
import { AreaSeries, LineStyle } from "lightweight-charts";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { HistoryPoint, PriceFrame, PriceTick, WatchlistEntry } from "@/api/types";
import { ChartPanel } from "@/components/ChartPanel";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

// Fake Lightweight Charts objects: every method is a spy. The real module still provides
// AreaSeries and LineStyle, so the component's arguments can be compared with the real values.
const lw = vi.hoisted(() => {
  const series = {
    setData: vi.fn(),
    update: vi.fn(),
    createPriceLine: vi.fn(),
    removePriceLine: vi.fn(),
  };
  const timeScale = { fitContent: vi.fn() };
  const chart = {
    addSeries: vi.fn(() => series),
    timeScale: vi.fn(() => timeScale),
    remove: vi.fn(),
  };
  const createChart = vi.fn(() => chart);
  return { series, timeScale, chart, createChart };
});

vi.mock("lightweight-charts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("lightweight-charts")>()),
  createChart: lw.createChart,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PendingFetch {
  url: string;
  resolve: (res: Response) => void;
}

let pending: PendingFetch[] = [];

/** fetch stub whose responses are released explicitly with resolveHistory(). */
function stubDeferredFetch() {
  pending = [];
  const fetchMock = vi.fn(
    (url: string) =>
      new Promise<Response>((resolve) => {
        pending.push({ url, resolve });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function resolveHistory(ticker: string, points: HistoryPoint[]) {
  const index = pending.findIndex((p) => p.url === `/api/prices/${ticker}/history`);
  if (index < 0) throw new Error(`no pending history request for ${ticker}`);
  const [call] = pending.splice(index, 1);
  await act(async () => {
    call.resolve(jsonResponse({ ticker, points }));
  });
}

function entry(ticker: string, price: number | null, open: number | null): WatchlistEntry {
  return { ticker, price, open_price: open, added_at: "2026-10-09T14:00:00Z" };
}

const ENTRIES: WatchlistEntry[] = [entry("AAPL", 190, 190), entry("MSFT", 401.5, 400)];

function tick(ticker: string, price: number, timestamp: number, open = 190): PriceTick {
  return {
    ticker,
    price,
    previous_price: price,
    open_price: open,
    timestamp,
    change: 0,
    change_percent: 0,
    direction: "flat",
  };
}

function emit(...ticks: PriceTick[]) {
  const frame: PriceFrame = Object.fromEntries(ticks.map((t) => [t.ticker, t]));
  act(() => usePrices.getState().ingestFrame(frame));
}

const AAPL_POINTS: HistoryPoint[] = [
  { timestamp: 100.5, price: 190.1 },
  { timestamp: 101, price: 190.2 },
];

async function renderSelected(selected: string | null = "AAPL", entries = ENTRIES) {
  const fetchMock = stubDeferredFetch();
  useWatchlist.setState({ entries, loaded: true, loadError: null, selected });
  const view = render(<ChartPanel />);
  await act(async () => {});
  return { fetchMock, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  lw.series.createPriceLine.mockImplementation(() => ({ applyOptions: vi.fn() }));
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "open" });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChartPanel chart lifecycle", () => {
  it("creates one chart with a blue AreaSeries and removes it on unmount", async () => {
    const { unmount } = await renderSelected();
    expect(lw.createChart).toHaveBeenCalledTimes(1);
    expect(lw.chart.addSeries).toHaveBeenCalledTimes(1);
    const [definition, options] = lw.chart.addSeries.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(definition).toBe(AreaSeries);
    expect(options).toMatchObject({
      lineColor: "#209dd7",
      topColor: "rgba(32,157,215,0.35)",
      bottomColor: "rgba(32,157,215,0)",
    });
    expect(lw.chart.remove).not.toHaveBeenCalled();
    unmount();
    expect(lw.chart.remove).toHaveBeenCalledTimes(1);
  });

  it("formats the time axis and crosshair as local HH:MM:SS", async () => {
    await renderSelected();
    const options = (lw.createChart.mock.calls[0] as unknown as [unknown, Record<string, never>])[1];
    const timeScale = options.timeScale as {
      timeVisible: boolean;
      secondsVisible: boolean;
      tickMarkFormatter: (t: number) => string;
    };
    const localization = options.localization as { timeFormatter: (t: number) => string };
    expect(timeScale.timeVisible).toBe(true);
    expect(timeScale.secondsVisible).toBe(true);
    expect(timeScale.tickMarkFormatter(1760000000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(localization.timeFormatter(1760000000)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

describe("ChartPanel history seed", () => {
  it("fetches the selected ticker's history and draws it, then fits the content", async () => {
    const { fetchMock } = await renderSelected();
    expect(fetchMock).toHaveBeenCalledWith("/api/prices/AAPL/history", expect.anything());
    expect(lw.timeScale.fitContent).not.toHaveBeenCalled();
    await resolveHistory("AAPL", AAPL_POINTS);
    expect(lw.series.setData).toHaveBeenLastCalledWith([
      { time: 100.5, value: 190.1 },
      { time: 101, value: 190.2 },
    ]);
    expect(lw.timeScale.fitContent).toHaveBeenCalledTimes(1);
  });

  it("discards a stale history response when the selection moved on", async () => {
    await renderSelected();
    act(() => useWatchlist.getState().select("MSFT"));
    await resolveHistory("MSFT", [{ timestamp: 200, price: 401 }]);
    await resolveHistory("AAPL", AAPL_POINTS);
    expect(lw.series.setData).toHaveBeenLastCalledWith([{ time: 200, value: 401 }]);
    expect(lw.timeScale.fitContent).toHaveBeenCalledTimes(1);
  });

  it("clears the series on a switch and reuses the same chart", async () => {
    await renderSelected();
    await resolveHistory("AAPL", AAPL_POINTS);
    lw.series.setData.mockClear();
    act(() => useWatchlist.getState().select("MSFT"));
    expect(lw.series.setData).toHaveBeenCalledWith([]);
    expect(lw.createChart).toHaveBeenCalledTimes(1);
    expect(lw.chart.addSeries).toHaveBeenCalledTimes(1);
  });
});

describe("ChartPanel live append", () => {
  it("appends only strictly newer ticks of the selected ticker", async () => {
    await renderSelected();
    await resolveHistory("AAPL", AAPL_POINTS);

    emit(tick("AAPL", 190.3, 101));
    expect(lw.series.update).not.toHaveBeenCalled();

    emit(tick("AAPL", 190.4, 101.5), tick("MSFT", 402, 300));
    expect(lw.series.update).toHaveBeenCalledTimes(1);
    expect(lw.series.update).toHaveBeenLastCalledWith({ time: 101.5, value: 190.4 });

    emit(tick("AAPL", 190.4, 101.5), tick("MSFT", 403, 301));
    expect(lw.series.update).toHaveBeenCalledTimes(1);
  });

  it("ignores ticks that arrive before the history resolves", async () => {
    await renderSelected();
    emit(tick("AAPL", 191, 150));
    expect(lw.series.update).not.toHaveBeenCalled();
    await resolveHistory("AAPL", AAPL_POINTS);
    expect(lw.series.update).not.toHaveBeenCalled();
    emit(tick("AAPL", 191.5, 151));
    expect(lw.series.update).toHaveBeenLastCalledWith({ time: 151, value: 191.5 });
  });

  it("follows the new ticker after a switch", async () => {
    await renderSelected();
    await resolveHistory("AAPL", AAPL_POINTS);
    act(() => useWatchlist.getState().select("MSFT"));
    await resolveHistory("MSFT", [{ timestamp: 200, price: 401 }]);
    emit(tick("AAPL", 191, 300), tick("MSFT", 402, 201, 400));
    expect(lw.series.update).toHaveBeenCalledTimes(1);
    expect(lw.series.update).toHaveBeenLastCalledWith({ time: 201, value: 402 });
  });
});

describe("ChartPanel header (D-10)", () => {
  it("shows the ticker, live price and colored Chg %", async () => {
    await renderSelected();
    expect(screen.getByTestId("chart-title")).toHaveTextContent(/^AAPL$/);
    expect(screen.getByTestId("chart-title")).toHaveClass("font-mono");

    emit(tick("AAPL", 190.52, 102, 190));
    expect(screen.getByTestId("chart-price")).toHaveTextContent(/^190\.52$/);
    expect(screen.getByTestId("chart-price")).toHaveClass("tabular-nums");
    const up = screen.getByTestId("chart-chg");
    expect(up).toHaveTextContent(/^\+0\.27%$/);
    expect(up).toHaveAttribute("data-sign", "up");
    expect(up).toHaveClass("text-up");

    emit(tick("AAPL", 188, 103, 190));
    const down = screen.getByTestId("chart-chg");
    expect(down).toHaveTextContent(/^-1\.05%$/);
    expect(down).toHaveAttribute("data-sign", "down");
    expect(down).toHaveClass("text-down");
  });

  it("falls back to the watchlist entry before the first tick", async () => {
    await renderSelected("MSFT");
    expect(screen.getByTestId("chart-price")).toHaveTextContent("401.50");
    expect(screen.getByTestId("chart-chg")).toHaveTextContent("+0.38%");
  });
});

describe("ChartPanel Open line (D-11)", () => {
  it("draws one dashed Open line at open_price and moves it in place", async () => {
    await renderSelected();
    await resolveHistory("AAPL", AAPL_POINTS);
    expect(lw.series.createPriceLine).toHaveBeenCalledTimes(1);
    expect(lw.series.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 190, title: "Open", lineStyle: LineStyle.Dashed }),
    );
    const line = lw.series.createPriceLine.mock.results[0].value as { applyOptions: Mock };

    emit(tick("AAPL", 190.4, 102, 190));
    expect(line.applyOptions).not.toHaveBeenCalled();

    emit(tick("AAPL", 190.5, 103, 191));
    expect(line.applyOptions).toHaveBeenCalledWith({ price: 191 });
    expect(lw.series.createPriceLine).toHaveBeenCalledTimes(1);
  });

  it("creates the Open line when open_price first arrives after selection", async () => {
    await renderSelected("AAPL", [entry("AAPL", null, null)]);
    await resolveHistory("AAPL", []);
    expect(lw.series.createPriceLine).not.toHaveBeenCalled();
    emit(tick("AAPL", 190.2, 102, 190));
    expect(lw.series.createPriceLine).toHaveBeenCalledTimes(1);
    expect(lw.series.createPriceLine).toHaveBeenCalledWith(
      expect.objectContaining({ price: 190, title: "Open" }),
    );
  });

  it("removes the previous Open line on a ticker switch", async () => {
    await renderSelected();
    await resolveHistory("AAPL", AAPL_POINTS);
    const line = lw.series.createPriceLine.mock.results[0].value;
    act(() => useWatchlist.getState().select("MSFT"));
    expect(lw.series.removePriceLine).toHaveBeenCalledWith(line);
    await resolveHistory("MSFT", [{ timestamp: 200, price: 401 }]);
    expect(lw.series.createPriceLine).toHaveBeenCalledTimes(2);
    expect(lw.series.createPriceLine).toHaveBeenLastCalledWith(
      expect.objectContaining({ price: 400, title: "Open" }),
    );
  });
});

describe("ChartPanel states (D-12)", () => {
  const status = () => screen.queryByTestId("chart-status");

  it("reads 'Loading AAPL…' while history is pending and clears once points exist", async () => {
    await renderSelected();
    expect(status()).toHaveTextContent("Loading AAPL…");
    await resolveHistory("AAPL", AAPL_POINTS);
    expect(status()).toBeNull();
  });

  it("reads 'Loading MSFT…' again after switching away from a loaded ticker", async () => {
    await renderSelected();
    await resolveHistory("AAPL", AAPL_POINTS);
    act(() => useWatchlist.getState().select("MSFT"));
    expect(status()).toHaveTextContent("Loading MSFT…");
  });

  it("asks for a ticker when the loaded watchlist is empty", async () => {
    await renderSelected(null, []);
    expect(status()).toHaveTextContent("Add a ticker to start charting");
  });

  it("waits for prices on an empty history until a newer tick arrives", async () => {
    await renderSelected();
    await resolveHistory("AAPL", []);
    expect(status()).toHaveTextContent("Waiting for prices…");
    emit(tick("AAPL", 190.3, 102));
    expect(status()).toBeNull();
    expect(lw.series.update).toHaveBeenLastCalledWith({ time: 102, value: 190.3 });
  });

  it("keeps the chart canvas container mounted under every state", async () => {
    await renderSelected();
    expect(screen.getByTestId("chart-canvas")).toBeInTheDocument();
    expect(lw.chart.remove).not.toHaveBeenCalled();
  });
});
