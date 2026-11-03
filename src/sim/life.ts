import { unit, type Light, type Rest, type Trip } from "../map/life";
import { BUILDINGS } from "./buildings";
import { EVENING } from "./evening";
import { tolokaActive, workHours } from "./levers";
import { idleWorkplaces, WORKSHOP_INPUT } from "./fields";
import { polyLength, walkTo, type Walk } from "./paths";
import { ageOf, buildNet, constructionWork, isAdultAge, isFinishedHouse, isWorkplace, lotFront, MAX_COMMUTE, snapToRoad, spotTree, treeFrom, WALK_SPEED, type Spot } from "./people";
import { residentMoveFactor } from "./needs";
import { GOOD } from "./production";
import { isCleared } from "./clearing";
import { workableEdges } from "./roads";
import { pointInPolygon } from "./zones";
import { START_MINUTE_OF_DAY } from "./time";
import type { Building, Resident, SimState, Stock } from "./types";

// Visual life (PLAN.md section 10): derived from the state once per game day and never stored in it.
export interface LifeData {
  day: number;
  trips: Trip[];
  rests: Rest[]; // every resident, where they stay off their walks
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
export const CAMP_CLEAR = 3; // m around the founding point the tent folk leave free
export const CAMP_PER = 1.6; // m of camp radius per square root of its people
// Workplaces worked in the open, where the workers show on the plot: the rest work indoors, out of sight.
export const OPEN_AIR: ReadonlySet<string> = new Set(["garden", "orchard", "apiary", "forager", "quarry", "dig", "woodcutter", "sawpit", "fisher", "market"]);
const CART_ID0 = 2 ** 30;
const EVENING_ID0 = 2 ** 29;

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

interface Commuter {
  id: number;
  pts: [number, number][];
  speed: number; // m per game minute: a hungry or tired resident walks slower
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
    lights.push({ id: b.id, x, y, kind: "house" });
  }
  for (const b of Object.values(s.buildings)) {
    if (!isWorkplace(b) || !worked.has(b.id)) continue;
    const input = WORKSHOP_INPUT[b.template];
    if (input && s.stock[input] <= 1e-9) continue;
    const [x, y] = centre(b);
    lights.push({ id: b.id, x, y, kind: b.template === "tavern" ? "tavern" : "work" });
  }
  const rests = restsOf(s);
  if (net.adj.size === 0) return { day, trips, rests, traffic, lights };

