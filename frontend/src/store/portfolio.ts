// Server portfolio state (cash and positions) and the trade action (TRD-07).
// Plan 02-03 adds loadPortfolio, refresh and a response-sequence guard around trade().
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import type { Portfolio, Position, Side, Trade, TradeResponse } from "@/api/types";

const NETWORK_ERROR = "Could not reach the server. Try again.";

/** The server's `error` text for an API failure, or the generic network message. */
function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
}

export type TradeOutcome = { trade: Trade; error?: undefined } | { error: string; trade?: undefined };

interface PortfolioState {
  /** Null until a portfolio arrives from the server. */
  cash: number | null;
  positions: Position[];
  /** Store the cash and positions of a server portfolio. */
  applyPortfolio: (portfolio: Portfolio) => void;
  /** POST /api/portfolio/trade. Resolves to the recorded fill, or an inline error message. */
  trade: (ticker: string, quantity: number, side: Side) => Promise<TradeOutcome>;
}

export const usePortfolio = create<PortfolioState>()((set, get) => ({
  cash: null,
  positions: [],
  applyPortfolio: (portfolio) =>
    set({ cash: portfolio.cash_balance, positions: portfolio.positions }),
  trade: async (ticker, quantity, side) => {
    try {
      const res = await apiFetch<TradeResponse>("/api/portfolio/trade", {
        method: "POST",
        body: JSON.stringify({ ticker, quantity, side }),
      });
      get().applyPortfolio(res.portfolio);
      return { trade: res.trade };
    } catch (err) {
      return { error: failureMessage(err) };
    }
  },
}));
