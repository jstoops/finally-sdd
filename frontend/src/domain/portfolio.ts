// Pure portfolio display rules: starting cash, quantity and money formatting, and the live
// valuation that combines stored positions with streamed prices (PLAN §10 Data Flow).
import type { Position } from "@/api/types";
import { formatPrice, type Sign, signOf } from "@/domain/market";

/** Seeded cash balance (PLAN §7); the baseline for P&L since start. */
export const STARTING_CASH = 10000;

const EM_DASH = "—";

// Fixed locale so prerendered markup and the browser agree (no hydration mismatch).
const qtyFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

/** Share quantity with up to 4 decimals, trailing zeros trimmed: 10 -> "10", 0.5 -> "0.5". */
export function formatQty(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? qtyFormat.format(n) : EM_DASH;
}

/** Dollar amount: "$1,234.50", or "-$12.50" with the minus sign before the "$". */
export function formatMoney(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return EM_DASH;
  const text = formatPrice(Math.abs(n));
  // A value that rounds to $0.00 is never shown as "-$0.00".
  return n < 0 && text !== "0.00" ? `-$${text}` : `$${text}`;
}

/**
 * Nudge added in cent units before flooring (assumption P-1). It is above double-precision
 * error for these amounts and below the 1e-8-dollar spacing of exact 4 dp x 4 dp products,
 * so the result matches the server's exact Decimal half-up.
 */
const CENT_NUDGE = 1e-7;

/**
 * Round a dollar amount half away from zero to cents, as the server's Decimal ROUND_HALF_UP
 * does: 0.125 -> 0.13, 2.675 -> 2.68, -0.125 -> -0.13. Never returns -0.
 */
export function toCents(n: number): number {
  if (!Number.isFinite(n)) return n;
  const cents = Math.floor(Math.abs(n) * 100 + 0.5 + CENT_NUDGE);
  if (cents === 0) return 0;
  return (n < 0 ? -cents : cents) / 100;
}

/** A position valued at the live price. */
export type LiveRow = Position;

export interface LivePortfolio {
  cash: number;
  positionsValue: number;
  total: number;
  /** total - STARTING_CASH, in cents. */
  pnlSinceStart: number;
  rows: LiveRow[];
}

/**
 * Value stored positions at streamed prices: each row's price is its tick price, else the
 * server's current_price (which already falls back to the served avg_cost). Market value and
 * P&L are cent-rounded per row and the totals sum those rounded values, mirroring the server's
 * value_portfolio so the header matches it to the cent.
 */
export function livePortfolio(
  cash: number,
  positions: readonly Position[],
  ticks: Readonly<Record<string, { price: number } | undefined>>,
): LivePortfolio {
  const priced = positions.map((p) => {
    const price = ticks[p.ticker]?.price ?? p.current_price;
    const avg = p.avg_cost;
    return {
      ...p,
      current_price: price,
      market_value: toCents(p.quantity * price),
      unrealized_pnl: toCents((price - avg) * p.quantity),
      unrealized_pnl_percent: avg > 0 ? ((price - avg) / avg) * 100 : 0,
    };
  });
  const positionsValue = toCents(priced.reduce((sum, r) => sum + r.market_value, 0));
  const rows = priced.map((r) => ({
    ...r,
    weight: positionsValue > 0 ? r.market_value / positionsValue : 0,
  }));
  const total = toCents(cash + positionsValue);
  return {
    cash,
    positionsValue,
    total,
    pnlSinceStart: toCents(total - STARTING_CASH),
    rows,
  };
}

/** Sign of a money amount after rounding to cents, so -0.004 is flat. */
export function moneySign(n: number | null | undefined): Sign {
  return typeof n === "number" ? signOf(toCents(n)) : "flat";
}

/** Sign of a percent after rounding to 2 dp, so 0.004 is flat and -0.006 is down. */
export function pctSign(n: number | null | undefined): Sign {
  return typeof n === "number" ? signOf(toCents(n)) : "flat";
}

/** Money with an explicit sign: "+$12.35", "-$5.00", and "+$0.00" for anything under a cent. */
export function formatSignedMoney(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return EM_DASH;
  const cents = toCents(n);
  return `${cents < 0 ? "-" : "+"}$${formatPrice(Math.abs(cents))}`;
}
