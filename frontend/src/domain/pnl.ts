// Pure helper for the P&L chart (PF-08). Snapshot times are ISO 8601 UTC strings with
// one-second precision, so a trade snapshot and a 30 s snapshot can share a second;
// Lightweight Charts' setData asserts strictly ascending times (Pitfall 6).
import type { UTCTimestamp } from "lightweight-charts";

import type { Snapshot } from "@/api/types";
import type { SeriesPoint } from "@/domain/chart";

/**
 * Snapshots as chart data: ISO times floored to Unix seconds, non-finite values skipped,
 * a time earlier than the last kept one dropped, and equal seconds collapsed to the last value.
 */
export function toSnapshotSeries(snaps: readonly Snapshot[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const s of snaps) {
    const time = Math.floor(Date.parse(s.recorded_at) / 1000);
    if (!Number.isFinite(time) || !Number.isFinite(s.total_value)) continue;
    const last = out[out.length - 1];
    if (last && time < last.time) continue;
    if (last && time === last.time) {
      last.value = s.total_value;
      continue;
    }
    out.push({ time: time as UTCTimestamp, value: s.total_value });
  }
  return out;
}
