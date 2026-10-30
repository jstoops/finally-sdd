// Server portfolio state (cash and positions), the trade history, the P&L snapshots, the loads
// and the trade action (PF-04, PF-08, TRD-07, TRD-10). Loads and trade responses share one response-sequence guard
// so a stale GET /api/portfolio can never overwrite a newer trade's portfolio; the trade list
// has its own guard so a stale GET /api/trades can never drop a newer fill.
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import type {
  Portfolio,
  Position,
  ResetResponse,
  Side,
  Snapshot,
  Trade,
  TradeResponse,
} from "@/api/types";

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

// Snapshot-history guard: each GET /api/portfolio/history takes its number at request time and
// applies only if it is newer than the last applied one, so an older response resolving late
// (the 30 s timer racing a post-trade refetch) never replaces newer snapshots.
let historySequence = 0;
let historyApplied = 0;

/** True for a body shaped like GET /api/portfolio/history. */
function isSnapshotList(body: unknown): body is { snapshots: Snapshot[] } {
  return (
    !!body &&
    typeof body === "object" &&
    Array.isArray((body as { snapshots?: unknown }).snapshots)
  );
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
  /** Portfolio value snapshots, oldest first (GET /api/portfolio/history). */
  snapshots: Snapshot[];
  /** True once a GET /api/portfolio/history has been applied. */
  historyLoaded: boolean;
  /** GET /api/portfolio/history, applied through the snapshot-history sequence guard. */
  loadHistory: () => Promise<void>;
  /** Store the cash and positions of a server portfolio. */
  applyPortfolio: (portfolio: Portfolio) => void;
  /** GET /api/portfolio, applied through the sequence guard. */
  loadPortfolio: () => Promise<void>;
  /** Everything the terminal reloads on mount and after a stream reconnect. */
  refresh: () => Promise<void>;
  /** POST /api/portfolio/trade. Resolves to the recorded fill, or an inline error message. */
  trade: (ticker: string, quantity: number, side: Side) => Promise<TradeOutcome>;
  /**
   * True while a reset() runs (the POST and the refresh after it). The chat panel blocks
   * sends meanwhile, so no message is sent into an account that is being wiped.
   */
  resetting: boolean;
  /**
   * POST /api/reset, then refresh(). Resolves null on success, or the error message.
   * The caller reloads the watchlist (the stores never import each other).
   */
  reset: () => Promise<string | null>;
}

export const usePortfolio = create<PortfolioState>()((set, get) => ({
  cash: null,
  positions: [],
  loaded: false,
  loadError: null,
  trades: [],
  tradesLoaded: false,
  snapshots: [],
  historyLoaded: false,
  resetting: false,
  loadHistory: async () => {
    historySequence += 1;
    const seq = historySequence;
    let body: unknown;
    try {
      body = await apiFetch<unknown>("/api/portfolio/history");
    } catch {
      return; // Keep the chart as is; the 30 s timer or the next trade retries.
    }
    if (!isSnapshotList(body) || seq <= historyApplied) return;
    historyApplied = seq;
    set({ snapshots: body.snapshots, historyLoaded: true });
  },
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
    await Promise.all([get().loadPortfolio(), get().loadTrades(), get().loadHistory()]);
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
      // Each fill writes a snapshot, so the P&L chart gains a point (PF-08).
      void get().loadHistory();
      return { trade: fill };
    } catch (err) {
      return { error: failureMessage(err) };
    }
  },
  reset: async () => {
    set({ resetting: true });
    try {
      try {
        await apiFetch<ResetResponse>("/api/reset", { method: "POST" });
      } catch (err) {
        return failureMessage(err);
      }
      await get().refresh();
      return null;
    } finally {
      set({ resetting: false });
    }
  },
}));
