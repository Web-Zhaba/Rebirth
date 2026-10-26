import { signal } from "@preact/signals";
import type { DomainId } from "../sim/domains";
import { pointInRing } from "../sim/excavation";
import { heritageDomain, heritageKind } from "../sim/heritage";
import { HINT_BAND, ringCentroid, type Disc, type Foundation, type OldWorld, type Spot, type XY } from "../world/oldworld";

// Notable old buildings (PLAN-research.ru.md sections 3 and 7): a curated POI inside a foundation ring types it.
// Pure helpers plus the two signals the ruins layer draws from.

export const TYPED_PER_DISC = 30;
export const MAX_HEIGHT = 300; // m, as the sim accepts

// A foundation with a type: what the ruins layer draws and the next stage hit-tests (ring in local meters).
export interface TypedFoundation {
  id: string;
  ring: XY[];
  area: number;
  digId: number;
  cls: string; // stored kind (heritage.ts)
  name?: string;
  height?: number;
  domain: DomainId;
}

// A not yet revealed notable POI just outside a disc: only its position is shown.
export interface HintSpot {
  x: number;
  y: number;
}

// Typed foundations of the current world (revealed discs) and hints around them; client only, never saved.
export const typedFoundations = signal<TypedFoundation[]>([]);
export const hintSpots = signal<HintSpot[]>([]);

type Box = [number, number, number, number];
const boxOf = (ring: XY[]): Box => {
  const b: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (x > b[2]) b[2] = x;
    if (y > b[3]) b[3] = y;
  }
  return b;
};
const inBox = (x: number, y: number, b: Box): boolean => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

// Index of the smallest foundation whose ring holds the point, or -1.
function smallestAround(x: number, y: number, fs: Foundation[], boxes: Box[]): number {
  let best = -1;
  for (let i = 0; i < fs.length; i++) {
    if (!inBox(x, y, boxes[i]) || (best >= 0 && fs[i].area >= fs[best].area) || !pointInRing(x, y, fs[i].ring)) continue;
    best = i;
  }
  return best;
}

// Types foundations by the notable POIs inside them: the smallest ring wins for nested ones, a named POI beats an
// unnamed one for the same ring. At most `cap` per dig (named first, then larger area); digOf maps a centroid to its dig.
export function typeFoundations(foundations: Foundation[], spots: Spot[], digOf: (x: number, y: number) => number, cap = TYPED_PER_DISC): TypedFoundation[] {
  const boxes = foundations.map((f) => boxOf(f.ring));
  const picked = new Map<number, { spot: Spot; kind: string }>();
  for (const sp of spots) {
    const kind = heritageKind(sp.cls, sp.subclass);
    if (kind === null) continue;
    const i = smallestAround(sp.x, sp.y, foundations, boxes);
    if (i < 0) continue;
    const prev = picked.get(i);
    if (!prev || (sp.name && !prev.spot.name)) picked.set(i, { spot: sp, kind });
  }
  const perDig = new Map<number, TypedFoundation[]>();
  for (const [i, { spot, kind }] of picked) {
    const f = foundations[i];
    const [cx, cy] = ringCentroid(f.ring);
    const digId = digOf(cx, cy);
    const t: TypedFoundation = { id: f.id, ring: f.ring, area: f.area, digId, cls: kind, domain: heritageDomain(kind)! };
    if (spot.name) t.name = spot.name;
    if (typeof f.height === "number" && Number.isFinite(f.height) && f.height >= 0 && f.height <= MAX_HEIGHT) t.height = f.height;
    let list = perDig.get(digId);
    if (!list) perDig.set(digId, (list = []));
    list.push(t);
  }
  const out: TypedFoundation[] = [];
  for (const list of perDig.values()) {
    list.sort((a, b) => Number(!!b.name) - Number(!!a.name) || b.area - a.area || (a.id < b.id ? -1 : 1));
    out.push(...list.slice(0, cap));
  }
  return out;
}

// Notable POIs in the band just outside the discs (beyond a disc, within `band` m of it) that no revealed foundation holds.
export function selectHints(world: Pick<OldWorld, "foundations" | "spots">, discs: Disc[], band = HINT_BAND): HintSpot[] {
  const boxes = world.foundations.map((f) => boxOf(f.ring));
  const out: HintSpot[] = [];
  for (const sp of world.spots) {
    if (heritageKind(sp.cls, sp.subclass) === null) continue;
    let gap = Infinity; // distance beyond the nearest disc edge
    for (const d of discs) gap = Math.min(gap, Math.hypot(sp.x - d.x, sp.y - d.y) - d.r);
    if (gap <= 0 || gap > band) continue;
    if (smallestAround(sp.x, sp.y, world.foundations, boxes) >= 0) continue;
    out.push({ x: sp.x, y: sp.y });
  }
  return out;
}

// The typed old building whose panel is open (a foundation id); client only.
export const selectedSite = signal<string | null>(null);

// The smallest typed foundation whose ring holds the point, or null.
export function typedAt(x: number, y: number, list: readonly TypedFoundation[]): TypedFoundation | null {
  let best: TypedFoundation | null = null;
  for (const t of list) {
    if (best && t.area >= best.area) continue;
    if (t.ring.length >= 3 && pointInRing(x, y, t.ring)) best = t;
  }
  return best;
}
