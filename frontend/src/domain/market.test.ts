import { describe, expect, it } from "vitest";

import {
  chgPercent,
  formatPct,
  formatPrice,
  nextSelection,
  signOf,
  sparkPoints,
} from "@/domain/market";

function parsePoints(points: string): [number, number][] {
  return points
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(",").map(Number) as [number, number]);
}

describe("chgPercent", () => {
  it("is the move since session open in percent", () => {
    expect(chgPercent(190.52, 190)).toBeCloseTo(0.27368, 4);
  });

  it("is 0 when price equals open", () => {
    expect(chgPercent(190, 190)).toBe(0);
  });

  it("is null when open is missing or not positive, or price is missing", () => {
    expect(chgPercent(1, null)).toBeNull();
    expect(chgPercent(1, undefined)).toBeNull();
    expect(chgPercent(1, 0)).toBeNull();
    expect(chgPercent(1, -5)).toBeNull();
    expect(chgPercent(null, 1)).toBeNull();
  });

  it("uses unrounded inputs (no pre-rounding of the ratio)", () => {
    // 100.005 vs 100: 0.005% exactly, which would be 0 if price were rounded first.
    expect(chgPercent(100.005, 100)).toBeCloseTo(0.005, 6);
  });
});

describe("formatPct", () => {
  it("adds a sign and exactly two decimals", () => {
    expect(formatPct(0.2737)).toBe("+0.27%");
    expect(formatPct(-1.5)).toBe("-1.50%");
    expect(formatPct(0)).toBe("+0.00%");
    expect(formatPct(1234.5)).toBe("+1,234.50%");
  });

  it("renders an em dash for null", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
  });
});

describe("formatPrice", () => {
  it("uses en-US grouping and exactly two decimals", () => {
    expect(formatPrice(1234.5)).toBe("1,234.50");
    expect(formatPrice(190)).toBe("190.00");
    expect(formatPrice(0.125)).toBe("0.13");
  });

  it("renders an em dash for null", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
  });
});

describe("signOf", () => {
  it("classifies zero as flat and the sign otherwise", () => {
    expect(signOf(0)).toBe("flat");
    expect(signOf(0.01)).toBe("up");
    expect(signOf(-0.01)).toBe("down");
  });

  it("treats null as flat", () => {
    expect(signOf(null)).toBe("flat");
  });
});

describe("sparkPoints", () => {
  it("returns an empty string for no points", () => {
    expect(sparkPoints([], 64, 18)).toBe("");
  });

  it("draws one point as a flat line at mid-height", () => {
    const pts = parsePoints(sparkPoints([5], 64, 18));
    expect(pts.length).toBeGreaterThanOrEqual(1);
    for (const [, y] of pts) expect(y).toBe(9);
  });

  it("draws equal values as a flat line at mid-height (no divide by zero)", () => {
    const pts = parsePoints(sparkPoints([5, 5, 5], 64, 18));
    expect(pts).toHaveLength(3);
    for (const [x, y] of pts) {
      expect(Number.isFinite(x)).toBe(true);
      expect(y).toBe(9);
    }
  });

  it("spans the width and puts the minimum at the bottom", () => {
    const pts = parsePoints(sparkPoints([1, 2], 64, 18));
    expect(pts[0][0]).toBe(0);
    expect(pts[pts.length - 1][0]).toBe(64);
    expect(pts[0][1]).toBe(18); // min at the bottom
    expect(pts[1][1]).toBe(0); // max at the top
  });
});

describe("nextSelection", () => {
  it("selects the first ticker on load", () => {
    expect(nextSelection(["AAPL", "MSFT"], null)).toBe("AAPL");
  });

  it("keeps a selection that is still listed", () => {
    expect(nextSelection(["AAPL", "MSFT"], "MSFT")).toBe("MSFT");
  });

  it("falls back to the first remaining ticker", () => {
    expect(nextSelection(["MSFT"], "AAPL")).toBe("MSFT");
  });

  it("is null for an empty watchlist", () => {
    expect(nextSelection([], "AAPL")).toBeNull();
    expect(nextSelection([], null)).toBeNull();
  });

  it("keeps a held but unwatched selection", () => {
    expect(nextSelection(["AAPL", "MSFT"], "TSLA", ["TSLA"])).toBe("TSLA");
  });

  it("falls back to the first watchlist ticker once the selection is neither watched nor held", () => {
    expect(nextSelection(["AAPL"], "TSLA", [])).toBe("AAPL");
    expect(nextSelection([], "TSLA", [])).toBeNull();
  });

  it("never picks a held ticker as the fallback", () => {
    expect(nextSelection([], null, ["TSLA"])).toBeNull();
    expect(nextSelection(["AAPL"], null, ["TSLA"])).toBe("AAPL");
  });

  it("keeps the two-argument behavior", () => {
    expect(nextSelection(["AAPL"], "MSFT")).toBe("AAPL");
  });
});
