// RED scaffold: exports exist so the tests fail on assertions, not on imports.
import type { Time, UTCTimestamp } from "lightweight-charts";

import type { HistoryPoint } from "@/api/types";

export const CHART_THEME = {
  line: "",
  top: "",
  bottom: "",
  background: "",
  text: "",
  grid: "",
  openLine: "",
} as const;

export function toSeriesData(points: readonly HistoryPoint[]): { time: UTCTimestamp; value: number }[] {
  void points;
  return [];
}

export function isNewer(time: number, lastTime: number): boolean {
  void time;
  void lastTime;
  return false;
}

export function formatLocalTime(time: Time): string {
  void time;
  return "";
}
