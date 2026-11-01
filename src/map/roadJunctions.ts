import { ROAD_KINDS } from "../sim/roads";
import type { RoadEdge, RoadGraph, RoadKind } from "../sim/types";
import { Mesh, PATTERN, type Model, type XY } from "./modelGeometry";
import { groundRoadZ, roadSurface } from "./roadModels";

// Junction aprons: the surface of a single junction, drawn over the ribbons that meet there.
//
// Road ribbons meet at the nodes of the graph, and every meeting leaves a seam: a chain's round joint puts a plain disc of
// the road's colour over its neighbour, one road's shoulder line runs across the next road's surface, and ruts stop on a
// straight cut. An apron replaces all of that with one flat surface: the union of the arms' strips around the node, cut
// square at each arm's reach and at its first node, drawn after the ribbons (roadLayer.ts) so its rim, which follows the
// roads' own edges, is what the eye sees.
// - The apron is painted as the dominant arm's road: its colour, and its ruts in its own cross-road coordinates, so they
//   run straight through the junction and line up with its ribbons. A side road's ruts stop at the junction, as they do.
// - The shoulder is a 0..1 band per vertex that the shader turns into the same falloff the ribbons use (modelLayer.ts).
//   It is the nearest road's shoulder, so it follows the arm whose edge is nearest and stops where another road's surface
//   takes the point over: no shoulder line runs across a mouth, while the rim meets every ribbon's own shoulder.
// - A chain gets no round joint at an end that joins another road (roadModels.ts `joined`): the apron covers the cut.
//
// The dominant arm is the widest one (then the more paved kind, then the one that carries straight on, then the lowest
// edge id), so the road that runs through a junction keeps its ruts while a side road's stop at it.

const SEGMENTS = 96; // boundary samples: at a 5 m reach the chords stay within a centimetre of the true outline
const REACH = 1.55; // how far an apron reaches past its node, in half widths of its widest arm
const REACH_MIN = 0.6; // m

// A built road arriving at the junction: the unit direction away from the node, its half width, its kind and how long that
// stretch is (an apron never reaches past the next node).
export interface RoadArm {
  edge: number;
  dir: XY;
  hw: number;
  kind: RoadKind;
  len: number;
}

// The arms at one node, the dominant one first.
export interface RoadJunction {
  node: number;
  p: XY;
  arms: RoadArm[];
}

const PAVED: Record<RoadKind, number> = { path: 1, dirt: 2, stone: 3, footbridge: 0, bridge: 0, stonebridge: 0 };
const TAU = Math.PI * 2;

// How well an arm carries on through the junction: 1 when another arm runs opposite to it.
const through = (arm: RoadArm, arms: readonly RoadArm[]): number => {
  let best = 0;
  for (const o of arms) if (o !== arm) best = Math.max(best, -(arm.dir[0] * o.dir[0] + arm.dir[1] * o.dir[1]));
  return best;
};

// Junctions of a graph's built roads, each with its arms (dominant first). An apron goes wherever the ribbons meet in a
// way a single ribbon cannot draw: three or more built roads at a node (a branch), or two of different kinds (where the
// pavement changes). A plain bend keeps the ribbon's own mitre and joint, and a dead end keeps its round cap.
// The arms come from the graph rather than from the drawn chains: roadChains.ts may run one chain straight through a
// branch, and the apron still has to cover every road arriving there.
export function roadJunctions(g: RoadGraph, built: (e: RoadEdge) => boolean): RoadJunction[] {
  const byNode = new Map<number, RoadArm[]>();
  const push = (node: number, arm: RoadArm): void => {
    const list = byNode.get(node);
    if (list) list.push(arm);
    else byNode.set(node, [arm]);
  };
  for (const e of Object.values(g.edges)) {
    if (!built(e) || ROAD_KINDS[e.kind].crossesWater) continue; // a deck ends on its own ramp, above the ground
    const a = g.nodes[e.a], b = g.nodes[e.b];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0.5)) continue; // a degenerate edge has no direction
    const hw = ROAD_KINDS[e.kind].width / 2;
    push(a.id, { edge: e.id, dir: [(b.x - a.x) / len, (b.y - a.y) / len], hw, kind: e.kind, len });
    push(b.id, { edge: e.id, dir: [(a.x - b.x) / len, (a.y - b.y) / len], hw, kind: e.kind, len });
  }

  const out: RoadJunction[] = [];
  for (const [node, arms] of byNode) {
    const n = g.nodes[node];
    if (!n) continue;
    const kinds = new Set(arms.map((a) => a.kind));
    if (arms.length < 3 && !(arms.length === 2 && kinds.size > 1)) continue;
    arms.sort((a, b) => b.hw - a.hw || PAVED[b.kind] - PAVED[a.kind] || through(b, arms) - through(a, arms) || a.edge - b.edge);
    out.push({ node, p: [n.x, n.y], arms });
  }
  return out;
}

// Reach of an apron past its node: enough to cover the widest arm's round joint and a stretch of its own surface.
export const junctionReach = (j: RoadJunction): number => {
  const hw = Math.max(...j.arms.map((a) => a.hw));
  return hw + Math.max(REACH_MIN, hw * (REACH - 1));
};

