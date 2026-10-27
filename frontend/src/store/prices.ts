// The single shared prices store and the app's only EventSource (PLAN §6, §10).
import { create } from "zustand";

import { apiUrl } from "@/api/client";
import type { PriceFrame, PriceTick, StreamStatus } from "@/api/types";

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
 * Open the one price stream. Returns a cleanup that closes it.
 * Call only from an effect (EventSource does not exist during prerender).
 * Plan 01-05 replaces the body with the reconnecting state machine; keep the signature.
 */
export function startPriceStream(): () => void {
  const { ingestFrame, setStatus } = usePrices.getState();
  setStatus("connecting");
  const es = new EventSource(apiUrl("/api/stream/prices"));
  es.onopen = () => setStatus("open");
  es.onmessage = (event: MessageEvent<string>) => {
    try {
      ingestFrame(JSON.parse(event.data) as PriceFrame);
    } catch {
      // Ignore a malformed frame; the next one replaces it.
    }
  };
  es.onerror = () => {
    setStatus(es.readyState === EventSource.CLOSED ? "closed" : "connecting");
  };
  return () => es.close();
}
