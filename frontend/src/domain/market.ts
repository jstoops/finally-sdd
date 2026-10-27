// Pure market display rules: Chg % since session open (PLAN §6), fixed-locale
// formatting, sparkline geometry and watchlist selection (MD-02, MD-05, MD-07).

export type Sign = "up" | "down" | "flat";

const EM_DASH = "—";

// Fixed locale so prerendered markup and the browser agree (no hydration mismatch).
const twoDecimals = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Percent move since session open, or null when either value is missing or open <= 0. */
export function chgPercent(
  price: number | null | undefined,
  open: number | null | undefined,
): number | null {
  if (typeof price !== "number" || typeof open !== "number") return null;
  if (!Number.isFinite(price) || !Number.isFinite(open) || open <= 0) return null;
  return ((price - open) / open) * 100;
}

export function formatPrice(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? twoDecimals.format(n) : EM_DASH;
}

/** Signed percent with two decimals, e.g. "+0.27%", "-1.50%", "+0.00%". */
export function formatPct(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return EM_DASH;
  const formatted = twoDecimals.format(n);
  // "-0.00" would read as a loss; a value that rounds to zero is shown as "+0.00%".
  if (formatted === "-0.00") return "+0.00%";
  return n >= 0 ? `+${formatted}%` : `${formatted}%`;
}

export function signOf(n: number | null | undefined): Sign {
  if (typeof n !== "number" || n === 0 || !Number.isFinite(n)) return "flat";
  return n > 0 ? "up" : "down";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SVG polyline `points` for a sparkline in a width x height box. Higher values sit higher.
 * Empty input gives ""; a single point or a flat series is a line at mid-height.
 */
export function sparkPoints(values: readonly number[], width: number, height: number): string {
  if (values.length === 0) return "";
  const mid = height / 2;
  if (values.length === 1) return `0,${round2(mid)} ${round2(width)},${round2(mid)}`;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const step = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = i * step;
      const y = range === 0 ? mid : height - ((v - min) / range) * height;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}

/** Keep the selection while it is listed; otherwise the first ticker, or null when empty. */
export function nextSelection(tickers: readonly string[], selected: string | null): string | null {
  if (selected !== null && tickers.includes(selected)) return selected;
  return tickers[0] ?? null;
}
