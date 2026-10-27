import { act, render } from "@testing-library/react";
import { AreaSeries } from "lightweight-charts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
