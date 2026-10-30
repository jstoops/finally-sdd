import type { UTCTimestamp } from "lightweight-charts";
import { describe, expect, it } from "vitest";

import {
  CHART_THEME,
  formatLocalTime,
  hexToRgba,
  isNewer,
  PNL_TOKEN_FALLBACK,
  pnlSeriesColors,
  readColorToken,
  toSeriesData,
} from "@/domain/chart";

describe("toSeriesData", () => {
  it("maps Unix float seconds to chart times unchanged", () => {
    expect(
      toSeriesData([
        { timestamp: 100.5, price: 1 },
        { timestamp: 101.0, price: 2 },
      ]),
    ).toEqual([
      { time: 100.5, value: 1 },
      { time: 101, value: 2 },
    ]);
  });

  it("drops a point whose time is not strictly newer than the previous one", () => {
    expect(
      toSeriesData([
        { timestamp: 100, price: 1 },
        { timestamp: 100, price: 9 },
        { timestamp: 99, price: 8 },
        { timestamp: 101, price: 2 },
      ]),
    ).toEqual([
      { time: 100, value: 1 },
      { time: 101, value: 2 },
    ]);
  });

  it("returns an empty array for no points", () => {
    expect(toSeriesData([])).toEqual([]);
  });
});

describe("isNewer", () => {
  it("is true only for a strictly later time", () => {
    expect(isNewer(101, 100.5)).toBe(true);
    expect(isNewer(100.5, 100.5)).toBe(false);
    expect(isNewer(99, 100)).toBe(false);
    expect(isNewer(1, -Infinity)).toBe(true);
  });
});

describe("formatLocalTime", () => {
  it("formats Unix seconds as local HH:MM:SS", () => {
    expect(formatLocalTime(0 as UTCTimestamp)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatLocalTime(1760000000.5 as UTCTimestamp)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("uses local wall-clock time, never a pre-shifted timestamp", () => {
    const d = new Date(1760000000 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(formatLocalTime(1760000000 as UTCTimestamp)).toBe(
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    );
  });

  it("stringifies non-numeric times", () => {
    expect(formatLocalTime("2026-10-09")).toBe("2026-10-09");
  });
});

describe("CHART_THEME", () => {
  it("uses the blue primary line with a downward-fading fill (D-09)", () => {
    expect(CHART_THEME.line).toBe("#209dd7");
    expect(CHART_THEME.top).toBe("rgba(32,157,215,0.35)");
    expect(CHART_THEME.bottom).toBe("rgba(32,157,215,0)");
    expect(CHART_THEME.background).toBe("#1a1a2e");
    expect(CHART_THEME.text).toBe("#8b949e");
    expect(CHART_THEME.grid).toBe("rgba(48,54,61,0.6)");
    expect(CHART_THEME.openLine).toBe("#8b949e");
  });
});

function styleOf(value: string): Pick<CSSStyleDeclaration, "getPropertyValue"> {
  return { getPropertyValue: () => value };
}

describe("readColorToken", () => {
  it("returns the trimmed hex value of the property", () => {
    expect(readColorToken(styleOf(" #00ff00 "), "--color-up", "#123456")).toBe("#00ff00");
  });

  it("accepts a 3-digit hex color as written", () => {
    expect(readColorToken(styleOf("#0f0"), "--color-up", "#123456")).toBe("#0f0");
  });

  it.each(["", "   ", "red", "oklch(0.7 0.2 150)", "#12345", "#gggggg"])(
    "falls back for %j",
    (value) => {
      expect(readColorToken(styleOf(value), "--color-up", "#123456")).toBe("#123456");
    },
  );

  it("reads the named property", () => {
    const getPropertyValue = (name: string) => (name === "--color-down" ? "#ff0000" : "");
    expect(readColorToken({ getPropertyValue }, "--color-down", "#123456")).toBe("#ff0000");
    expect(readColorToken({ getPropertyValue }, "--color-up", "#123456")).toBe("#123456");
  });
});

describe("hexToRgba", () => {
  it("converts 6-digit hex with no spaces", () => {
    expect(hexToRgba("#00ff00", 0.28)).toBe("rgba(0,255,0,0.28)");
  });

  it("expands 3-digit hex", () => {
    expect(hexToRgba("#0f0", 0.05)).toBe("rgba(0,255,0,0.05)");
  });
});

describe("pnlSeriesColors", () => {
  it("derives the six baseline colors from the up and down colors", () => {
    expect(pnlSeriesColors("#00ff00", "#ff0000")).toEqual({
      topLineColor: "#00ff00",
      topFillColor1: "rgba(0,255,0,0.28)",
      topFillColor2: "rgba(0,255,0,0.05)",
      bottomLineColor: "#ff0000",
      bottomFillColor1: "rgba(255,0,0,0.05)",
      bottomFillColor2: "rgba(255,0,0,0.28)",
    });
  });

  it("reproduces the previous default look from the token fallbacks", () => {
    expect(PNL_TOKEN_FALLBACK).toEqual({ up: "#22c55e", down: "#ef4444" });
    expect(pnlSeriesColors(PNL_TOKEN_FALLBACK.up, PNL_TOKEN_FALLBACK.down)).toEqual({
      topLineColor: "#22c55e",
      topFillColor1: "rgba(34,197,94,0.28)",
      topFillColor2: "rgba(34,197,94,0.05)",
      bottomLineColor: "#ef4444",
      bottomFillColor1: "rgba(239,68,68,0.05)",
      bottomFillColor2: "rgba(239,68,68,0.28)",
    });
  });
});
