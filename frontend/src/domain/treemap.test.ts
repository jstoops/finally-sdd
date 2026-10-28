import { describe, expect, it } from "vitest";

import { squarify, type Tile, type TreemapInput } from "@/domain/treemap";

const W = 16;
const H = 9;

/** Deterministic pseudo-random values (mulberry32), so failures reproduce. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const area = (t: Tile) => t.w * t.h;
const areaByKey = (tiles: Tile[]) => Object.fromEntries(tiles.map((t) => [t.key, area(t)]));

describe("squarify", () => {
  it("returns [] for empty input", () => {
    expect(squarify([], W, H)).toEqual([]);
  });

  it("returns [] when no value is a finite number above zero", () => {
    expect(
      squarify(
        [
          { key: "Z", value: 0 },
          { key: "N", value: -5 },
          { key: "X", value: Number.NaN },
          { key: "I", value: Number.POSITIVE_INFINITY },
        ],
        W,
        H,
      ),
    ).toEqual([]);
  });

  it("returns [] for a zero-width or zero-height box", () => {
    const items = [{ key: "A", value: 5 }];
    expect(squarify(items, 0, H)).toEqual([]);
    expect(squarify(items, W, 0)).toEqual([]);
  });

  it("fills the whole box with a single item", () => {
    expect(squarify([{ key: "A", value: 5 }], W, H)).toEqual([{ key: "A", x: 0, y: 0, w: 16, h: 9 }]);
  });

  it.each([1, 2, 3, 4, 5])("keeps the layout invariants for 6 random values (seed %i)", (seed) => {
    const rand = seeded(seed);
    const items: TreemapInput[] = Array.from({ length: 6 }, (_, i) => ({
      key: `K${i}`,
      value: 1 + rand() * 99,
    }));
    const tiles = squarify(items, W, H);
    expect(tiles).toHaveLength(6);

    const total = tiles.reduce((sum, t) => sum + area(t), 0);
    expect(Math.abs(total - W * H)).toBeLessThan(1e-6);

    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(W + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(H + 1e-9);
    }

    const valueSum = items.reduce((sum, i) => sum + i.value, 0);
    const areas = areaByKey(tiles);
    for (const item of items) {
      expect(areas[item.key]).toBeCloseTo((item.value / valueSum) * W * H, 9);
    }
  });

  it("counts only the positive values among mixed input", () => {
    const tiles = squarify(
      [
        { key: "A", value: 3 },
        { key: "Z", value: 0 },
        { key: "B", value: 1 },
        { key: "N", value: -2 },
      ],
      W,
      H,
    );
    expect(tiles.map((t) => t.key).sort()).toEqual(["A", "B"]);
  });

  it("gives each key the same area whatever the input order of equal values", () => {
    const items: TreemapInput[] = [
      { key: "A", value: 3 },
      { key: "B", value: 3 },
      { key: "C", value: 3 },
      { key: "D", value: 1 },
    ];
    const forward = areaByKey(squarify(items, W, H));
    const reversed = areaByKey(squarify([...items].reverse(), W, H));
    for (const key of ["A", "B", "C", "D"]) {
      expect(reversed[key]).toBeCloseTo(forward[key], 9);
    }
  });
});
