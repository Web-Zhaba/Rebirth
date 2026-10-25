import { BUILDINGS, UPGRADE } from "./buildings";
import { isUnlocked } from "./goals";
import { ageOf, buildNet, countResidents, isFinishedHouse, lotFront, nearestNode, reach, type Net } from "./people";
import { countServices, covers, isService, SERVICE, SERVICE_IDS, SERVICES, withService } from "./services";
import type { Building, RoadGraph, ServiceId, ServiceStats, SimState } from "./types";

// ---------- coverage ----------

// Bit mask per finished house of the services that cover it: network distance along built roads from
// the service's lot front to the house's lot front (both offsets to the nearest node included) within
// the service's reach, and the service finished and, if it has jobs, staffed by at least one worker.
export function computeCoverage(s: Pick<SimState, "buildings" | "roads" | "residents">): Record<number, number> {
  const out: Record<number, number> = {};
  const services = Object.values(s.buildings).filter((b) => b.state === "active" && isService(b.template));
  if (services.length === 0) return out;
  const net = buildNet(s.roads);
  if (net.adj.size === 0) return out;
  const workers = new Map<number, number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);
  const spots: { id: number; node: number; off: number }[] = [];
  for (const b of Object.values(s.buildings)) {
    if (!isFinishedHouse(b)) continue;
    const [x, y] = lotFront(b);
    const l = nearestNode(net, x, y);
    if (l) spots.push({ id: b.id, node: l.node, off: l.off });
  }
  for (const b of services) {
    const id = b.template as ServiceId;
    if (BUILDINGS[id].jobs > 0 && (workers.get(b.id) ?? 0) < 1) continue;
    const range = SERVICES[id].reach;
    const [x, y] = lotFront(b);
    const from = nearestNode(net, x, y);
    if (!from || from.off > range) continue;
    const dist = reach(net, from.node, range - from.off);
    for (const h of spots) {
      const d = dist.get(h.node);
      if (d !== undefined && d + from.off + h.off <= range) out[h.id] = withService(out[h.id] ?? 0, id);
    }
  }
  return out;
}

// ---------- land value ----------

const BUCKET = SERVICE.landRadius;
const bkey = (bx: number, by: number) => bx * 65536 + by;

// 20 + 12 per covered service + 0.3 x (mood of the households within 100 m - 50), clamped to 0..100.
export function computeLandValue(s: Pick<SimState, "buildings" | "households">, coverage: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  const grid = new Map<number, { x: number; y: number; mood: number }[]>();
  for (const h of Object.values(s.households)) {
    const home = h.home === null ? undefined : s.buildings[h.home];
    if (!home) continue;
    const k = bkey(Math.floor(home.lot.cx / BUCKET), Math.floor(home.lot.cy / BUCKET));
    const item = { x: home.lot.cx, y: home.lot.cy, mood: h.mood };
    const l = grid.get(k);
    if (l) l.push(item);
    else grid.set(k, [item]);
  }
  for (const b of Object.values(s.buildings)) {
    if (!isFinishedHouse(b)) continue;
    const bx = Math.floor(b.lot.cx / BUCKET);
    const by = Math.floor(b.lot.cy / BUCKET);
    let sum = 0;
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const o of grid.get(bkey(bx + dx, by + dy)) ?? []) {
          if (Math.hypot(o.x - b.lot.cx, o.y - b.lot.cy) > SERVICE.landRadius) continue;
          sum += o.mood;
          n++;
        }
      }
    }
    const moodTerm = n > 0 ? SERVICE.landMoodWeight * (sum / n - 50) : 0;
    const v = SERVICE.landBase + SERVICE.landPerService * countServices(coverage[b.id]) + moodTerm;
    out[b.id] = Math.round(Math.min(100, Math.max(0, v)));
  }
  return out;
}

// ---------- daily ----------

// Coverage and land value only (on load and after commands that change roads or buildings).
export function refreshServices<T extends SimState>(s: T): T {
  const coverage = computeCoverage(s);
  return { ...s, coverage, landValue: computeLandValue(s, coverage) };
}

