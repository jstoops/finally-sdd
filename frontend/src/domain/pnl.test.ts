import { describe, expect, it } from "vitest";

import type { Snapshot } from "@/api/types";
import { toSnapshotSeries } from "@/domain/pnl";

function snap(recorded_at: string, total_value: number): Snapshot {
  return { total_value, recorded_at };
}

describe("toSnapshotSeries", () => {
  it("returns no points for no snapshots", () => {
    expect(toSnapshotSeries([])).toEqual([]);
  });

  it("converts one snapshot to one point in Unix seconds", () => {
    const iso = "2026-10-09T14:00:00Z";
    expect(toSnapshotSeries([snap(iso, 10000)])).toEqual([
      { time: Date.parse(iso) / 1000, value: 10000 },
    ]);
  });

  it("collapses two snapshots in the same second into one point with the later value", () => {
    const series = toSnapshotSeries([
      snap("2026-10-09T14:00:00Z", 10000),
      snap("2026-10-09T14:00:00Z", 10012.5),
    ]);
    expect(series).toEqual([{ time: Date.parse("2026-10-09T14:00:00Z") / 1000, value: 10012.5 }]);
  });

  it("drops a snapshot earlier than the previous kept one", () => {
    const series = toSnapshotSeries([
      snap("2026-10-09T14:00:30Z", 10001),
      snap("2026-10-09T14:00:00Z", 10002),
    ]);
    expect(series).toEqual([{ time: Date.parse("2026-10-09T14:00:30Z") / 1000, value: 10001 }]);
  });

  it("skips a non-finite total or an unparseable time", () => {
    const series = toSnapshotSeries([
      snap("not a time", 10000),
      snap("2026-10-09T14:00:00Z", Number.NaN),
      snap("2026-10-09T14:00:01Z", Number.POSITIVE_INFINITY),
      snap("2026-10-09T14:00:02Z", 9990),
    ]);
    expect(series).toEqual([{ time: Date.parse("2026-10-09T14:00:02Z") / 1000, value: 9990 }]);
  });

  it("floors fractional seconds and always yields strictly ascending times", () => {
    const series = toSnapshotSeries([
      snap("2026-10-09T14:00:00.400Z", 1),
      snap("2026-10-09T14:00:00.900Z", 2),
      snap("2026-10-09T14:00:30Z", 3),
      snap("2026-10-09T14:00:10Z", 4),
      snap("2026-10-09T14:01:00Z", 5),
    ]);
    expect(series.map((p) => p.value)).toEqual([2, 3, 5]);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].time).toBeGreaterThan(series[i - 1].time);
    }
    expect(series[0].time).toBe(Date.parse("2026-10-09T14:00:00Z") / 1000);
  });
});
