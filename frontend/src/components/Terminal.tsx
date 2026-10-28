"use client";

// The full terminal grid (D-01). Later phases fill the dimmed slots instead of re-flowing.
//
//   xl+:   header across the top; watchlist | center (chart / heatmap+P&L / positions+trade) | chat
//   md-xl: watchlist | center, with chat moved under the center column; the page scrolls
import { useEffect } from "react";

import type { Position } from "@/api/types";
import { ChartPanel } from "@/components/ChartPanel";
import { Header } from "@/components/Header";
import { Heatmap } from "@/components/Heatmap";
import { PnlChart } from "@/components/PnlChart";
import { PositionsTable } from "@/components/PositionsTable";
import { TradePanel } from "@/components/TradeBar";
import { Watchlist } from "@/components/Watchlist";
import { usePortfolio } from "@/store/portfolio";
import { startPriceStream, usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

function ComingSoon({
  testId,
  title,
  label,
  className = "",
}: {
  testId: string;
  title: string;
  label: string;
  className?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`flex min-h-0 flex-col border border-border bg-panel/60 text-muted ${className}`}
    >
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide">
        {title}
      </h2>
      <div className="flex flex-1 items-center justify-center p-3 text-center text-xs">{label}</div>
    </section>
  );
}

export function Terminal() {
  useEffect(() => {
    const { loadWatchlist } = useWatchlist.getState();
    void loadWatchlist();
    void usePortfolio.getState().refresh();
    // Re-fetch the watchlist and the portfolio when the stream (re)opens after a drop: this
    // resyncs after a backend restart and recovers from a failed first load (Pitfall 11).
    // The first open after mount re-fetches only what failed to load initially.
    let openedBefore = false;
    const unsubscribe = usePrices.subscribe((state, prev) => {
      if (state.status !== "open" || prev.status === "open") return;
      const reconnected = openedBefore;
      openedBefore = true;
      if (reconnected || useWatchlist.getState().loadError !== null) void loadWatchlist();
      if (reconnected || usePortfolio.getState().loadError !== null) {
        void usePortfolio.getState().refresh();
      }
    });
    // Tell the watchlist store which tickers are held, so a held but unwatched selection
    // stays charted and falls back once the position closes (MD-08). The stores never import
    // each other; this effect is the only bridge (assumption D-3).
    const heldTickers = (positions: Position[]) => positions.map((p) => p.ticker);
    useWatchlist.getState().setHeld(heldTickers(usePortfolio.getState().positions));
    const unsubscribeHeld = usePortfolio.subscribe((state, prev) => {
      if (state.positions !== prev.positions) {
        useWatchlist.getState().setHeld(heldTickers(state.positions));
      }
    });
    const stopStream = startPriceStream();
    return () => {
      unsubscribe();
      unsubscribeHeld();
      stopStream();
    };
  }, []);

  return (
    <div data-testid="app-shell" className="flex min-h-screen flex-col bg-bg xl:h-screen">
      <Header />
      <main className="grid flex-1 gap-1 p-1 md:grid-cols-[240px_minmax(0,1fr)] xl:min-h-0 xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <div className="flex min-h-0 flex-col md:row-span-2 xl:row-span-1">
          <Watchlist />
        </div>
        <div className="grid min-h-0 gap-1 grid-rows-[minmax(16rem,50fr)_minmax(10rem,25fr)_minmax(12rem,25fr)] xl:grid-rows-[50fr_25fr_25fr]">
          <ChartPanel />
          <div className="grid min-h-0 grid-cols-2 gap-1">
            <Heatmap />
            <PnlChart />
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-1">
            <PositionsTable />
            <TradePanel />
          </div>
        </div>
        <ComingSoon
          testId="panel-chat"
          title="AI Chat"
          label="AI Chat — coming in Phase 3"
          className="min-h-64 md:col-start-2 xl:col-start-3 xl:row-start-1 xl:min-h-0"
        />
      </main>
    </div>
  );
}
