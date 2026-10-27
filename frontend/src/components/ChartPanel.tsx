"use client";

// Main price chart for the selected ticker (MD-06, MD-07, D-09..D-12). The chart is created
// once per mount inside an effect (the export prerenders this component), seeded from
// GET /api/prices/{ticker}/history on every selection, and extended imperatively from the
// shared prices store. Times are Unix float seconds, never milliseconds.
import {
  AreaSeries,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "@/api/client";
import type { HistoryResponse } from "@/api/types";
import { CHART_THEME, formatLocalTime, isNewer, toSeriesData } from "@/domain/chart";
import { chgPercent, formatPct, formatPrice, signOf } from "@/domain/market";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

const CHG_CLASS = { up: "text-up", down: "text-down", flat: "text-muted" } as const;

/** History load state for one selection; reset during render when the selection changes. */
interface LoadState {
  ticker: string | null;
  loaded: boolean;
  hasPoints: boolean;
}

/** The selected ticker's dashed Open price line and the price it is drawn at. */
interface OpenLine {
  line: IPriceLine | null;
  price: number | null;
}

/** Session open for a ticker: the live tick's open, else the watchlist entry's. */
function currentOpen(ticker: string): number | null {
  const tickOpen = usePrices.getState().ticks[ticker]?.open_price;
  if (typeof tickOpen === "number" && Number.isFinite(tickOpen)) return tickOpen;
  const entryOpen = useWatchlist.getState().entries.find((e) => e.ticker === ticker)?.open_price;
  return typeof entryOpen === "number" && Number.isFinite(entryOpen) ? entryOpen : null;
}

/** Create the Open line once the open is known (D-11); move it in place when it changes. */
function syncOpenLine(series: ISeriesApi<"Area">, open: OpenLine, price: number | null): void {
  if (price === null) return;
  if (open.line === null) {
    open.line = series.createPriceLine({
      price,
      color: CHART_THEME.openLine,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: "Open",
    });
    open.price = price;
  } else if (open.price !== price) {
    open.line.applyOptions({ price });
    open.price = price;
  }
}

export function ChartPanel() {
  const selected = useWatchlist((s) => s.selected);
  const watchlistLoaded = useWatchlist((s) => s.loaded);
  const entry = useWatchlist((s) =>
    selected === null ? undefined : s.entries.find((e) => e.ticker === selected),
  );
  const tick = usePrices((s) => (selected === null ? undefined : s.ticks[selected]));

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const openLineRef = useRef<OpenLine>({ line: null, price: null });
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
    const openLine = openLineRef.current;
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      openLine.line = null;
      openLine.price = null;
      chart.remove();
    };
  }, []);

  // Seed from history on every selection. A request id discards stale responses.
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    historyLoadedRef.current = false;
    lastTimeRef.current = -Infinity;
    const openLine = openLineRef.current;
    const current = seriesRef.current;
    if (current) {
      current.setData([]);
      if (openLine.line) current.removePriceLine(openLine.line);
    }
    openLine.line = null;
    openLine.price = null;
    if (selected === null) return;

    const finish = (points: HistoryResponse["points"]) => {
      const series = seriesRef.current;
      if (requestId !== requestIdRef.current || !series) return;
      const data = toSeriesData(points);
      series.setData(data);
      lastTimeRef.current = data.length > 0 ? data[data.length - 1].time : -Infinity;
      chartRef.current?.timeScale().fitContent();
      historyLoadedRef.current = true;
      syncOpenLine(series, openLine, currentOpen(selected));
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
    const openLine = openLineRef.current;
    return usePrices.subscribe((state) => {
      const series = seriesRef.current;
      const live = state.ticks[selected];
      if (!series || !live || !historyLoadedRef.current) return;
      syncOpenLine(series, openLine, currentOpen(selected));
      if (!isNewer(live.timestamp, lastTimeRef.current)) return;
      series.update({ time: live.timestamp as UTCTimestamp, value: live.price });
      lastTimeRef.current = live.timestamp;
      setLoad((s) =>
        s.ticker === selected && s.loaded && !s.hasPoints ? { ...s, hasPoints: true } : s,
      );
    });
  }, [selected]);

  // Header values (D-10), derived in render from the live tick with the entry as fallback.
  const price = tick?.price ?? entry?.price ?? null;
  const open = tick?.open_price ?? entry?.open_price ?? null;
  const chg = chgPercent(price, open);
  const sign = signOf(chg);

  // D-12 states, centered over the chart; the canvas stays mounted underneath.
  let status: string | null = null;
  if (selected === null) {
    if (watchlistLoaded) status = "Add a ticker to start charting";
  } else if (!load.loaded) {
    status = `Loading ${selected}…`;
  } else if (!load.hasPoints) {
    status = "Waiting for prices…";
  }

  return (
    <section
      data-testid="panel-chart"
      className="flex min-h-64 flex-col border border-border bg-panel xl:min-h-0"
    >
      <h2 className="flex items-center gap-3 border-b border-border px-2 py-1 font-mono text-xs">
        <span className="font-semibold uppercase tracking-wide text-muted">Chart</span>
        {selected && (
          <>
            <span data-testid="chart-title" className="font-mono font-semibold text-text">
              {selected}
            </span>
            <span data-testid="chart-price" className="tabular-nums text-text">
              {formatPrice(price)}
            </span>
            <span
              data-testid="chart-chg"
              data-sign={sign}
              className={`tabular-nums ${CHG_CLASS[sign]}`}
            >
              {formatPct(chg)}
            </span>
          </>
        )}
      </h2>
      <div data-testid="chart-slot" className="relative min-h-0 flex-1">
        <div ref={containerRef} data-testid="chart-canvas" className="absolute inset-0" />
        {status !== null && (
          <p
            data-testid="chart-status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted"
          >
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
