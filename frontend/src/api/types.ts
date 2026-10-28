// Frozen wire contract for Phases 1 and 2 (PLAN §6 SSE payload, PLAN §8 REST shapes).
// Keys match the backend exactly; do not rename. Every Phase 2 shape is frozen here up
// front so the parallel Phase 2 plans share one contract.

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

/** One GET /api/portfolio position. `unrealized_pnl_percent` is already in percent units. */
export interface Position {
  ticker: string;
  quantity: number;
  /** Served at 4 dp; P&L is computed from this value. */
  avg_cost: number;
  /** Falls back to avg_cost when the ticker has no cached price. */
  current_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_percent: number;
  /** market_value / positions_value, sizes heatmap tiles. */
  weight: number;
}

/** GET /api/portfolio (also the `portfolio` of a trade response). */
export interface Portfolio {
  cash_balance: number;
  positions_value: number;
  total_value: number;
  unrealized_pnl: number;
  positions: Position[];
}

export type Side = "buy" | "sell";

/** POST /api/portfolio/trade body. There is no price: fills use the server's cached price. */
export interface TradeRequest {
  ticker: string;
  quantity: number;
  side: Side;
}

export interface Trade {
  id: string;
  ticker: string;
  side: Side;
  quantity: number;
  price: number;
  /** ISO 8601 UTC */
  executed_at: string;
}

/** POST /api/portfolio/trade 200 body. */
export interface TradeResponse {
  trade: Trade;
  portfolio: Portfolio;
}

/** GET /api/trades (TRD-10 extra; not in PLAN §8). Newest first. */
export interface TradesResponse {
  trades: Trade[];
}

export interface Snapshot {
  total_value: number;
  /** ISO 8601 UTC */
  recorded_at: string;
}

/** GET /api/portfolio/history, oldest first. */
export interface SnapshotsResponse {
  snapshots: Snapshot[];
}

/** POST /api/reset 200 body. */
export interface ResetResponse {
  status: "ok";
}

/** Error envelope for 400 / 404 responses (PLAN §8). */
export interface ApiErrorBody {
  error: string;
}
