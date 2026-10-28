// Server portfolio state (cash and positions), the trade history, the loads and the trade
// action (PF-04, TRD-07, TRD-10). Loads and trade responses share one response-sequence guard
// so a stale GET /api/portfolio can never overwrite a newer trade's portfolio; the trade list
// has its own guard so a stale GET /api/trades can never drop a newer fill.
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

// Trade-list guard, same rule: a GET /api/trades takes its number at request time and a fill's
// prepend takes a fresh one, so a list requested before the fill is discarded.
let tradesSequence = 0;
let tradesApplied = 0;

function nextTradesSequence(): number {
  tradesSequence += 1;
  return tradesSequence;
}

function claimTrades(seq: number): boolean {
  if (seq <= tradesApplied) return false;
  tradesApplied = seq;
  return true;
}

/** True for a body shaped like GET /api/trades. */
function isTradeList(body: unknown): body is { trades: Trade[] } {
  return !!body && typeof body === "object" && Array.isArray((body as { trades?: unknown }).trades);
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
  /** Recent trades, newest first (GET /api/trades, plus fills prepended as they arrive). */
  trades: Trade[];
  /** True once a GET /api/trades has been applied. */
  tradesLoaded: boolean;
  /** GET /api/trades, applied through the trade-list sequence guard. */
  loadTrades: () => Promise<void>;
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
  trades: [],
  tradesLoaded: false,
  loadTrades: async () => {
    const seq = nextTradesSequence();
    let body: unknown;
    try {
      body = await apiFetch<unknown>("/api/trades");
    } catch {
      return; // Keep the list as is; the next refresh or fill retries.
    }
    if (!isTradeList(body) || !claimTrades(seq)) return;
    set({ trades: body.trades, tradesLoaded: true });
  },
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
    await Promise.all([get().loadPortfolio(), get().loadTrades()]);
  },
  trade: async (ticker, quantity, side) => {
    try {
      const res = await apiFetch<TradeResponse>("/api/portfolio/trade", {
        method: "POST",
        body: JSON.stringify({ ticker, quantity, side }),
      });
      if (claim(nextSequence())) get().applyPortfolio(res.portfolio);
      // The fill shows at the top at once; the refetch then brings the server's list.
      const fill = res.trade;
      if (claimTrades(nextTradesSequence())) {
        const { trades } = get();
        if (!trades.some((t) => t.id === fill.id)) set({ trades: [fill, ...trades] });
      }
      void get().loadTrades();
      return { trade: fill };
    } catch (err) {
      return { error: failureMessage(err) };
    }
  },
}));
