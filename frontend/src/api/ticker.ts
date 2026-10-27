// Client ticker rule (D-08). This is the only client copy of the PLAN §7 pattern; the server's
// normalize_ticker stays authoritative, so this check is UX only.

/** PLAN §7: 1-10 chars, a letter first, then letters, digits or '.'. */
export const TICKER_RE = /^[A-Z][A-Z0-9.]{0,9}$/;

/** Anything outside printable ASCII (space to tilde). */
const NON_ASCII_RE = /[^ -~]/;

/**
 * Normalize typed text as the user types: drop all whitespace and uppercase ASCII letters.
 * Non-ASCII characters are left as typed so `tickerError` can reject them; `toUpperCase`
 * would otherwise fold some of them into ASCII (the German sharp s becomes "SS").
 */
export function sanitizeTickerInput(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/[a-z]+/g, (s) => s.toUpperCase());
}

/** Null when `symbol` is a valid ticker, otherwise the inline message to show. */
export function tickerError(symbol: string): string | null {
  const trimmed = symbol.trim();
  if (!trimmed) return "Enter a ticker symbol.";
  if (NON_ASCII_RE.test(trimmed) || !TICKER_RE.test(trimmed.toUpperCase())) {
    return "Use 1-10 letters, digits or '.', starting with a letter.";
  }
  return null;
}
