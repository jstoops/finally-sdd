// Server portfolio state (cash and positions), the portfolio load and the trade action
// (PF-04, TRD-07). Loads and trade responses share one response-sequence guard so a stale
// GET /api/portfolio can never overwrite a newer trade's portfolio.
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import type { Portfolio, Position, Side, Trade, TradeResponse } from "@/api/types";

const NETWORK_ERROR = "Could not reach the server. Try again.";
const LOAD_ERROR = "Could not load the portfolio.";

/** The server's `error` text for an API failure, or the generic network message. */
function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
}

/** True for a body shaped like GET /api/portfolio (never another endpoint's shape). */
function isPortfolio(body: unknown): body is Portfolio {
  if (!body || typeof body !== "object") return false;
  const { cash_balance, positions } = body as Record<string, unknown>;
  return Number.isFinite(cash_balance) && Array.isArray(positions);
}

// Response-sequence guard. A load takes its number when the request starts; a trade
// response takes a fresh one when it arrives. Only a number above the last applied one is
// applied, so a load that was in flight across a trade is discarded.
let sequence = 0;
let lastApplied = 0;

function nextSequence(): number {
  sequence += 1;
  return sequence;
}

function claim(seq: number): boolean {
  if (seq <= lastApplied) return false;
  lastApplied = seq;
  return true;
}

export type TradeOutcome = { trade: Trade; error?: undefined } | { error: string; trade?: undefined };

interface PortfolioState {
  /** Null until a portfolio arrives from the server. */
  cash: number | null;
  positions: Position[];
  /** True once a GET /api/portfolio has been applied. */
  loaded: boolean;
  /** The last load failure, or null. Cleared by a successful load. */
  loadError: string | null;
  /** Store the cash and positions of a server portfolio. */
  applyPortfolio: (portfolio: Portfolio) => void;
  /** GET /api/portfolio, applied through the sequence guard. */
  loadPortfolio: () => Promise<void>;
  /** Everything the terminal reloads on mount and after a stream reconnect. */
  refresh: () => Promise<void>;
  /** POST /api/portfolio/trade. Resolves to the recorded fill, or an inline error message. */
  trade: (ticker: string, quantity: number, side: Side) => Promise<TradeOutcome>;
}

export const usePortfolio = create<PortfolioState>()((set, get) => ({
  cash: null,
  positions: [],
  loaded: false,
  loadError: null,
  applyPortfolio: (portfolio) =>
    set({ cash: portfolio.cash_balance, positions: portfolio.positions }),
  loadPortfolio: async () => {
    const seq = nextSequence();
    let body: unknown;
    try {
      body = await apiFetch<unknown>("/api/portfolio");
    } catch {
      if (seq > lastApplied) set({ loadError: LOAD_ERROR });
      return;
    }
    if (!isPortfolio(body)) {
      if (seq > lastApplied) set({ loadError: LOAD_ERROR });
      return;
    }
    if (!claim(seq)) return;
    get().applyPortfolio(body);
    set({ loaded: true, loadError: null });
  },
  refresh: async () => {
    await get().loadPortfolio();
  },
  trade: async (ticker, quantity, side) => {
    try {
      const res = await apiFetch<TradeResponse>("/api/portfolio/trade", {
        method: "POST",
        body: JSON.stringify({ ticker, quantity, side }),
      });
      if (claim(nextSequence())) get().applyPortfolio(res.portfolio);
      return { trade: res.trade };
    } catch (err) {
      return { error: failureMessage(err) };
    }
  },
}));
