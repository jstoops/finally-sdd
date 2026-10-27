// The single shared prices store (PLAN §6, §10). Every panel reads this one map.
import { create } from "zustand";

import { apiUrl } from "@/api/client";
import type { PriceFrame, PriceTick, StreamStatus } from "@/api/types";
import { connectPriceStream } from "@/stream/priceStream";

interface PricesState {
  ticks: Record<string, PriceTick>;
  status: StreamStatus;
  /** Replace (never merge) ticks with the frame, so removed tickers vanish. */
  ingestFrame: (frame: PriceFrame) => void;
  setStatus: (status: StreamStatus) => void;
}

export const usePrices = create<PricesState>()((set) => ({
  ticks: {},
  status: "connecting",
  ingestFrame: (frame) => set({ ticks: { ...frame } }),
  setStatus: (status) => set({ status }),
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
