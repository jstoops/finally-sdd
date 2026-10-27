// RED stub: signatures only, so the tests load and fail on their assertions.
export const TICKER_RE = /^$/;

export function sanitizeTickerInput(raw: string): string {
  return raw;
}

export function tickerError(symbol: string): string | null {
  void symbol;
  return null;
}
