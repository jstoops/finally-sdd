// Watchlist entries (GET /api/watchlist, added_at order) and the selected ticker (MD-07).
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import { sanitizeTickerInput, tickerError } from "@/api/ticker";
import type { WatchlistEntry, WatchlistResponse } from "@/api/types";
import { nextSelection } from "@/domain/market";

const NETWORK_ERROR = "Could not reach the server. Try again.";

/** The server's `error` text for an API failure, or the generic network message. */
function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
}

interface WatchlistState {
  entries: WatchlistEntry[];
  loaded: boolean;
  loadError: string | null;
  selected: string | null;
  /** Held position tickers, pushed in by Terminal; a held selection survives watchlist changes. */
  held: string[];
  /** Store entries in server order and reconcile the selection. */
  setEntries: (entries: WatchlistEntry[]) => void;
  /** Store the held tickers and reconcile the selection. */
  setHeld: (tickers: string[]) => void;
  select: (ticker: string) => void;
  loadWatchlist: () => Promise<void>;
  /** POST /api/watchlist. Resolves to an inline error message, or null on success. */
  addTicker: (raw: string) => Promise<string | null>;
  /** DELETE /api/watchlist/{ticker}. Resolves to an inline error message, or null on success. */
  removeTicker: (ticker: string) => Promise<string | null>;
}

export const useWatchlist = create<WatchlistState>()((set, get) => ({
  entries: [],
  loaded: false,
  loadError: null,
  selected: null,
  held: [],
  setEntries: (entries) =>
    set({
      entries,
      selected: nextSelection(
        entries.map((e) => e.ticker),
        get().selected,
        get().held,
      ),
    }),
  setHeld: (tickers) =>
    set({
      held: tickers,
      selected: nextSelection(
        get().entries.map((e) => e.ticker),
        get().selected,
        tickers,
      ),
    }),
  select: (ticker) => set({ selected: ticker }),
  loadWatchlist: async () => {
    try {
      const data = await apiFetch<WatchlistResponse>("/api/watchlist");
      get().setEntries(data.tickers);
      set({ loaded: true, loadError: null });
    } catch (err) {
      // Same wording as add/remove: the server's error text, or the generic network message.
      set({ loaded: true, loadError: failureMessage(err) });
    }
  },
  addTicker: async (raw) => {
    const ticker = sanitizeTickerInput(raw);
    const invalid = tickerError(ticker);
    if (invalid) return invalid;
    try {
      const entry = await apiFetch<WatchlistEntry>("/api/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker }),
      });
      // Read entries after the await: the list may have changed while the request ran.
      const { entries, setEntries } = get();
      // A 200 re-add returns the existing entry; the row is already shown.
      if (!entries.some((e) => e.ticker === entry.ticker)) setEntries([...entries, entry]);
      return null;
    } catch (err) {
      return failureMessage(err);
    }
  },
  removeTicker: async (ticker) => {
    const drop = () => {
      const { entries, setEntries } = get();
      // setEntries reconciles the selection: removing the selected ticker selects the first
      // remaining one, or none when the list is empty (MD-07).
      setEntries(entries.filter((e) => e.ticker !== ticker));
    };
    try {
      await apiFetch<void>(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" });
      drop();
      return null;
    } catch (err) {
      // 404: the server already lacks it, so the row is stale.
      if (err instanceof ApiError && err.status === 404) {
        drop();
        return null;
      }
      return failureMessage(err);
    }
  },
}));