// Runs at the end of the daily chain (moods and jobs are already today's): coverage, land value,
// school attendance and literacy, and the upgrade of houses that stayed good for 10 days.
export function dailyServices(s: SimState): SimState {
  const { coverage, landValue } = refreshServices(s);
  const now = s.gameMinutes;

  let residents = s.residents;
  for (const r of Object.values(s.residents)) {
    const age = ageOf(r.born, now);
    let next = r;
    if (age >= SERVICE.schoolFrom && age < SERVICE.schoolTo) {
      const home = s.households[r.household]?.home;
      if (home != null && covers(coverage[home], "school")) next = { ...r, school: r.school + 1 };
    } else if (age >= SERVICE.schoolTo && !r.literate && r.school >= SERVICE.literateDays) next = { ...r, literate: true };
    if (next !== r) {
      if (residents === s.residents) residents = { ...residents };
      residents[r.id] = next;
    }
  }

  const moodAt = new Map<number, number>();
  for (const h of Object.values(s.households)) if (h.home !== null) moodAt.set(h.home, h.mood);
  let buildings = s.buildings;
  for (const b of Object.values(s.buildings)) {
    if (!isUnlocked(s.goals, "upgrade") || b.template !== UPGRADE.template || !isFinishedHouse(b) || b.level >= 2 || b.upgrade) continue;
    const mood = moodAt.get(b.id);
    const good = mood !== undefined && mood >= SERVICE.upgradeMood && (landValue[b.id] ?? 0) >= SERVICE.upgradeLand;
    const streak = good ? b.streak + 1 : 0;
    let next: Building = b;
    if (streak >= SERVICE.upgradeDays) next = { ...b, streak: 0, upgrade: { labor: UPGRADE.labor, done: 0, paid: false } };
    else if (streak !== b.streak) next = { ...b, streak };
    if (next !== b) {
      if (buildings === s.buildings) buildings = { ...buildings };
      buildings[b.id] = next;
    }
  }
  return { ...s, residents, buildings, coverage, landValue };
}

// ---------- aggregates ----------

export function serviceStats(s: Pick<SimState, "buildings" | "residents" | "gameMinutes" | "coverage" | "landValue">): ServiceStats {
  const covered = Object.fromEntries(SERVICE_IDS.map((id) => [id, 0])) as Record<ServiceId, number>;
  let houses = 0;
  let level2 = 0;
  let value = 0;
  for (const b of Object.values(s.buildings)) {
    if (!isFinishedHouse(b)) continue;
    houses++;
    if (b.level >= 2) level2++;
    value += s.landValue[b.id] ?? 0;
    for (const id of SERVICE_IDS) if (covers(s.coverage[b.id], id)) covered[id]++;
  }
  const c = countResidents(s.residents, s.gameMinutes);
  return { houses, covered, literate: c.adults > 0 ? c.literate / c.adults : 0, avgLandValue: houses > 0 ? value / houses : 0, level2 };
}

// ---------- reach drawing (also used on the main thread for the placement preview) ----------

export type Segment = [[number, number], [number, number]];

// Built road stretches within `range` metres of a lot front (x, y), as straight segments; an edge the
// reach ends inside is cut at that point.
export function reachSegments(roads: RoadGraph, x: number, y: number, range: number, net: Net = buildNet(roads)): Segment[] {
  const from = nearestNode(net, x, y);
  if (!from || from.off > range) return [];
  const limit = range - from.off;
  const dist = reach(net, from.node, limit);
  const out: Segment[] = [];
  for (const e of Object.values(roads.edges)) {
    if (e.done < e.labor) continue;
    const da = dist.get(e.a);
    const db = dist.get(e.b);
    if (da === undefined && db === undefined) continue;
    const a = roads.nodes[e.a];
    const b = roads.nodes[e.b];
    if (da !== undefined && db !== undefined) {
      out.push([[a.x, a.y], [b.x, b.y]]);
      continue;
    }
    const [from0, to0, d] = da !== undefined ? [a, b, da] : [b, a, db!];
    const t = Math.min(1, Math.max(0, (limit - d) / e.length));
    out.push([[from0.x, from0.y], [from0.x + (to0.x - from0.x) * t, from0.y + (to0.y - from0.y) * t]]);
  }
  return out;
}
