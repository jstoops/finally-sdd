// Pure portfolio display rules: starting cash, quantity and money formatting.
// Plan 02-03 adds the live valuation helpers here.
import { formatPrice } from "@/domain/market";

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
