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
  /** Store entries in server order and reconcile the selection. */
  setEntries: (entries: WatchlistEntry[]) => void;
  select: (ticker: string) => void;
  loadWatchlist: () => Promise<void>;
  /** POST /api/watchlist. Resolves to an inline error message, or null on success. */
  addTicker: (raw: string) => Promise<string | null>;
}

export const useWatchlist = create<WatchlistState>()((set, get) => ({
  entries: [],
  loaded: false,
  loadError: null,
  selected: null,
  setEntries: (entries) =>
    set({
      entries,
      selected: nextSelection(
        entries.map((e) => e.ticker),
        get().selected,
      ),
    }),
  select: (ticker) => set({ selected: ticker }),
  loadWatchlist: async () => {
    try {
      const data = await apiFetch<WatchlistResponse>("/api/watchlist");
      get().setEntries(data.tickers);
      set({ loaded: true, loadError: null });
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Could not load watchlist";
      set({ loaded: true, loadError: message });
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
}));
