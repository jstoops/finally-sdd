"use client";

// Positions table (PF-06): every held position valued at the streamed price, recomputed on
// each SSE frame from stored positions x ticks (PLAN §10 Data Flow; no polling). A row click
// charts the ticker, including a held but unwatched one (MD-08).
import { useMemo } from "react";

import { formatPct, formatPrice } from "@/domain/market";
import {
  formatQty,
  formatSignedMoney,
  type LiveRow,
  livePortfolio,
  moneySign,
  pctSign,
} from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

const CHG_CLASS = { up: "text-up", down: "text-down", flat: "text-muted" } as const;

const NUM = "px-2 text-right tabular-nums";

function PositionRow({
  row,
  selected,
}: {
  row: LiveRow;
  selected: boolean;
}) {
  const { ticker } = row;
  const pnlSign = moneySign(row.unrealized_pnl);
  const pctSignValue = pctSign(row.unrealized_pnl_percent);

  return (
    <tr
      data-testid={`position-row-${ticker}`}
      aria-selected={selected}
      onClick={() => useWatchlist.getState().select(ticker)}
      className={`h-6 cursor-pointer border-l-2 hover:bg-white/5 ${
        selected ? "border-primary bg-primary/10" : "border-transparent"
      }`}
    >
      <td className="px-2">
        <button
          type="button"
          data-testid={`position-select-${ticker}`}
          className="font-semibold text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
        >
          {ticker}
        </button>
      </td>
      <td data-testid={`position-qty-${ticker}`} className={`${NUM} text-text`}>
        {formatQty(row.quantity)}
      </td>
      <td data-testid={`position-avg-${ticker}`} className={`${NUM} text-text`}>
        {formatPrice(row.avg_cost)}
      </td>
      <td data-testid={`position-price-${ticker}`} className={`${NUM} text-text`}>
        {formatPrice(row.current_price)}
      </td>
      <td
        data-testid={`position-pnl-${ticker}`}
        data-sign={pnlSign}
        className={`${NUM} ${CHG_CLASS[pnlSign]}`}
      >
        {formatSignedMoney(row.unrealized_pnl)}
      </td>
      <td
        data-testid={`position-pnlpct-${ticker}`}
        data-sign={pctSignValue}
        className={`${NUM} ${CHG_CLASS[pctSignValue]}`}
      >
        {formatPct(row.unrealized_pnl_percent)}
      </td>
    </tr>
  );
}

export function PositionsTable() {
  // Raw-field selectors only; rows derive through useMemo so no selector returns a new array
  // or object per call (Pitfall 8).
  const cash = usePortfolio((s) => s.cash);
  const positions = usePortfolio((s) => s.positions);
  const ticks = usePrices((s) => s.ticks);
  const selected = useWatchlist((s) => s.selected);
  const rows = useMemo(
    () => livePortfolio(cash ?? 0, positions, ticks).rows,
    [cash, positions, ticks],
  );

  return (
    <section
      data-testid="panel-positions"
      className="flex min-h-0 flex-col border border-border bg-panel"
    >
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Positions
      </h2>
      <div className="min-h-0 flex-1 overflow-auto">
        <table data-testid="positions-table" className="w-full font-mono text-xs">
          <thead className="sticky top-0 bg-panel text-muted">
            <tr className="h-6">
              <th scope="col" className="px-2 text-left font-normal">
                Ticker
              </th>
              <th scope="col" className="px-2 text-right font-normal">
                Qty
              </th>
              <th scope="col" className="px-2 text-right font-normal">
                Avg Cost
              </th>
              <th scope="col" className="px-2 text-right font-normal">
                Price
              </th>
              <th scope="col" className="px-2 text-right font-normal">
                P&L
              </th>
              <th scope="col" className="px-2 text-right font-normal">
                P&L %
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PositionRow key={row.ticker} row={row} selected={row.ticker === selected} />
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p data-testid="positions-empty" className="px-2 py-3 text-center text-xs text-muted">
            No positions yet
          </p>
        )}
      </div>
    </section>
  );
}
