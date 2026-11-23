import { describe, expect, it } from "vitest";
import { labelPriority, labelTileZoom, lineLabelAnchor, pickLabels, rotatedExtent, wrapExtent, type LabelBox } from "./labelLayout";

// The pick as it was before the grid: every candidate against every shown box. The grid must answer exactly this.
function pickPairwise(boxes: readonly LabelBox[]): number[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].priority - boxes[b].priority);
  const shown: number[] = [];
  const PAD = 4;
  for (const i of order) {
    const b = boxes[i];
    let free = true;
    for (const j of shown) {
      const o = boxes[j];
      if (Math.abs(b.x - o.x) * 2 < b.w + o.w + 2 * PAD && Math.abs(b.y - o.y) * 2 < b.h + o.h + 2 * PAD) {
        free = false;
        break;
      }
    }
    if (free) shown.push(i);
  }
  return shown;
}

const randomBoxes = (n: number, seed: number, spread = 1600): LabelBox[] => {
  let a = seed >>> 0;
  const rnd = () => ((a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296);
  return Array.from({ length: n }, (_, i) => ({ x: rnd() * spread, y: rnd() * spread * 0.56, w: 10 + rnd() * 150, h: 8 + rnd() * 30, priority: Math.floor(rnd() * 40) + i / 1e6 }));
};

describe("label layout", () => {
  it("reads names from the zoom a web map shows at that scale", () => {
    const mpp14 = (2 * Math.PI * 6378137 * Math.cos((55 * Math.PI) / 180)) / (512 * 2 ** 14);
    expect(labelTileZoom(mpp14 * 0.99, 55)).toBe(14);
    expect(labelTileZoom(mpp14 * 4, 55)).toBe(12);
    expect(labelTileZoom(1e6, 55)).toBe(0);
    expect(labelTileZoom(0.01, 55)).toBe(14);
  });

  it("keeps the important label when two overlap", () => {
    const shown = pickLabels([
      { x: 100, y: 100, w: 60, h: 14, priority: labelPriority("village", 9) },
      { x: 110, y: 104, w: 60, h: 14, priority: labelPriority("city", 2) },
      { x: 300, y: 100, w: 60, h: 14, priority: labelPriority("hamlet", 12) },
    ]);
    expect(shown.sort()).toEqual([1, 2]);
  });
});

// The grid is an implementation of the same greedy pick: every case here is compared against the pairwise loop.
describe("label pick: grid against the pairwise loop", () => {
  const same = (boxes: readonly LabelBox[]) => {
    expect(pickLabels(boxes)).toEqual(pickPairwise(boxes));
  };

  it("agrees on random sets of any size", () => {
    for (const n of [0, 1, 2, 5, 17, 100, 300, 1000, 2000]) for (const seed of [1, 2, 3]) same(randomBoxes(n, seed + n));
  });

  it("agrees on boxes piled on equal coordinates", () => {
    const boxes: LabelBox[] = Array.from({ length: 60 }, (_, i) => ({ x: 400, y: 300, w: 48, h: 14, priority: i }));
    same(boxes);
    expect(pickLabels(boxes)).toEqual([0]); // the first in priority order takes the spot
    // Same place, different sizes: the widest one shown first keeps the rest out.
    same([{ x: 0, y: 0, w: 200, h: 40, priority: 0 }, { x: 0, y: 0, w: 20, h: 10, priority: 1 }, { x: 0, y: 0, w: 20, h: 10, priority: 2 }]);
  });

  it("agrees on equal priorities, keeping the earlier box", () => {
    const boxes: LabelBox[] = [
      { x: 100, y: 100, w: 60, h: 20, priority: 7 },
      { x: 120, y: 100, w: 60, h: 20, priority: 7 },
      { x: 900, y: 100, w: 60, h: 20, priority: 7 },
    ];
    same(boxes);
    expect(pickLabels(boxes)).toEqual([0, 2]);
  });

  it("agrees where the padded extents just touch", () => {
    // Two 40 x 10 boxes 4 px of padding each: |dx| * 2 === 40 + 40 + 2 * 4 at dx = 44, which is touching, not overlapping.
    const boxes: LabelBox[] = [
      { x: 0, y: 0, w: 40, h: 10, priority: 0 },
      { x: 44, y: 0, w: 40, h: 10, priority: 1 }, // exactly touching horizontally: shown
      { x: 43.999, y: 0, w: 40, h: 10, priority: 2 }, // a hair inside: hidden by box 1
      { x: 0, y: 14, w: 40, h: 10, priority: 3 }, // exactly touching vertically: shown
    ];
    same(boxes);
    expect(pickLabels(boxes)).toEqual([0, 1, 3]);
  });

  it("agrees when a box spans many cells and when the spread is too wide for a grid", () => {
    // A 2000 px label across the grid: it must be filed under every cell it covers.
    const wide: LabelBox[] = [
      { x: 1000, y: 300, w: 2000, h: 20, priority: 0 },
      ...randomBoxes(400, 9).map((b) => ({ ...b, y: 300 + (b.y % 3) })),
    ];
    same(wide);
    // Two boxes 1e6 px apart: the grid would need millions of cells, so both paths run on the pairwise loop.
    same([
      { x: 0, y: 0, w: 40, h: 14, priority: 0 },
      { x: 1e6, y: 0, w: 40, h: 14, priority: 1 },
      { x: 20, y: 0, w: 40, h: 14, priority: 2 },
    ]);
  });

  it("agrees inside one crowded cell", () => {
    // 300 boxes within a few pixels: the worst case for any grid, still the same answer.
    const boxes: LabelBox[] = Array.from({ length: 300 }, (_, i) => ({ x: 500 + (i % 7), y: 400 + (i % 5), w: 60, h: 14, priority: i }));
    same(boxes);
  });

  it("agrees on boxes sitting on cell boundaries", () => {
    // 64 px cells: coordinates and widths that fall exactly on, and a hair either side of, a cell edge.
    for (const snap of [64, 32, 16, 1]) {
      const boxes: LabelBox[] = randomBoxes(120, snap).map((b) => ({ ...b, x: Math.round(b.x / snap) * snap, y: Math.round(b.y / snap) * snap, w: snap * (1 + (b.w % 3)) }));
      same(boxes);
    }
    const edges: LabelBox[] = [];
    for (let k = -1; k <= 1; k++)
      for (let i = 0; i < 40; i++) edges.push({ x: 640 + k * 1e-9 + (i % 4) * 64, y: 320 + (i % 3) * 64, w: 64, h: 64, priority: i });
    same(edges);
  });

  it("agrees over many random sets", () => {
    for (let seed = 0; seed < 200; seed++) same(randomBoxes(8 + (seed % 40), seed * 7 + 1, 40 + ((seed * 97) % 3000)));
  });
});

describe("labels along a line", () => {
  it("centres the text at half the line and turns it along the line", () => {
    const a = lineLabelAnchor([[0, 0], [100, 0], [200, 0]], 60)!;
    expect(a.x).toBeCloseTo(100);
    expect(a.y).toBeCloseTo(0);
    expect(a.angle).toBeCloseTo(0);
  });

  it("keeps the text upright whichever way the line runs", () => {
    const a = lineLabelAnchor([[200, 10], [0, 10]], 60)!;
    expect(Math.abs(a.angle)).toBeLessThan(1e-9);
    const b = lineLabelAnchor([[0, 0], [-100, 100]], 40)!; // down-left: shown as up-right text
    expect(b.angle).toBeCloseTo(-Math.PI / 4);
  });

  it("needs the line longer on screen than the text", () => {
    expect(lineLabelAnchor([[0, 0], [50, 0]], 60)).toBeNull();
    expect(lineLabelAnchor([[0, 0]], 10)).toBeNull();
  });

  it("does not lay a label over a sharp turn under it, but over one away from it", () => {
    expect(lineLabelAnchor([[0, 0], [60, 0], [60, 60]], 80)).toBeNull();
    expect(lineLabelAnchor([[0, 0], [400, 0], [400, 20]], 80)).not.toBeNull();
  });

  it("boxes a turned text and wraps long names", () => {
    const e = rotatedExtent(100, 10, Math.PI / 2);
    expect(e.w).toBeCloseTo(10);
    expect(e.h).toBeCloseTo(100);
    expect(wrapExtent(50, 96)).toEqual({ lines: 1, w: 50 });
    const w = wrapExtent(250, 96);
    expect(w.lines).toBe(3);
    expect(w.w).toBeLessThanOrEqual(96);
  });
});
