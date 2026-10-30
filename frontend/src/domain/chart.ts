// Pure helpers for the main price chart (MD-06, D-09). Chart times are the Unix float
// seconds from the history endpoint and the SSE stream, passed through unchanged; local
// display comes only from formatLocalTime, never from shifting the timestamps.
import type { BaselineStyleOptions, Time, UTCTimestamp } from "lightweight-charts";

import type { HistoryPoint } from "@/api/types";

export const CHART_THEME = {
  line: "#209dd7",
  top: "rgba(32,157,215,0.35)",
  bottom: "rgba(32,157,215,0)",
  background: "#1a1a2e",
  text: "#8b949e",
  grid: "rgba(48,54,61,0.6)",
  openLine: "#8b949e",
} as const;

// Mirrors --color-up / --color-down in src/app/globals.css; used only when a variable cannot
// be read (unit tests, or a stylesheet without the token).
export const PNL_TOKEN_FALLBACK = {
  up: "#22c55e",
  down: "#ef4444",
} as const;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A CSS custom property as a 3- or 6-digit hex color, or `fallback` for anything else. */
export function readColorToken(
  style: Pick<CSSStyleDeclaration, "getPropertyValue">,
  name: string,
  fallback: string,
): string {
  const value = style.getPropertyValue(name).trim();
  return HEX_COLOR.test(value) ? value : fallback;
}

/** `#rgb` or `#rrggbb` as `rgba(r,g,b,a)` with no spaces. */
export function hexToRgba(hex: string, alpha: number): string {
  let digits = hex.slice(1);
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join("");
  const channel = (i: number) => parseInt(digits.slice(i, i + 2), 16);
  return `rgba(${channel(0)},${channel(2)},${channel(4)},${alpha})`;
}

export type PnlSeriesColors = Pick<
  BaselineStyleOptions,
  | "topLineColor"
  | "topFillColor1"
  | "topFillColor2"
  | "bottomLineColor"
  | "bottomFillColor1"
  | "bottomFillColor2"
>;

/** The P&L BaselineSeries colors: `up` above the base value, `down` below it. */
export function pnlSeriesColors(up: string, down: string): PnlSeriesColors {
  return {
    topLineColor: up,
    topFillColor1: hexToRgba(up, 0.28),
    topFillColor2: hexToRgba(up, 0.05),
    bottomLineColor: down,
    bottomFillColor1: hexToRgba(down, 0.05),
    bottomFillColor2: hexToRgba(down, 0.28),
  };
}

export interface SeriesPoint {
  time: UTCTimestamp;
  value: number;
}

/** History points as chart data, keeping only strictly increasing times. */
export function toSeriesData(points: readonly HistoryPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let last = -Infinity;
  for (const p of points) {
    if (!Number.isFinite(p.timestamp) || !Number.isFinite(p.price)) continue;
    if (!isNewer(p.timestamp, last)) continue;
    out.push({ time: p.timestamp as UTCTimestamp, value: p.price });
    last = p.timestamp;
  }
  return out;
}

/** `series.update` throws on an older time, so only strictly newer points are appended. */
export function isNewer(time: number, lastTime: number): boolean {
  return time > lastTime;
}

// Browser locale, 24-hour clock. hourCycle h23 avoids "24:00:00" that hour12:false gives
// in some locales at midnight.
const localTime = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Local HH:MM:SS for a chart time in Unix seconds (axis tick marks and crosshair). */
export function formatLocalTime(time: Time): string {
  return typeof time === "number" ? localTime.format(new Date(time * 1000)) : String(time);
}
