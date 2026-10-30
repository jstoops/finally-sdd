"use client";

// Trade history (TRD-10): recent fills from GET /api/trades, newest first, with a manual fill
// prepended the moment its response arrives. Values are shown exactly as recorded.
import type { UTCTimestamp } from "lightweight-charts";

import type { Trade } from "@/api/types";
import { formatLocalTime } from "@/domain/chart";
import { formatPrice } from "@/domain/market";
import { formatQty } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";

const SIDE_CLASS = { buy: "text-up", sell: "text-down" } as const;

function TradeRow({ trade }: { trade: Trade }) {
  const executed = Date.parse(trade.executed_at);
  return (
    <li
      data-testid="trade-history-row"
      data-side={trade.side}
      className="grid grid-cols-[4.5rem_2.5rem_1fr_3.5rem_1fr] items-center gap-1 border-b border-border/50 px-2 py-0.5"
    >
      <span className="text-muted">
        {Number.isFinite(executed) ? formatLocalTime((executed / 1000) as UTCTimestamp) : "—"}
      </span>
      <span className={`font-semibold ${SIDE_CLASS[trade.side]}`}>
        {trade.side === "buy" ? "BUY" : "SELL"}
      </span>
      <span className="text-right">{formatQty(trade.quantity)}</span>
      <span className="font-semibold text-text">{trade.ticker}</span>
      <span className="text-right">${formatPrice(trade.price)}</span>
    </li>
  );
}

export function TradeHistory() {
  const trades = usePortfolio((s) => s.trades);

  if (trades.length === 0) {
    return (
      <p data-testid="trade-history-empty" className="px-2 py-3 text-center text-xs text-muted">
        No trades yet
      </p>
    );
  }
  return (
    <ul
      data-testid="trade-history"
      className="min-h-0 flex-1 overflow-y-auto font-mono text-xs tabular-nums"
    >
      {trades.map((trade) => (
        <TradeRow key={trade.id} trade={trade} />
      ))}
    </ul>
  );
}
