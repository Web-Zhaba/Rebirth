export type Pt = [number, number];

export interface RoadGraphLike {
  nodes: Record<number, { id: number; x: number; y: number }>;
  edges: Record<number, { id: number; a: number; b: number }>;
}

const BAND = 1.25;
const PARALLEL_DOT = 0.985;
const MIN_PIECE = 8;

function coveredInterval(a: Pt, b: Pt, c: Pt, d: Pt): [number, number] | null {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len = Math.hypot(vx, vy);
  const wx = d[0] - c[0];
  const wy = d[1] - c[1];
  const wlen = Math.hypot(wx, wy);
  if (len === 0 || wlen === 0) return null;
  const ux = vx / len;
  const uy = vy / len;
  const ex = wx / wlen;
  const ey = wy / wlen;
  if (Math.abs(ux * ex + uy * ey) < PARALLEL_DOT) return null;

  const project = (p: Pt) => ({
    along: (p[0] - a[0]) * ux + (p[1] - a[1]) * uy,
    off: Math.abs(-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux),
  });
  const pc = project(c);
  const pd = project(d);
  if (pc.off > BAND || pd.off > BAND) return null;
  const lo = Math.max(0, Math.min(pc.along, pd.along));
  const hi = Math.min(len, Math.max(pc.along, pd.along));
  return hi - lo > 0.5 ? [lo, hi] : null;
}

export function restoreMissingPieces(graph: RoadGraphLike, pts: readonly Pt[]): Pt[][] {
  const out: Pt[][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const len = Math.hypot(vx, vy);
    if (len < MIN_PIECE) continue;
    const ux = vx / len;
    const uy = vy / len;
    const intervals: [number, number][] = [];
    for (const e of Object.values(graph.edges)) {
      const c = graph.nodes[e.a];
      const d = graph.nodes[e.b];
      if (!c || !d) continue;
      const hit = coveredInterval(a, b, [c.x, c.y], [d.x, d.y]);
      if (hit) intervals.push(hit);
    }
    intervals.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const cur of intervals) {
      const last = merged[merged.length - 1];
      if (last && cur[0] <= last[1] + 0.5) last[1] = Math.max(last[1], cur[1]);
      else merged.push([...cur]);
    }

    let pos = 0;
    const emit = (lo: number, hi: number) => {
      if (hi - lo < MIN_PIECE) return;
      out.push([
        [a[0] + ux * lo, a[1] + uy * lo],
        [a[0] + ux * hi, a[1] + uy * hi],
      ]);
    };
    for (const [lo, hi] of merged) {
      emit(pos, lo);
      pos = Math.max(pos, hi);
    }
    emit(pos, len);
  }
  return out;
}
