// The single shared prices store (PLAN §6, §10). Every panel reads this one map.
import { create } from "zustand";

import { apiUrl } from "@/api/client";
import type { PriceFrame, PriceTick, StreamStatus } from "@/api/types";
import { connectPriceStream } from "@/stream/priceStream";

/** Sparkline points kept per ticker (about 2.5 minutes at 500ms). */
export const SPARK_MAX = 300;

interface PricesState {
  ticks: Record<string, PriceTick>;
  /** Newest tick timestamp seen per ticker (Unix seconds). */
  lastTs: Record<string, number>;
  /** Sparkline prices per ticker, accumulated since page load, oldest first. */
  spark: Record<string, number[]>;
  status: StreamStatus;
  /**
   * Replace (never merge) the maps with the frame, so tickers absent from it vanish.
   * A sparkline point is appended only for a timestamp newer than the last one seen.
   */
  ingestFrame: (frame: PriceFrame) => void;
  setStatus: (status: StreamStatus) => void;
  /**
   * Empty every sparkline (after a reset, PF-10). `lastTs` is kept, so a frame already seen
   * never re-appends; the lines refill from the next new ticks.
   */
  clearSparklines: () => void;
}

export const usePrices = create<PricesState>()((set) => ({
  ticks: {},
  lastTs: {},
  spark: {},
  status: "connecting",
  ingestFrame: (frame) =>
    set((s) => {
      const ticks: Record<string, PriceTick> = {};
      const lastTs: Record<string, number> = {};
      const spark: Record<string, number[]> = {};
      for (const [ticker, tick] of Object.entries(frame)) {
        ticks[ticker] = tick;
        const prev = s.lastTs[ticker];
        const buf = s.spark[ticker] ?? [];
        if (prev === undefined || tick.timestamp > prev) {
          lastTs[ticker] = tick.timestamp;
          spark[ticker] = [...buf, tick.price].slice(-SPARK_MAX);
        } else {
          lastTs[ticker] = prev;
          spark[ticker] = buf;
        }
      }
      return { ticks, lastTs, spark };
    }),
  setStatus: (status) => set({ status }),
  clearSparklines: () => set({ spark: {} }),
}));

/**
 * Open the one price stream. Returns a cleanup that closes it and cancels any retry.
 * Call only from an effect (EventSource does not exist during prerender).
 */
export function startPriceStream(): () => void {
  const { ingestFrame, setStatus } = usePrices.getState();
  return connectPriceStream({
    url: apiUrl("/api/stream/prices"),
    onFrame: ingestFrame,
    onStatus: setStatus,
  });
}
