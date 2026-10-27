// Pure helpers for the main price chart (MD-06, D-09). Chart times are the Unix float
// seconds from the history endpoint and the SSE stream, passed through unchanged; local
// display comes only from formatLocalTime, never from shifting the timestamps.
import type { Time, UTCTimestamp } from "lightweight-charts";

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