// How far an arm's own stretch of apron runs: past its round joint, and no further than the widest arm's reach.
const armReach = (arm: RoadArm): number => arm.hw + Math.max(REACH_MIN, arm.hw * (REACH - 1));

// Distance from the node to the apron's rim in direction `angle`: the union of the arm strips, each cut square at its
// own reach and at its first node. A small floor rounds the corners the strips leave at the node (and keeps the rim
// defined where no arm reaches) without adding pavement beside the road.
export function junctionRadius(j: RoadJunction, angle: number): number {
  const c = Math.cos(angle), s = Math.sin(angle);
  let r = 0;
  for (const arm of j.arms) {
    const along = c * arm.dir[0] + s * arm.dir[1];
    if (along <= 1e-9) continue; // behind this arm
    const across = Math.abs(s * arm.dir[0] - c * arm.dir[1]);
    r = Math.max(r, Math.min(across > 1e-9 ? arm.hw / across : Infinity, armReach(arm) / along, arm.len / along));
  }
  return Math.max(r, Math.min(0.5, Math.min(...j.arms.map((a) => a.hw)) * 0.5));
}

// The apron's outline: its rim sampled around the node.
export function junctionOutline(j: RoadJunction): XY[] {
  const out: XY[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const a = (TAU * (k + 0.5)) / SEGMENTS;
    const r = junctionRadius(j, a);
    out.push([j.p[0] + Math.cos(a) * r, j.p[1] + Math.sin(a) * r]);
  }
  return out;
}

// Where a point sits in the shoulder band of the nearest road that reaches it, as 0 (no darkening) .. 1 (the edge's
// darkening): the shader turns this into the same falloff it paints on the ribbons (modelLayer.ts road()). Taking the
// nearest arm rather than the dominant one is what keeps a shoulder line from running across a junction's mouth: the
// road whose edge is nearest owns the point, and at the mouth that is the joining road, which has no edge there. The
// value is remapped per arm, so a path's wider band and a dirt road's narrow one both read as 0..1.
function shoulder(j: RoadJunction, x: number, y: number): number {
  const dx = x - j.p[0], dy = y - j.p[1];
  let t = 1;
  for (const arm of j.arms) {
    if (dx * arm.dir[0] + dy * arm.dir[1] < -0.05) continue; // this arm's road is behind the node
    const u = Math.abs(dy * arm.dir[0] - dx * arm.dir[1]) / arm.hw;
    const from = arm.kind === "path" ? 0.5 : 0.82;
    t = Math.min(t, Math.min(1, Math.max(0, (u - from) / (1 - from))));
  }
  return t;
}

// Mesh of one junction apron (centre line in town metres), for the same model layer as the roads.
export function buildJunctionModel(j: RoadJunction): Model {
  const mesh = new Mesh({ cx: 0, cy: 0, ux: 1, uy: 0, len: 0, wid: 0 });
  if (!j.arms.length) return mesh.m;
  const dom = j.arms[0];
  const t = dom.dir, n: XY = [-t[1], t[0]];
  const width = dom.hw * 2;
  const surf = roadSurface(dom.kind);
  const code = surf.pat === PATTERN.cobbles ? PATTERN.junctionCobbles : surf.pat === PATTERN.ruts ? PATTERN.junctionRuts : PATTERN.junctionPlain;
  const z = Math.max(...j.arms.map((a) => groundRoadZ(a.kind)));
  // the facade is (shoulder band, offset across the through road, its width, code): the shader paints the shoulder from
  // the first, the ruts from the other two, so the apron meets its ribbons without a step
  const vertex = (x: number, y: number, band: number): number => {
    const dx = x - j.p[0], dy = y - j.p[1];
    return mesh.vert(x, y, z, [0, 0, 1], surf.col, [band, dx * n[0] + dy * n[1], width, code]);
  };

  // The shoulder only lives in a band along the rim, so the apron is that band plus a flat middle: the band's inner edge
  // is 0, and every triangle inside it is flat, which keeps the darkening from being smeared over a coarse fan.
  const band = Math.max(...j.arms.map((a) => (a.kind === "path" ? 0.5 : 0.18) * a.hw));
  const outline = junctionOutline(j);
  const outer = outline.map(([x, y]) => vertex(x, y, shoulder(j, x, y)));
  const inner = outline.map(([x, y], k) => {
    const a = outline[(k + outline.length - 1) % outline.length], b = outline[(k + 1) % outline.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return vertex(x - (dy / l) * band, y + (dx / l) * band, 0); // inward normal of a counter-clockwise outline
  });
  const centre = vertex(j.p[0], j.p[1], 0);
  for (let k = 0; k < outline.length; k++) {
    const k2 = (k + 1) % outline.length;
    mesh.idx(centre, inner[k], inner[k2]);
    mesh.idx(inner[k], outer[k], outer[k2]);
    mesh.idx(inner[k], outer[k2], inner[k2]);
  }
  return mesh.m;
}



