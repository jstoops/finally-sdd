"use client";

// The full terminal grid (D-01, UX-02). Every panel is live and on screen at once.
//
//   xl+:   header across the top; watchlist | center (chart / heatmap+P&L / positions+trade) | chat
//          The chat column is 360px, or a 2.75rem rail when the chat is collapsed.
//   md-xl: watchlist | center, with chat moved under the center column; the page scrolls.
//          Collapsed, the chat shrinks to its header row.
import { useEffect } from "react";

import type { Position } from "@/api/types";
import { ChartPanel } from "@/components/ChartPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { Header } from "@/components/Header";
import { Heatmap } from "@/components/Heatmap";
import { PnlChart } from "@/components/PnlChart";
import { PositionsTable } from "@/components/PositionsTable";
import { TradePanel } from "@/components/TradeBar";
import { Watchlist } from "@/components/Watchlist";
import { useChat } from "@/store/chat";
import { usePortfolio } from "@/store/portfolio";
import { startPriceStream, usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

// Complete literal class strings: Tailwind only generates classes it finds written out.
const GRID_EXPANDED =
  "grid flex-1 gap-1 p-1 md:grid-cols-[240px_minmax(0,1fr)] xl:min-h-0 xl:grid-cols-[260px_minmax(0,1fr)_360px]";
const GRID_COLLAPSED =
  "grid flex-1 gap-1 p-1 md:grid-cols-[240px_minmax(0,1fr)] xl:min-h-0 xl:grid-cols-[260px_minmax(0,1fr)_2.75rem]";
const CHAT_EXPANDED = "min-h-64 md:col-start-2 xl:col-start-3 xl:row-start-1 xl:min-h-0";
const CHAT_COLLAPSED = "md:col-start-2 xl:col-start-3 xl:row-start-1 xl:min-h-0";

export function Terminal() {
  const chatCollapsed = useChat((s) => s.collapsed);

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
      <main
        data-chat={chatCollapsed ? "collapsed" : "expanded"}
        className={chatCollapsed ? GRID_COLLAPSED : GRID_EXPANDED}
      >
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
        <ChatPanel className={chatCollapsed ? CHAT_COLLAPSED : CHAT_EXPANDED} />
      </main>
    </div>
  );
}
