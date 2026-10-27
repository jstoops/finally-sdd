// Watchlist entries (GET /api/watchlist, added_at order) and the selected ticker (MD-07).
import { create } from "zustand";

import { apiFetch } from "@/api/client";
import type { WatchlistEntry, WatchlistResponse } from "@/api/types";
import { nextSelection } from "@/domain/market";

interface WatchlistState {
  entries: WatchlistEntry[];
  loaded: boolean;
  loadError: string | null;
  selected: string | null;
  /** Store entries in server order and reconcile the selection. */
  setEntries: (entries: WatchlistEntry[]) => void;
  select: (ticker: string) => void;
  loadWatchlist: () => Promise<void>;
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
}));
