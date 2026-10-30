// In-house squarified treemap layout for the portfolio heatmap (PF-07, PLAN §10: no charting
// library besides Lightweight Charts). Bruls, Huizing and van Wijk, "Squarified Treemaps"
// (2000): sort values descending and grow a row along the shorter side of the remaining
// rectangle while its worst aspect ratio improves; otherwise lay the row out and continue on
// the rest. Pure: no DOM access and no dependencies.

export interface TreemapInput {
  key: string;
  value: number;
}

/** One laid-out rectangle, in the same units as the width and height passed to squarify. */
export interface Tile {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Cell {
  key: string;
  area: number;
}

/** Worst (largest) aspect ratio of a row of cells laid along a side of the given length. */
function worst(row: readonly Cell[], side: number): number {
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (const c of row) {
    sum += c.area;
    if (c.area > max) max = c.area;
    if (c.area < min) min = c.area;
  }
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/**
 * Lay out items in a width x height box with areas proportional to their values. Items whose
 * value is not a finite number above zero get no tile; an empty result means nothing to draw.
 */
export function squarify(items: readonly TreemapInput[], width: number, height: number): Tile[] {
  const cells = items
    .filter((i) => Number.isFinite(i.value) && i.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = cells.reduce((sum, c) => sum + c.value, 0);
  if (!(total > 0) || !(width > 0) || !(height > 0)) return [];

  const scale = (width * height) / total;
  const queue: Cell[] = cells.map((c) => ({ key: c.key, area: c.value * scale }));
  const out: Tile[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: Cell[] = [];

  const layout = () => {
    const sum = row.reduce((s, c) => s + c.area, 0);
    if (w >= h) {
      // A column on the left, spanning the remaining height.
      const cw = sum / h;
      let cy = y;
      for (const c of row) {
        const ch = c.area / cw;
        out.push({ key: c.key, x, y: cy, w: cw, h: ch });
        cy += ch;
      }
      x += cw;
      w = Math.max(0, w - cw);
    } else {
      // A row on top, spanning the remaining width.
      const rh = sum / w;
      let cx = x;
      for (const c of row) {
        const cw = c.area / rh;
        out.push({ key: c.key, x: cx, y, w: cw, h: rh });
        cx += cw;
      }
      y += rh;
      h = Math.max(0, h - rh);
    }
    row = [];
  };

  for (let i = 0; i < queue.length; ) {
    const side = Math.min(w, h);
    const next = [...row, queue[i]];
    if (row.length === 0 || worst(next, side) <= worst(row, side)) {
      row = next;
      i += 1;
    } else {
      layout();
    }
  }
  if (row.length > 0) layout();
  return out;
}
