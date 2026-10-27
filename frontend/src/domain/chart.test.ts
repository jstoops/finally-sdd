import type { UTCTimestamp } from "lightweight-charts";
import { describe, expect, it } from "vitest";

import { CHART_THEME, formatLocalTime, isNewer, toSeriesData } from "@/domain/chart";

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
