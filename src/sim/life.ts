import type { Light, Trip } from "../map/lifeLayer";
import { BUILDINGS } from "./buildings";
import { EVENING } from "./evening";
import { workHours } from "./levers";
import { WORKSHOP_INPUT } from "./fields";
import { nodePath, polyline, polyLength, shortestTree } from "./paths";
import { buildNet, isFinishedHouse, isWorkplace, lotFront, MAX_COMMUTE, nearestNode, WALK_SPEED } from "./people";
import { GOOD } from "./production";
import { START_MINUTE_OF_DAY } from "./time";
import type { Building, SimState, Stock } from "./types";

// Visual life (PLAN.md section 10): derived from the state once per game day and never stored in it.
export interface LifeData {
  day: number;
  trips: Trip[];
  traffic: Record<number, number>; // road edge id -> commuters using it per day
  lights: Light[];
}

export const MAX_WALKERS = 300;
export const MAX_CARTS = 6; // per producer per day
export const CART_SPEED = 3000 / 60; // m per game minute, 3 km/h
export const CART_RANGE = 6000; // m of road from the camp
export const LOAD: Record<keyof Stock, number> = { logs: 5, planks: 2, stone: 3, food: 500, wares: 20 };
export const TO_WORK = 6 * 60; // earliest departure to work (06:00)
export const HOME_AT = 19 * 60; // earliest departure home (19:00)
export const WORK_FROM = 7 * 60;
export const WORK_TO = 19 * 60;
export const MAX_GUESTS = 12; // evening walkers to one tavern
const CART_ID0 = 2 ** 30;
const EVENING_ID0 = 2 ** 29;

