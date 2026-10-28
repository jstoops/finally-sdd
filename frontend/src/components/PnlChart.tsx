"use client";

// P&L chart (PF-08): total portfolio value from GET /api/portfolio/history as a Lightweight
// Charts BaselineSeries based at the starting cash, green above and red below. The terminal's
// refresh() loads the history on mount, each trade and reset refetch it, and this panel polls
// it every PNL_REFRESH_MS. The chart is created once per mount inside an effect (the export
// prerenders this component).
import {
  BaselineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import { useEffect, useMemo, useRef } from "react";

import { CHART_THEME, formatLocalTime } from "@/domain/chart";
import { toSnapshotSeries } from "@/domain/pnl";
import { STARTING_CASH } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";

/** The backend records a snapshot every 30 s (PLAN section 7); poll at the same rate. */
export const PNL_REFRESH_MS = 30000;

export function PnlChart() {
  const snapshots = usePortfolio((s) => s.snapshots);
  const historyLoaded = usePortfolio((s) => s.historyLoaded);
  const data = useMemo(() => toSnapshotSeries(snapshots), [snapshots]);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Baseline"> | null>(null);

  // Create the chart once per mount.
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
        secondsVisible: false,
        tickMarkFormatter: formatLocalTime,
      },
      localization: { timeFormatter: formatLocalTime },
    });
    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: STARTING_CASH },
      topLineColor: "#22c55e",
      topFillColor1: "rgba(34,197,94,0.28)",
      topFillColor2: "rgba(34,197,94,0.05)",
      bottomLineColor: "#ef4444",
      bottomFillColor1: "rgba(239,68,68,0.05)",
      bottomFillColor2: "rgba(239,68,68,0.28)",
      lineWidth: 2,
      priceLineVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chartRef.current = null;
      seriesRef.current = null;
      chart.remove();
    };
  }, []);

  // Redraw from the store's snapshots. One point has no segment to draw, so markers show it.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(data);
    series.applyOptions({ pointMarkersVisible: data.length <= 1 });
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  // Poll the history so the 30-second snapshots appear without a trade.
  useEffect(() => {
    const id = setInterval(() => void usePortfolio.getState().loadHistory(), PNL_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  let status: string | null = null;
  if (!historyLoaded) status = "Loading P&L…";
  else if (data.length === 0) status = "No P&L history yet";

  return (
    <section data-testid="panel-pnl" className="flex min-h-0 flex-col border border-border bg-panel">
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        P&amp;L
      </h2>
      <div data-testid="pnl-chart" className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {status !== null && (
          <p
            data-testid="pnl-status"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted"
          >
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
