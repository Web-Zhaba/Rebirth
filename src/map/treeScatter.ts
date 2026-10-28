import type { XY } from "./modelGeometry";

export const CHUNK = 200;
export const TREES_FROM_ZOOM = 13.6;
export const TREE_STRIDE = 6;
export const TREE_KINDS = ["conifer", "broadleaf", "birch", "bush", "reed", "boulder"] as const;
export const DETAIL_KINDS = ["bush", "reed", "boulder"] as const;
export type DetailKind = (typeof DETAIL_KINDS)[number];
const FIRST_DETAIL = TREE_KINDS.indexOf(DETAIL_KINDS[0]);
export type TreeKind = (typeof TREE_KINDS)[number];

export interface ForestPoly {
  bbox: [number, number, number, number];
  rings: XY[][];
}

export interface ScatterInput {
  forests: readonly ForestPoly[];
  rect: [number, number, number, number];
  spacing: number;
  lat: number;
  blocked: (x: number, y: number, h: number) => boolean;
}

function hash(i: number, j: number, k: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function insideRings(x: number, y: number, rings: readonly XY[][]): boolean {
  let inside = false;
  for (let rIdx = 0; rIdx < rings.length; rIdx++) {
    const r = rings[rIdx];
    const len = r.length;
    for (let i = 0, j = len - 1; i < len; j = i++) {
      const pi = r[i], pj = r[j];
      const xi = pi[0], yi = pi[1];
      const xj = pj[0], yj = pj[1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export type DetailMix = Partial<Record<DetailKind, { share: number; size: [number, number] }>>;
export interface DetailPoly extends ForestPoly {
  mix: DetailMix;
}
export const DETAIL_SPACING: Record<DetailKind, number> = { bush: 5, reed: 2.5, boulder: 7 };

export interface DetailInput {
  polys: readonly DetailPoly[];
  rect: ScatterInput["rect"];
  blocked: ScatterInput["blocked"];
}

// Переиспользуемый буфер для генерации геометрии без создания промежуточных JS-массивов
let sharedBuffer = new Float32Array(16384);

function ensureBufferCapacity(needed: number) {
  if (needed > sharedBuffer.length) {
    sharedBuffer = new Float32Array(Math.max(needed, sharedBuffer.length * 2));
  }
}

export function scatterDetails(inp: DetailInput): Float32Array {
  const [x0, y0, x1, y1] = inp.rect;
  let count = 0;

  DETAIL_KINDS.forEach((kind, k) => {
    const polys = inp.polys.filter(
      (f) => f.mix[kind] && f.bbox[2] >= x0 && f.bbox[0] <= x1 && f.bbox[3] >= y0 && f.bbox[1] <= y1
    );
    if (!polys.length) return;

    // Максимальная вероятность для быстрого отсечения ячеек
    let maxShare = 0;
    let minBx = x1, minBy = y1, maxBx = x0, maxBy = y0;
    for (let p = 0; p < polys.length; p++) {
      const poly = polys[p];
      const sh = poly.mix[kind]!.share;
      if (sh > maxShare) maxShare = sh;
      if (poly.bbox[0] < minBx) minBx = poly.bbox[0];
      if (poly.bbox[1] < minBy) minBy = poly.bbox[1];
      if (poly.bbox[2] > maxBx) maxBx = poly.bbox[2];
      if (poly.bbox[3] > maxBy) maxBy = poly.bbox[3];
    }
    if (maxShare <= 0) return;

    const sp = DETAIL_SPACING[kind], s = 20 + k * 8;
    const startX = Math.max(x0, minBx), endX = Math.min(x1, maxBx);
    const startY = Math.max(y0, minBy), endY = Math.min(y1, maxBy);

    const i0 = Math.floor(startX / sp);
    const j0 = Math.floor(startY / sp);

    for (let i = i0; i * sp < endX; i++) {
      for (let j = j0; j * sp < endY; j++) {
        // Fast-path: 85-98% ячеек отбрасываются здесь без математики
        const h = hash(i, j, s + 2);
        if (h >= maxShare) continue;

        const x = (i + hash(i, j, s)) * sp;
        const y = (j + hash(i, j, s + 1)) * sp;
        if (x < startX || x >= endX || y < startY || y >= endY) continue;

        // Поиск первого накрывающего полигона
        let matched: DetailPoly | null = null;
        for (let p = 0; p < polys.length; p++) {
          const poly = polys[p];
          if (x >= poly.bbox[0] && x <= poly.bbox[2] && y >= poly.bbox[1] && y <= poly.bbox[3]) {
            if (insideRings(x, y, poly.rings)) {
              matched = poly;
              break;
            }
          }
        }

        if (!matched) continue;
        const m = matched.mix[kind]!;
        if (h >= m.share || inp.blocked(x, y, h)) continue;

        const size = m.size[0] + (m.size[1] - m.size[0]) * hash(i, j, s + 3) ** 2;

        ensureBufferCapacity(count + 6);
        sharedBuffer[count++] = x;
        sharedBuffer[count++] = y;
        sharedBuffer[count++] = size;
        sharedBuffer[count++] = FIRST_DETAIL + k;
        sharedBuffer[count++] = hash(i, j, s + 4) * Math.PI * 2;
        sharedBuffer[count++] = hash(i, j, s + 5);
      }
    }
  });

  return count > 0 ? sharedBuffer.slice(0, count) : new Float32Array(0);
}

export const coniferShare = (lat: number): number => Math.min(0.85, Math.max(0.1, (Math.abs(lat) - 42) / 20));

export function scatterTrees(inp: ScatterInput): Float32Array {
  const [x0, y0, x1, y1] = inp.rect, sp = inp.spacing;
  const forests = inp.forests.filter((f) => f.bbox[2] >= x0 && f.bbox[0] <= x1 && f.bbox[3] >= y0 && f.bbox[1] <= y1);
  if (!forests.length) return new Float32Array(0);

  let minBx = x1, minBy = y1, maxBx = x0, maxBy = y0;
  for (let f = 0; f < forests.length; f++) {
    const poly = forests[f];
    if (poly.bbox[0] < minBx) minBx = poly.bbox[0];
    if (poly.bbox[1] < minBy) minBy = poly.bbox[1];
    if (poly.bbox[2] > maxBx) maxBx = poly.bbox[2];
    if (poly.bbox[3] > maxBy) maxBy = poly.bbox[3];
  }

  const startX = Math.max(x0, minBx), endX = Math.min(x1, maxBx);
  const startY = Math.max(y0, minBy), endY = Math.min(y1, maxBy);

  const conifer = coniferShare(inp.lat);
  const birch = Math.min(0.25, Math.max(0, (Math.abs(inp.lat) - 50) / 40));
  let count = 0;

  for (let i = Math.floor(startX / sp); i * sp < endX; i++) {
    for (let j = Math.floor(startY / sp); j * sp < endY; j++) {
      const x = (i + hash(i, j, 1)) * sp;
      const y = (j + hash(i, j, 2)) * sp;
      if (x < startX || x >= endX || y < startY || y >= endY) continue;

      let inside = false;
      for (let f = 0; f < forests.length; f++) {
        const poly = forests[f];
        if (x >= poly.bbox[0] && x <= poly.bbox[2] && y >= poly.bbox[1] && y <= poly.bbox[3]) {
          if (insideRings(x, y, poly.rings)) {
            inside = true;
            break;
          }
        }
      }
      if (!inside) continue;

      const h = hash(i, j, 3);
      if (inp.blocked(x, y, h)) continue;

      const r = hash(i, j, 4);
      const kind = r < conifer ? 0 : r < conifer + birch * (1 - conifer) ? 2 : 1;
      const size = (kind === 0 ? 13 : kind === 2 ? 11 : 10) * (0.6 + 0.6 * hash(i, j, 5));

      ensureBufferCapacity(count + 6);
      sharedBuffer[count++] = x;
      sharedBuffer[count++] = y;
      sharedBuffer[count++] = size;
      sharedBuffer[count++] = kind;
      sharedBuffer[count++] = hash(i, j, 6) * Math.PI * 2;
      sharedBuffer[count++] = h;
    }
  }

  return count > 0 ? sharedBuffer.slice(0, count) : new Float32Array(0);
}

export const MIN_KEEP = 1 / 16;
export const keepAt = (d: number, reach: number): number => Math.min(1, Math.max(MIN_KEEP, reach / d));

export function thinReach(chunks: readonly { n: number; d: number }[], max: number, whole: number): number {
  const total = (reach: number) => chunks.reduce((a, c) => a + (c.d < whole ? c.n : c.n * keepAt(c.d, reach)), 0);
  if (total(Infinity) <= max) return Infinity;
  let lo = 1, hi = Math.max(whole, ...chunks.map((c) => c.d));
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (total(mid) > max) hi = mid;
    else lo = mid;
  }
  return lo;
}