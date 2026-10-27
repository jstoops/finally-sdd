"use client";

// The full terminal grid (D-01). Later phases fill the dimmed slots instead of re-flowing.
//
//   xl+:   header across the top; watchlist | center (chart / heatmap+P&L / positions) | chat
//   md-xl: watchlist | center, with chat moved under the center column; the page scrolls
import { useEffect } from "react";

import { ChartPanel } from "@/components/ChartPanel";
import { Header } from "@/components/Header";
import { Watchlist } from "@/components/Watchlist";
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
    // Re-fetch the watchlist when the stream (re)opens after a drop: this resyncs after a
    // backend restart and recovers from a failed first load. The first open after mount
    // re-fetches only if that initial load failed.
    let openedBefore = false;
    const unsubscribe = usePrices.subscribe((state, prev) => {
      if (state.status !== "open" || prev.status === "open") return;
      const reconnected = openedBefore;
      openedBefore = true;
      if (reconnected || useWatchlist.getState().loadError !== null) void loadWatchlist();
    });
    const stopStream = startPriceStream();
    return () => {
      unsubscribe();
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
        <div className="grid min-h-0 gap-1 grid-rows-[minmax(16rem,55fr)_minmax(10rem,25fr)_minmax(8rem,20fr)] xl:grid-rows-[55fr_25fr_20fr]">
          <ChartPanel />
          <div className="grid min-h-0 grid-cols-2 gap-1">
            <ComingSoon testId="panel-heatmap" title="Heatmap" label="Heatmap — coming in Phase 2" />
            <ComingSoon testId="panel-pnl" title="P&L" label="P&L — coming in Phase 2" />
          </div>
          <ComingSoon
            testId="panel-positions"
            title="Positions & Trade"
            label="Positions & Trade — coming in Phase 2"
          />
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
