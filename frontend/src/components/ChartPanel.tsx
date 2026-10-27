"use client";

// Main price chart for the selected ticker (MD-06, MD-07, D-09). The chart is created once
// per mount inside an effect (the export prerenders this component), seeded from
// GET /api/prices/{ticker}/history on every selection, and extended imperatively from the
// shared prices store. Times are Unix float seconds, never milliseconds.
import {
  AreaSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/api/client";
import type { HistoryResponse } from "@/api/types";
import { CHART_THEME, formatLocalTime, isNewer, toSeriesData } from "@/domain/chart";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

/** History load state for one selection; reset during render when the selection changes. */
interface LoadState {
  ticker: string | null;
  loaded: boolean;
  hasPoints: boolean;
}

export function ChartPanel() {
  const selected = useWatchlist((s) => s.selected);
  const watchlistLoaded = useWatchlist((s) => s.loaded);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const lastTimeRef = useRef(-Infinity);
  const requestIdRef = useRef(0);
  const historyLoadedRef = useRef(false);

  const [load, setLoad] = useState<LoadState>({
    ticker: selected,
    loaded: false,
    hasPoints: false,
  });
  // Adjust state when the selection changes (React's "storing information from previous
  // renders" pattern), so no setState runs synchronously inside an effect body.
  if (load.ticker !== selected) {
    setLoad({ ticker: selected, loaded: false, hasPoints: false });
  }

  // Create the chart once per mount; switching tickers reuses it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: CHART_THEME.background },
        textColor: CHART_THEME.text,
      },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        tickMarkFormatter: formatLocalTime,
      },
      localization: { timeFormatter: formatLocalTime },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: CHART_THEME.line,
      topColor: CHART_THEME.top,
      bottomColor: CHART_THEME.bottom,
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, []);

  // Seed from history on every selection. A request id discards stale responses.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    historyLoadedRef.current = false;
    lastTimeRef.current = -Infinity;
    seriesRef.current?.setData([]);
    if (selected === null) return;

    const finish = (points: HistoryResponse["points"]) => {
      const series = seriesRef.current;
      if (requestId !== requestIdRef.current || !series) return;
      const data = toSeriesData(points);
      series.setData(data);
      lastTimeRef.current = data.length > 0 ? data[data.length - 1].time : -Infinity;
      chartRef.current?.timeScale().fitContent();
      historyLoadedRef.current = true;
      const hasPoints = data.length > 0;
      setLoad((s) => (s.ticker === selected ? { ticker: selected, loaded: true, hasPoints } : s));
    };

    apiFetch<HistoryResponse>(`/api/prices/${encodeURIComponent(selected)}/history`).then(
      (res) => finish(Array.isArray(res?.points) ? res.points : []),
      // A failed history load still lets live ticks extend an empty chart.
      () => finish([]),
    );
  }, [selected]);

  // Extend live from the shared prices map, once the history for this selection is drawn.
  useEffect(() => {
    if (selected === null) return;
    return usePrices.subscribe((state) => {
      const series = seriesRef.current;
      const tick = state.ticks[selected];
      if (!series || !tick || !historyLoadedRef.current) return;
      if (!isNewer(tick.timestamp, lastTimeRef.current)) return;
      series.update({ time: tick.timestamp as UTCTimestamp, value: tick.price });
      lastTimeRef.current = tick.timestamp;
      setLoad((s) =>
        s.ticker === selected && s.loaded && !s.hasPoints ? { ...s, hasPoints: true } : s,
      );
    });
  }, [selected]);

  const showEmpty = watchlistLoaded && selected === null;

  return (
    <section
      data-testid="panel-chart"
      className="flex min-h-64 flex-col border border-border bg-panel xl:min-h-0"
    >
      <h2 className="flex items-center gap-2 border-b border-border px-2 py-1 font-mono text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted">Chart</span>
        {selected && (
          <span data-testid="chart-title" className="font-mono font-semibold text-text">
            {selected}
          </span>
        )}
      </h2>
      <div data-testid="chart-slot" className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {showEmpty && (
          <p
            data-testid="chart-status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted"
          >
            Add a ticker to start charting
          </p>
        )}
      </div>
    </section>
  );
}