// Deterministic 32-bit mix of an id (and a salt), as a number in [0, 1).
function unit(id: number, salt: number): number {
  let h = Math.imul(id ^ Math.imul(salt, 0x9e3779b1), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const round2 = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
const centre = (b: Building): [number, number] => {
  let x = 0;
  let y = 0;
  for (const p of b.footprint) {
    x += p[0];
    y += p[1];
  }
  return [Math.round((x / b.footprint.length) * 10) / 10, Math.round((y / b.footprint.length) * 10) / 10];
};

interface Spot {
  node: number;
  off: number;
  at: [number, number];
}
interface Commuter {
  id: number;
  nodes: number[];
  home: [number, number];
  work: [number, number];
}

export function computeLife(s: SimState, day = 0): LifeData {
  const net = buildNet(s.roads);
  const trips: Trip[] = [];
  const traffic: Record<number, number> = {};
  const lights: Light[] = [];

  // lights: houses with a household (vacant ones stay dark), workplaces with at least one worker (a workshop
  // whose input is missing stays dark), taverns glow in the evening
  const worked = new Set<number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) worked.add(r.job);
  const lit = new Set<number>();
  for (const h of Object.values(s.households)) {
    if (h.home === null || h.members.length === 0 || lit.has(h.home)) continue;
    const b = s.buildings[h.home];
    if (!isFinishedHouse(b)) continue;
    lit.add(b.id);
    const [x, y] = centre(b);
    lights.push({ x, y, kind: "house" });
  }
  for (const b of Object.values(s.buildings)) {
    if (!isWorkplace(b) || !worked.has(b.id)) continue;
    const input = WORKSHOP_INPUT[b.template];
    if (input && s.stock[input] <= 1e-9) continue;
    const [x, y] = centre(b);
    lights.push({ x, y, kind: b.template === "tavern" ? "tavern" : "work" });
  }
  if (net.adj.size === 0) return { day, trips, traffic, lights };

  // door -> net node, once per building
  const spot = new Map<number, Spot | null>();
  const locate = (b: Building): Spot | null => {
    let l = spot.get(b.id);
    if (l === undefined) {
      const at = lotFront(b);
      const n = nearestNode(net, at[0], at[1]);
      l = n && { ...n, at };
      spot.set(b.id, l);
    }
    return l;
  };

  // edge between two adjacent nodes (the shortest one if several run in parallel)
  const edgeOf = new Map<number, { id: number; len: number }>();
  const pair = (a: number, b: number) => (a < b ? a * 67108864 + b : b * 67108864 + a);
  for (const e of Object.values(s.roads.edges)) {
    if (e.done < e.labor) continue;
    const k = pair(e.a, e.b);
    const old = edgeOf.get(k);
    if (!old || e.length < old.len) edgeOf.set(k, { id: e.id, len: e.length });
  }

  // commuters grouped by the node their home door steps onto: one Dijkstra per node
  const limit = MAX_COMMUTE * WALK_SPEED;
  const groups = new Map<number, { id: number; home: Spot; work: Spot }[]>();
  for (const r of Object.values(s.residents)) {
    if (r.job === null) continue;
    const hh = s.households[r.household];
    const home = hh && hh.home !== null ? s.buildings[hh.home] : undefined;
    const work = s.buildings[r.job];
    if (!isFinishedHouse(home) || !isWorkplace(work)) continue;
    const hl = locate(home);
    const wl = locate(work);
    if (!hl || !wl) continue;
    const item = { id: r.id, home: hl, work: wl };
    const list = groups.get(hl.node);
    if (list) list.push(item);
    else groups.set(hl.node, [item]);
  }
  const routed: Commuter[] = [];
  for (const [node, list] of groups) {
    const tree = shortestTree(net, node, limit);
    for (const c of list) {
      const nodes = nodePath(tree, c.work.node);
      if (!nodes) continue;
      for (let i = 1; i < nodes.length; i++) {
        const e = edgeOf.get(pair(nodes[i - 1], nodes[i]));
        if (e) traffic[e.id] = (traffic[e.id] ?? 0) + 1;
      }
      routed.push({ id: c.id, nodes, home: c.home.at, work: c.work.at });
    }
  }

  // walkers: the MAX_WALKERS commuters with the lowest hash
  routed.sort((p, q) => unit(p.id, 1) - unit(q.id, 1) || p.id - q.id);
  for (const c of routed.slice(0, MAX_WALKERS)) {
    const pts = round2(polyline(s.roads, c.nodes, c.home, c.work));
    const travel = polyLength(pts) / WALK_SPEED;
    // leaves within 06:00-07:00 but early enough to be at work by 07:00
    const out = TO_WORK + unit(c.id, 2) * Math.max(0, 60 - travel);
    const back = HOME_AT + unit(c.id, 3) * 60;
    trips.push({ id: c.id * 2, kind: "walk", pts, depart: out, speed: WALK_SPEED });
    trips.push({ id: c.id * 2 + 1, kind: "walk", pts: [...pts].reverse(), depart: back, speed: WALK_SPEED });
  }

  // evenings: up to MAX_GUESTS households from the homes within reach of each staffed tavern walk there at 19-21 and back at 21-22
  let guest = 0;
  const taverns = Object.values(s.buildings).filter((b) => b.template === "tavern" && isWorkplace(b) && worked.has(b.id));
  const homes = new Map<number, number>(); // house id -> an adult's id of its household, for the hash
  for (const h of Object.values(s.households)) if (h.home !== null && h.members.length > 0 && !homes.has(h.home)) homes.set(h.home, h.members[0]);
  for (const t of taverns) {
    const tl = locate(t);
    if (!tl) continue;
    const tree = shortestTree(net, tl.node, EVENING.tavernReach);
    const cands: { who: number; house: Building }[] = [];
    for (const [hid, who] of homes) if (isFinishedHouse(s.buildings[hid])) cands.push({ who, house: s.buildings[hid] });
    cands.sort((p, q) => unit(p.who, 5) - unit(q.who, 5) || p.who - q.who);
    let n = 0;
    for (const c of cands) {
      if (n >= MAX_GUESTS) break;
      const hl = locate(c.house);
      const path = hl && nodePath(tree, hl.node);
      if (!hl || !path) continue;
      const pts = round2(polyline(s.roads, [...path].reverse(), hl.at, tl.at));
      if (polyLength(pts) < 5) continue;
      const out = workHours(s).end * 60 + unit(c.who, 6) * 90;
      const back = 21 * 60 + unit(c.who, 7) * 45;
      trips.push({ id: EVENING_ID0 + guest++, kind: "walk", pts, depart: out, speed: WALK_SPEED });
      trips.push({ id: EVENING_ID0 + guest++, kind: "walk", pts: [...pts].reverse(), depart: back, speed: WALK_SPEED });
      n++;
    }
  }

  // carts: one per load of yesterday's output, producer -> camp
  const camp = nearestNode(net, 0, 0);
  if (camp) {
    const tree = shortestTree(net, camp.node, CART_RANGE);
    let n = 0;
    for (const b of Object.values(s.buildings)) {
      const good = GOOD[b.template];
      if (b.state !== "active" || !good || !BUILDINGS[b.template]) continue;
      const made = s.prod.yesterday[b.id] ?? 0;
      if (!(made > 0)) continue;
      const loads = Math.min(MAX_CARTS, Math.ceil(made / LOAD[good] - 1e-9));
      const l = locate(b);
      const path = l && nodePath(tree, l.node);
      if (!l || !path) continue;
      const pts = round2(polyline(s.roads, path.reverse(), l.at, [0, 0]));
      for (let k = 0; k < loads; k++) {
        trips.push({ id: CART_ID0 + n++, kind: "cart", pts, depart: WORK_FROM + ((k + 0.5) * (WORK_TO - WORK_FROM)) / loads, speed: CART_SPEED });
      }
    }
    // families on their way: a cart from the built node farthest from the camp to the promised house,
    // timed to arrive when they do (the trip repeats daily, but the family is gone by then)
    let far: number | null = null;
    for (const [node, d] of tree.dist) if (far === null || d > tree.dist.get(far)! || (d === tree.dist.get(far) && node < far)) far = node;
    const fromFar = far === null || s.incoming.length === 0 ? null : shortestTree(net, far, CART_RANGE);
    for (const f of s.incoming) {
      const house = s.buildings[f.house];
      const l = fromFar && isFinishedHouse(house) ? locate(house) : null;
      const path = l && fromFar && nodePath(fromFar, l.node);
      if (!l || !path || far === null) continue;
      const pts = round2(polyline(s.roads, path, [s.roads.nodes[far].x, s.roads.nodes[far].y], l.at));
      const depart = f.arrive - polyLength(pts) / CART_SPEED;
      trips.push({ id: CART_ID0 + n++, kind: "cart", pts, depart: (((depart + START_MINUTE_OF_DAY) % 1440) + 1440) % 1440, speed: CART_SPEED });
    }
  }
  return { day, trips, traffic, lights };
}
