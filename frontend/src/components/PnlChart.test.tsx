import { act, render, screen } from "@testing-library/react";
import { BaselineSeries } from "lightweight-charts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Snapshot } from "@/api/types";
import { PNL_REFRESH_MS, PnlChart } from "@/components/PnlChart";
import { usePortfolio } from "@/store/portfolio";
import { callsTo, stubApi } from "@/test/stubFetch";

// Fake Lightweight Charts objects: every method is a spy. The real module still provides
// BaselineSeries, so the component's arguments can be compared with the real value.
const lw = vi.hoisted(() => {
  const series = {
    setData: vi.fn(),
    applyOptions: vi.fn(),
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

function snap(recorded_at: string, total_value: number): Snapshot {
  return { total_value, recorded_at };
}

const T0 = "2026-10-09T14:00:00Z";
const T1 = "2026-10-09T14:00:30Z";
const T2 = "2026-10-09T14:01:00Z";

function lastCall<T extends unknown[]>(mock: { mock: { calls: T[] } }): T {
  const { calls } = mock.mock;
  return calls[calls.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  usePortfolio.setState({ snapshots: [], historyLoaded: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PnlChart", () => {
  it("creates one autosized chart with a BaselineSeries based at 10,000", () => {
    stubApi();
    render(<PnlChart />);
    expect(screen.getByTestId("panel-pnl")).toHaveTextContent("P&L");
    expect(screen.getByTestId("pnl-chart")).toBeInTheDocument();
    expect(lw.createChart).toHaveBeenCalledTimes(1);
    const [, options] = lw.createChart.mock.calls[0] as unknown as [HTMLElement, { autoSize: boolean }];
    expect(options.autoSize).toBe(true);
    expect(lw.chart.addSeries).toHaveBeenCalledTimes(1);
    const [type, seriesOptions] = lw.chart.addSeries.mock.calls[0] as unknown as [
      unknown,
      { baseValue: unknown },
    ];
    expect(type).toBe(BaselineSeries);
    expect(seriesOptions.baseValue).toEqual({ type: "price", price: 10000 });
  });

  it("shows a loading status until the history is loaded", () => {
    stubApi();
    render(<PnlChart />);
    expect(screen.getByTestId("pnl-status")).toHaveTextContent("Loading P&L…");
  });

  it("draws a single snapshot as a visible point and fits the content", () => {
    stubApi();
    render(<PnlChart />);
    act(() => usePortfolio.setState({ snapshots: [snap(T0, 10000)], historyLoaded: true }));
    expect(lastCall(lw.series.setData)).toEqual([
      [{ time: Date.parse(T0) / 1000, value: 10000 }],
    ]);
    expect(lastCall(lw.series.applyOptions)).toEqual([{ pointMarkersVisible: true }]);
    expect(lw.timeScale.fitContent).toHaveBeenCalled();
    expect(screen.queryByTestId("pnl-status")).toBeNull();
  });

  it("hides the point markers once there are several snapshots", () => {
    stubApi();
    render(<PnlChart />);
    act(() =>
      usePortfolio.setState({
        snapshots: [snap(T0, 10000), snap(T1, 10010), snap(T2, 9990)],
        historyLoaded: true,
      }),
    );
    expect(lastCall(lw.series.setData)[0]).toHaveLength(3);
    expect(lastCall(lw.series.applyOptions)).toEqual([{ pointMarkersVisible: false }]);
  });

  it("shows 'No P&L history yet' for a loaded empty history and sets empty data", () => {
    stubApi();
    render(<PnlChart />);
    act(() => usePortfolio.setState({ snapshots: [], historyLoaded: true }));
    expect(screen.getByTestId("pnl-status")).toHaveTextContent("No P&L history yet");
    expect(lastCall(lw.series.setData)).toEqual([[]]);
  });

  it("refetches the history every 30 seconds and stops after unmount", async () => {
    vi.useFakeTimers();
    const fetchMock = stubApi({ "GET /api/portfolio/history": { snapshots: [snap(T0, 10000)] } });
    const { unmount } = render(<PnlChart />);
    const historyLoads = () => callsTo(fetchMock, "/api/portfolio/history").length;
    expect(PNL_REFRESH_MS).toBe(30000);
    expect(historyLoads()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_REFRESH_MS);
    });
    expect(historyLoads()).toBe(1);
    expect(usePortfolio.getState().snapshots).toEqual([snap(T0, 10000)]);

    unmount();
    expect(lw.chart.remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PNL_REFRESH_MS * 3);
    });
    expect(historyLoads()).toBe(1);
  });
});
