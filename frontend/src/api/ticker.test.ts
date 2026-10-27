import { describe, expect, it } from "vitest";

import { sanitizeTickerInput, TICKER_RE, tickerError } from "@/api/ticker";

const FORMAT = "Use 1-10 letters, digits or '.', starting with a letter.";

describe("TICKER_RE", () => {
  it("is the PLAN §7 ticker pattern", () => {
    expect(TICKER_RE.source).toBe("^[A-Z][A-Z0-9.]{0,9}$");
  });
});

describe("sanitizeTickerInput", () => {
  it("trims and uppercases", () => {
    expect(sanitizeTickerInput(" brk.b ")).toBe("BRK.B");
  });

  it("removes inner whitespace", () => {
    expect(sanitizeTickerInput("a a p l")).toBe("AAPL");
  });

  it("does not fold non-ASCII letters into ASCII", () => {
    expect(sanitizeTickerInput("ß")).not.toBe("SS");
  });
});

describe("tickerError", () => {
  it.each(["AAPL", "BRK.B", "A", "ABCDEFGHIJ"])("accepts %s", (symbol) => {
    expect(tickerError(symbol)).toBeNull();
  });

  it("asks for a symbol when empty", () => {
    expect(tickerError("")).toBe("Enter a ticker symbol.");
  });

  it.each(["1ABC", "AAPL!", "ABCDEFGHIJK", ".A"])("rejects %s with the format message", (symbol) => {
    expect(tickerError(symbol)).toBe(FORMAT);
  });

  it("rejects a German sharp s instead of accepting it as SS", () => {
    expect(tickerError("ß")).toBe(FORMAT);
    expect(tickerError("STRAßE")).toBe(FORMAT);
  });
});
