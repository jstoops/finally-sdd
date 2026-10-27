// Frozen wire contract for Phase 1 (PLAN §6 SSE payload, PLAN §8 REST shapes).
// Keys match the backend exactly; do not rename.

export type Direction = "up" | "down" | "flat";

/** One ticker in an SSE frame. `timestamp` is Unix seconds (float). */
export interface PriceTick {
  ticker: string;
  price: number;
  previous_price: number;
  open_price: number;
  timestamp: number;
  change: number;
  change_percent: number;
  direction: Direction;
}

/** One SSE `data:` event: every tracked ticker, keyed by ticker. */
export type PriceFrame = Record<string, PriceTick>;

/** connecting = yellow, open = green, closed = red. */
export type StreamStatus = "connecting" | "open" | "closed";

/** GET /api/watchlist entry. Prices are null until the first price arrives. */
export interface WatchlistEntry {
  ticker: string;
  price: number | null;
  open_price: number | null;
  /** ISO 8601 UTC */
  added_at: string;
}

export interface WatchlistResponse {
  tickers: WatchlistEntry[];
}

/** GET /api/prices/{ticker}/history point. `timestamp` is Unix seconds. */
export interface HistoryPoint {
  timestamp: number;
  price: number;
}

export interface HistoryResponse {
  ticker: string;
  points: HistoryPoint[];
}

/** Error envelope for 400 / 404 responses (PLAN §8). */
export interface ApiErrorBody {
  error: string;
}
