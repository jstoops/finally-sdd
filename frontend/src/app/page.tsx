"use client";

// Walking-skeleton terminal: the seeded watchlist with prices streaming over SSE.
import { useEffect, useState } from "react";

import { apiFetch } from "@/api/client";
import type { WatchlistEntry, WatchlistResponse } from "@/api/types";
import { Header } from "@/components/Header";
import { startPriceStream, usePrices } from "@/store/prices";

const priceFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(price: number | null | undefined): string {
  return price == null ? "—" : priceFormat.format(price);
}

function WatchlistLine({ entry }: { entry: WatchlistEntry }) {
  const tick = usePrices((s) => s.ticks[entry.ticker]);
  const price = tick ? tick.price : entry.price;
  return (
    <li
      data-testid={`watchlist-line-${entry.ticker}`}
      className="flex items-center justify-between border-b border-border px-3 py-1 font-mono text-sm"
    >
      <span className="font-semibold">{entry.ticker}</span>
      <span className="tabular-nums" data-testid={`price-${entry.ticker}`}>
        {formatPrice(price)}
      </span>
    </li>
  );
}

export default function Home() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);

  useEffect(() => {
    let alive = true;
    const stop = startPriceStream();
    apiFetch<WatchlistResponse>("/api/watchlist")
      .then((data) => {
        if (alive) setEntries(data.tickers);
      })
      .catch(() => {
        // Phase 1 tracer: the list stays empty if the backend is unreachable.
      });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return (
    <main data-testid="app-shell" className="min-h-screen bg-bg">
      <Header />
      <ul data-testid="watchlist" className="max-w-sm bg-panel">
        {entries.map((entry) => (
          <WatchlistLine key={entry.ticker} entry={entry} />
        ))}
      </ul>
    </main>
  );
}
