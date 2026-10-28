export type HitPoint = [number, number];

export interface HitShape {
  id: number;
  footprint: readonly HitPoint[];
}

export interface BuildingSpatialIndex {
  bucket: number;
  cells: Map<string, number[]>;
}

const cellKey = (x: number, y: number): string => `${x},${y}`;

export function buildBuildingSpatialIndex(shapes: Iterable<HitShape>, bucket = 64): BuildingSpatialIndex {
  const cells = new Map<string, number[]>();
  for (const shape of shapes) {
    if (shape.footprint.length === 0) continue;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of shape.footprint) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    for (let bx = Math.floor(x0 / bucket); bx <= Math.floor(x1 / bucket); bx++) {
      for (let by = Math.floor(y0 / bucket); by <= Math.floor(y1 / bucket); by++) {
        const key = cellKey(bx, by);
        const list = cells.get(key);
        if (list) list.push(shape.id);
        else cells.set(key, [shape.id]);
      }
    }
  }
  return { bucket, cells };
}

export function buildingSpatialCandidates(index: BuildingSpatialIndex, x: number, y: number): readonly number[] {
  return index.cells.get(cellKey(Math.floor(x / index.bucket), Math.floor(y / index.bucket))) ?? [];
}
