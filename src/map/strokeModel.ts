import { BUILDINGS, homesOf, materialsOf, scaledJobs, type Materials } from "../sim/buildings";
import { excavationSite } from "../sim/digging";
import { distToEdge } from "../sim/roads";
import type { StrokeItem, StrokePlan, StrokeSpan } from "../sim/stroke";
import type { FoundFoundation, RoadGraph } from "../sim/types";
import { CELL_SIZE } from "../sim/zones";

// The pure half of the stroke tool: the dragged path turned into road spans, and the
// numbers of the summary card.

type Pt = [number, number];

export const STROKE_SNAP = 24; // m: how far from a road the path may run
const STEP = 4; // m between the samples taken along the path

// The nearest edge to a point within `snap`, with metres along it from node a and the side the point is on.
function nearestEdge(roads: RoadGraph, x: number, y: number, snap: number): { edge: number; t: number; side: 1 | -1 } | null {
  let best: { edge: number; t: number; side: 1 | -1 } | null = null;
  let bestD = snap;
  for (const e of Object.values(roads.edges)) {
    const a = roads.nodes[e.a];
    const b = roads.nodes[e.b];
    if (!a || !b) continue;
    const d = distToEdge(roads, e, x, y);
    if (d > bestD) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    bestD = d;
    const across = -(x - a.x) * uy + (y - a.y) * ux;
    best = { edge: e.id, t: (x - a.x) * ux + (y - a.y) * uy, side: across >= 0 ? 1 : -1 };
  }
  return best;
}

// The road spans a dragged path covers, in the order it was drawn: the path is sampled every few metres, each sample
// taken to the nearest road edge and the side of it the sample lies on; consecutive samples on one edge and side make a
// span. Each span is padded by `pad` metres at both ends (half a building, so the lot under the cursor is in), and with
// `both` the other side of every span follows it.
export function spansAlong(roads: RoadGraph, path: readonly Pt[], pad: number, both = false, snap = STROKE_SNAP): StrokeSpan[] {
  const samples: Pt[] = [];
  for (let k = 0; k < path.length; k++) {
    const p = path[k];
    if (k === 0) {
      samples.push(p);
      continue;
    }
    const q = path[k - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / STEP));
    for (let s = 1; s <= n; s++) samples.push([q[0] + ((p[0] - q[0]) * s) / n, q[1] + ((p[1] - q[1]) * s) / n]);
  }
  const groups: { edge: number; side: 1 | -1; first: number; last: number }[] = [];
  for (const [x, y] of samples) {
    const hit = nearestEdge(roads, x, y, snap);
    if (!hit) continue;
    const g = groups[groups.length - 1];
    if (g && g.edge === hit.edge && g.side === hit.side) g.last = hit.t;
    else groups.push({ edge: hit.edge, side: hit.side, first: hit.t, last: hit.t });
  }
  const out: StrokeSpan[] = [];
  for (const g of groups) {
    const dir = g.last >= g.first ? 1 : -1;
    const span: StrokeSpan = { edge: g.edge, side: g.side, from: g.first - dir * pad, to: g.last + dir * pad };
    out.push(span);
    if (both) out.push({ ...span, side: g.side === 1 ? -1 : 1 });
  }
  return out;
}

// Half the frontage of a template's lot: the pad of a stroke of it.
export const strokePad = (template: string): number => ((BUILDINGS[template]?.w ?? 1) * CELL_SIZE) / 2;

// What a preview item is drawn as.
export type ItemLook = "lot" | "foundation" | "asItWas" | "dig";
export const itemLook = (it: StrokeItem): ItemLook => (it.kind === "lot" ? "lot" : it.kind === "dig" ? "dig" : it.building.asItWas ? "asItWas" : "foundation");

export interface StrokeSummary {
  total: number;
  onFoundations: number; // dug foundations, as it was included
  asItWas: number;
  fresh: number; // new lots
  dig: number; // outlines dug first
  dropped: number;
  skipped: number;
  waiting: number; // along a road not built yet: started once it is
  homes: number; // families the houses hold
  jobs: number;
  labor: number; // person-hours, digs included
  materials: Materials;
}

// The numbers of the items the player keeps (those not in `dropped`).
export function strokeSummary(plan: StrokePlan, dropped: ReadonlySet<string>, foundations: readonly FoundFoundation[]): StrokeSummary {
  const out: StrokeSummary = { total: 0, onFoundations: 0, asItWas: 0, fresh: 0, dig: 0, dropped: 0, skipped: plan.skipped.length, waiting: 0, homes: 0, jobs: 0, labor: 0, materials: { logs: 0, planks: 0, stone: 0 } };
  for (const it of plan.items) {
    if (dropped.has(it.key)) {
      out.dropped++;
      continue;
    }
    const b = it.building;
    const t = BUILDINGS[b.template];
    out.total++;
    if (it.kind === "lot") out.fresh++;
    else if (it.kind === "dig") out.dig++;
    else out.onFoundations++;
    if (b.asItWas) out.asItWas++;
    if (b.awaitsRoad) out.waiting++;
    if (t.zone === "res") out.homes += homesOf(b);
    else out.jobs += scaledJobs(t.jobs, b);
    out.labor += b.labor;
    const m = materialsOf(b);
    if (m) {
      out.materials.logs += m.logs;
      out.materials.planks += m.planks;
      out.materials.stone += m.stone;
    }
    if (it.kind === "dig") {
      const f = foundations.find((x) => x.id === it.foundationId);
      if (f) out.labor += excavationSite(f, 0, 0).labor;
    }
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  out.labor = Math.round(out.labor);
  out.materials = { logs: r1(out.materials.logs), planks: r1(out.materials.planks), stone: r1(out.materials.stone) };
  return out;
}