  // door -> its spot on the net, once per building
  const spot = new Map<number, Spot | null>();
  const locate = (b: Building): Spot | null => {
    let l = spot.get(b.id);
    if (l === undefined) {
      const [x, y] = lotFront(b);
      l = snapToRoad(net, x, y);
      spot.set(b.id, l);
    }
    return l;
  };
  // a walk drawn as points: the first door, the road where the walk joins it, the nodes passed, the road where it leaves, the last door
  const trail = (nodes: number[], from: [number, number], to: [number, number], doors: [[number, number], [number, number]]): [number, number][] => {
    const pts: [number, number][] = [doors[0], from, ...nodes.map((n): [number, number] => [s.roads.nodes[n].x, s.roads.nodes[n].y]), to, doors[1]];
    return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
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

  // the traffic of a walk: the edges between the nodes it passes, and the edges of its ends when it runs along
  // them for a stretch (a door right on a node counts nothing there); its own edge when it stays on one
  const countTraffic = (walk: Walk, from: Spot, to: Spot) => {
    const used = new Set<number>();
    if (walk.nodes.length === 0) used.add(from.edge.id);
    else {
      const first = walk.nodes[0];
      const last = walk.nodes[walk.nodes.length - 1];
      if ((from.edge.a === first ? from.t : from.edge.length - from.t) > 0) used.add(from.edge.id);
      if ((to.edge.a === last ? to.t : to.edge.length - to.t) > 0) used.add(to.edge.id);
      for (let i = 1; i < walk.nodes.length; i++) {
        const e = edgeOf.get(pair(walk.nodes[i - 1], walk.nodes[i]));
        if (e) used.add(e.id);
      }
    }
    for (const id of used) traffic[id] = (traffic[id] ?? 0) + 1;
  };

  // commuters grouped by the spot of their home: one tree per spot
  const limit = MAX_COMMUTE * WALK_SPEED;
  const groups = new Map<string, { spot: Spot; items: { id: number; from: [number, number]; to: [number, number]; work: Spot; speed: number }[] }>();
  for (const r of Object.values(s.residents)) {
    if (r.job === null) continue;
    const hh = s.households[r.household];
    const home = hh && hh.home !== null ? s.buildings[hh.home] : undefined;
    const work = s.buildings[r.job];
    if (!isFinishedHouse(home) || !isWorkplace(work)) continue;
    const hl = locate(home);
    const wl = locate(work);
    if (!hl || !wl) continue;
    const item = { id: r.id, from: lotFront(home), to: lotFront(work), work: wl, speed: WALK_SPEED * residentMoveFactor(r) };
    const key = `${hl.edge.id}:${hl.t}`;
    const g = groups.get(key);
    if (g) g.items.push(item);
    else groups.set(key, { spot: hl, items: [item] });
  }
  const routed: Commuter[] = [];
  // what the figure of a walker needs of the resident: their sex and age today
  const person = (id: number) => ({ who: id, sex: s.residents[id].sex, age: ageOf(s.residents[id].born, s.gameMinutes) });
  for (const { spot: from, items } of groups.values()) {
    const tree = spotTree(net, from, limit);
    for (const c of items) {
      const walk = walkTo(tree, from, c.work, limit);
      if (!walk) continue;
      countTraffic(walk, from, c.work);
      routed.push({ id: c.id, pts: round2(trail(walk.nodes, from.at, c.work.at, [c.from, c.to])), speed: c.speed });
    }
  }

  // walkers: the MAX_WALKERS commuters with the lowest hash
  routed.sort((p, q) => unit(p.id, 1) - unit(q.id, 1) || p.id - q.id);
  for (const c of routed.slice(0, MAX_WALKERS)) {
    const pts = c.pts;
    const travel = polyLength(pts) / c.speed;
    // leaves within 06:00-07:00 but early enough to be at work by 07:00
    const out = TO_WORK + unit(c.id, 2) * Math.max(0, 60 - travel);
    const back = HOME_AT + unit(c.id, 3) * 60;
    trips.push({ id: c.id * 2, kind: "walk", pts, depart: out, speed: c.speed, ...person(c.id), purpose: "work" });
    trips.push({ id: c.id * 2 + 1, kind: "walk", pts: [...pts].reverse(), depart: back, speed: c.speed, ...person(c.id), purpose: "home" });
  }

  // evenings: up to MAX_GUESTS households from the homes within reach of each staffed tavern walk there at 19-21 and back at 21-22
  let guest = 0;
  const taverns = Object.values(s.buildings).filter((b) => b.template === "tavern" && isWorkplace(b) && worked.has(b.id));
  const homes = new Map<number, number>(); // house id -> an adult's id of its household, for the hash
  for (const h of Object.values(s.households)) if (h.home !== null && h.members.length > 0 && !homes.has(h.home)) homes.set(h.home, h.members[0]);
  for (const t of taverns) {
    const tl = locate(t);
    if (!tl) continue;
    const tree = spotTree(net, tl, EVENING.tavernReach);
    const cands: { who: number; house: Building }[] = [];
    for (const [hid, who] of homes) if (isFinishedHouse(s.buildings[hid])) cands.push({ who, house: s.buildings[hid] });
    cands.sort((p, q) => unit(p.who, 5) - unit(q.who, 5) || p.who - q.who);
    let n = 0;
    for (const c of cands) {
      if (n >= MAX_GUESTS) break;
      const hl = locate(c.house);
      const walk = hl && walkTo(tree, tl, hl, EVENING.tavernReach);
      if (!hl || !walk) continue;
      const pts = round2(trail([...walk.nodes].reverse(), hl.at, tl.at, [lotFront(c.house), lotFront(t)]));
      if (polyLength(pts) < 5) continue;
      const out = workHours(s).end * 60 + unit(c.who, 6) * 90;
      const back = 21 * 60 + unit(c.who, 7) * 45;
      const speed = WALK_SPEED * residentMoveFactor(s.residents[c.who]);
      trips.push({ id: EVENING_ID0 + guest++, kind: "walk", pts, depart: out, speed, ...person(c.who), purpose: "tavern" });
      trips.push({ id: EVENING_ID0 + guest++, kind: "walk", pts: [...pts].reverse(), depart: back, speed, ...person(c.who), purpose: "home" });
      n++;
    }
  }

  // carts: one per load of yesterday's output, producer -> camp
  const camp = snapToRoad(net, 0, 0);
  if (camp) {
    const tree = spotTree(net, camp, CART_RANGE);
    let n = 0;
    for (const b of Object.values(s.buildings)) {
      const good = GOOD[b.template];
      if (b.state !== "active" || !good || !BUILDINGS[b.template]) continue;
      const made = s.prod.yesterday[b.id] ?? 0;
      if (!(made > 0)) continue;
      const loads = Math.min(MAX_CARTS, Math.ceil(made / LOAD[good] - 1e-9));
      const l = locate(b);
      const walk = l && walkTo(tree, camp, l, CART_RANGE);
      if (!l || !walk) continue;
      const pts = round2(trail([...walk.nodes].reverse(), l.at, camp.at, [lotFront(b), [0, 0]]));
      for (let k = 0; k < loads; k++) {
        trips.push({ id: CART_ID0 + n++, kind: "cart", pts, depart: WORK_FROM + ((k + 0.5) * (WORK_TO - WORK_FROM)) / loads, speed: CART_SPEED });
      }
    }
    // families on their way: a cart from the built node farthest from the camp to the promised house,
    // timed to arrive when they do (the trip repeats daily, but the family is gone by then)
    let far: number | null = null;
    for (const [node, d] of tree.dist) if (far === null || d > tree.dist.get(far)! || (d === tree.dist.get(far) && node < far)) far = node;
    const fromFar = far === null || s.incoming.length === 0 ? null : treeFrom(net, [[far, 0]], CART_RANGE);
    for (const f of s.incoming) {
      const house = s.buildings[f.house];
      const l = fromFar && isFinishedHouse(house) ? locate(house) : null;
      const walk = l && fromFar && walkTo(fromFar, null, l, CART_RANGE);
      if (!l || !walk || far === null) continue;
      const farAt: [number, number] = [s.roads.nodes[far].x, s.roads.nodes[far].y];
      const pts = round2(trail(walk.nodes, farAt, l.at, [farAt, lotFront(house)]));
      const depart = f.arrive - polyLength(pts) / CART_SPEED;
      trips.push({ id: CART_ID0 + n++, kind: "cart", pts, depart: (((depart + START_MINUTE_OF_DAY) % 1440) + 1440) % 1440, speed: CART_SPEED });
    }
  }
  return { day, trips, rests, traffic, lights };
}

// Where every resident stays off their walks: in their house (out of sight), else scattered about the camp at the
// founding point; at work in work hours when they have a job (and are not in class), on the plot when it is worked in
// the open. The builders (the artel: adults without work, or whose workplace stands idle; everyone in a toloka) work
// on the construction sites instead, each at one of them.
function restsOf(s: SimState): Rest[] {
  const housed = (r: Resident) => {
    const hh = s.households[r.household];
    const b = hh && hh.home !== null ? s.buildings[hh.home] : undefined;
    return isFinishedHouse(b);
  };
  const all = Object.values(s.residents);
  const camp = CAMP_PER * Math.sqrt(all.filter((r) => !housed(r)).length);
  const sites = constructionSites(s);
  const toloka = tolokaActive(s.levers, s.gameMinutes);
  const idle = sites.length ? idleWorkplaces(s) : new Set<number>();
  return all.map((r) => {
    const age = ageOf(r.born, s.gameMinutes);
    const a = 2 * Math.PI * unit(r.id, 8);
    const d = CAMP_CLEAR + camp * Math.sqrt(unit(r.id, 9));
    const home: [number, number] | null = housed(r) ? null : [cm(d * Math.cos(a)), cm(d * Math.sin(a))];
    const job = r.job !== null && !r.inClass ? s.buildings[r.job] : undefined;
    const builder = sites.length > 0 && isAdultAge(age) && !r.inClass && (toloka || r.job === null || idle.has(r.job));
    const at = builder ? sites[Math.floor(unit(r.id, 30) * sites.length)](r.id) : isWorkplace(job) ? (OPEN_AIR.has(job.template) ? spotOn(job.footprint, r.id, centre(job)) : null) : undefined;
    const work = at !== undefined ? { at, from: WORK_FROM, to: WORK_TO } : undefined;
    return { who: r.id, sex: r.sex, age, home, ...(work && { work }) };
  });
}

// The construction going on, each as a builder's spot on it: a building rising (on its footprint) or being rebuilt (by
// its door, the house stands meanwhile), a forest being cleared, a road being laid (along the edge).
function constructionSites(s: SimState): ((who: number) => [number, number])[] {
  if (!constructionWork(s.buildings, s.roads, s.clearings, s.stock)) return [];
  const out: ((who: number) => [number, number])[] = [];
  for (const b of Object.values(s.buildings)) {
    if (b.state !== "active") out.push((who) => spotOn(b.footprint, who, centre(b)));
    else if (b.upgrade) {
      const [x, y] = lotFront(b);
      out.push((who) => [cm(x + 3 * (unit(who, 31) - 0.5)), cm(y + 3 * (unit(who, 32) - 0.5))]);
    }
  }
  for (const c of s.clearings ?? []) if (!isCleared(c)) out.push((who) => spotOn(c.pts, who, c.pts[0]));
  for (const id of workableEdges(s.roads, s.stock)) {
    const e = s.roads.edges[id];
    const [p, q] = [s.roads.nodes[e.a], s.roads.nodes[e.b]];
    out.push((who) => {
      const t = unit(who, 33);
      return [cm(p.x + (q.x - p.x) * t), cm(p.y + (q.y - p.y) * t)];
    });
  }
  return out;
}

const cm = (v: number) => Math.round(v * 100) / 100; // to the centimetre, as the trips

// A resident's own spot in an area: a point of its outline picked by their id, `fallback` if none is hit.
function spotOn(pts: [number, number][], who: number, fallback: [number, number]): [number, number] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let k = 0; k < 8; k++) {
    const x = x0 + (x1 - x0) * unit(who, 20 + 2 * k);
    const y = y0 + (y1 - y0) * unit(who, 21 + 2 * k);
    if (pointInPolygon(x, y, pts)) return [cm(x), cm(y)];
  }
  return fallback;
}
