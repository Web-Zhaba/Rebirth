import { BUILDINGS, UPGRADE } from "./buildings";
import { isUnlocked } from "./tech";
import { ageOf, countResidents, isFinishedHouse, lotFront, snapToRoad, spotTree, walkMetres, type Net, type Spot } from "./people";
import { roadNet } from "./roadNetCache";
import { countServices, covers, isService, learnPerDay, SERVICE, SERVICE_IDS, SERVICE_LIST, SERVICES, withService } from "./services";
import { classPupils, schoolSeats } from "./school";
import { finishedMonuments, monumentLand, monumentsNear } from "./monuments";
import type { Building, RoadGraph, ServiceId, ServiceStats, SimState } from "./types";

// ---------- coverage ----------

export function computeCoverage(s: Pick<SimState, "buildings" | "roads" | "residents">): Record<number, number> {
  const out: Record<number, number> = {};
  const services = Object.values(s.buildings).filter((b) => b.state === "active" && isService(b.template));
  if (services.length === 0) return out;
  const net = roadNet(s.roads);
  if (net.edges.length === 0) return out;
  const workers = new Map<number, number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);

  // Кэшируем позиции домов с их координатами для быстрой AABB-отсечки
  const spots: { id: number; spot: Spot; x: number; y: number }[] = [];
  for (const b of Object.values(s.buildings)) {
    if (!isFinishedHouse(b)) continue;
    const [x, y] = lotFront(b);
    const p = snapToRoad(net, x, y);
    if (p) spots.push({ id: b.id, spot: p, x, y });
  }

  for (const b of services) {
    const id = b.template as ServiceId;
    if (BUILDINGS[id].jobs > 0 && (workers.get(b.id) ?? 0) < 1) continue;
    const range = SERVICES[id].reach;
    const [x, y] = lotFront(b);
    const from = snapToRoad(net, x, y);
    if (!from || from.off > range) continue;

    const tree = spotTree(net, from, range);
    for (const h of spots) {
      // Ранняя геометрическая отсечка: расстояние по дорогам не может быть меньше прямого евклидова расстояния
      if (Math.abs(h.x - x) > range || Math.abs(h.y - y) > range) continue;
      if (walkMetres(tree, from, h.spot) <= range) {
        out[h.id] = withService(out[h.id] ?? 0, id);
      }
    }
  }
  return out;
}

export interface ServiceCoveragePreview {
  houses: number;
  residents: number;
  newHouses: number;
  newResidents: number;
}

// Potential coverage from a candidate service door, using the same road-distance primitives as live coverage.
// Workers are intentionally ignored: this previews where the service can reach once it is staffed.
export function previewServiceCoverage(
  s: Pick<SimState, "buildings" | "roads" | "households" | "coverage">,
  id: ServiceId,
  x: number,
  y: number,
): ServiceCoveragePreview {
  const zero = { houses: 0, residents: 0, newHouses: 0, newResidents: 0 };
  const net = roadNet(s.roads);
  if (net.edges.length === 0) return zero;
  const range = SERVICES[id].reach;
  const from = snapToRoad(net, x, y);
  if (!from || from.off > range) return zero;
  const tree = spotTree(net, from, range);
  const peopleAt = new Map<number, number>();
  for (const h of Object.values(s.households)) {
    if (h.home !== null) peopleAt.set(h.home, (peopleAt.get(h.home) ?? 0) + h.members.length);
  }

  let houses = 0;
  let residents = 0;
  let newHouses = 0;
  let newResidents = 0;
  for (const b of Object.values(s.buildings)) {
    if (!isFinishedHouse(b)) continue;
    const [hx, hy] = lotFront(b);
    if (Math.abs(hx - x) > range || Math.abs(hy - y) > range) continue;
    const spot = snapToRoad(net, hx, hy);
    if (!spot || walkMetres(tree, from, spot) > range) continue;
    const people = peopleAt.get(b.id) ?? 0;
    houses++;
    residents += people;
    if (!covers(s.coverage[b.id], id)) {
      newHouses++;
      newResidents += people;
    }
  }
  return { houses, residents, newHouses, newResidents };
}

// ---------- land value ----------

const BUCKET = SERVICE.landRadius;
const LAND_RADIUS_SQ = SERVICE.landRadius * SERVICE.landRadius;
const bkey = (bx: number, by: number) => bx * 65536 + by;

export function computeLandValue(s: Pick<SimState, "buildings" | "households">, coverage: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  const monuments = finishedMonuments(s.buildings);
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
          const offX = o.x - b.lot.cx;
          const offY = o.y - b.lot.cy;
          if (offX * offX + offY * offY > LAND_RADIUS_SQ) continue;
          sum += o.mood;
          n++;
        }
      }
    }
    const moodTerm = n > 0 ? SERVICE.landMoodWeight * (sum / n - 50) : 0;
    const v = SERVICE.landBase + SERVICE.landPerService * countServices(coverage[b.id]) + moodTerm + monumentLand(monumentsNear(monuments, b.lot.cx, b.lot.cy));
    out[b.id] = Math.round(Math.min(100, Math.max(0, v)));
  }
  return out;
}

// ---------- daily ----------

export function refreshServices<T extends SimState>(s: T): T {
  const coverage = computeCoverage(s);
  return { ...s, coverage, landValue: computeLandValue(s, coverage) };
}

export function upgradeShortfall(land: number, services: number | undefined, mood: number | undefined): string[] {
  const out: string[] = [];
  if (land < SERVICE.upgradeLand) {
    const missing = SERVICE_LIST.filter((sv) => !covers(services, sv.id)).map((sv) => sv.name.toLowerCase());
    out.push(`стоимость участка ${land} из ${SERVICE.upgradeLand}${missing.length ? `, нет: ${missing.join(", ")}` : ""}`);
  }
  if (mood === undefined || mood < SERVICE.upgradeMood) out.push(`настроение ${mood === undefined ? 0 : mood} из ${SERVICE.upgradeMood}`);
  return out;
}

export function upgradeBlockers(s: Pick<SimState, "progress" | "coverage" | "landValue">, b: Building, mood: number | undefined): string[] {
  if (b.template !== UPGRADE.template || !isFinishedHouse(b) || b.level >= 2 || b.upgrade) return [];
  const out = isUnlocked(s.progress, "upgrade") ? [] : ["откроется с технологией «Просторное жильё»"];
  return [...out, ...upgradeShortfall(s.landValue[b.id] ?? 0, s.coverage[b.id], mood)];
}

export function dailyServices(s: SimState): SimState {
  const { coverage, landValue } = refreshServices(s);
  const now = s.gameMinutes;
  const attending = classPupils({ ...s, coverage });

  let residents = s.residents;
  for (const r of Object.values(s.residents)) {
    const age = ageOf(r.born, now);
    const inClass = attending.has(r.id);
    const school = inClass ? Math.min(100, r.school + learnPerDay(age >= SERVICE.schoolTo)) : r.school;
    const next = school === r.school && inClass === !!r.inClass ? r : { ...r, school, literate: r.literate || school >= 100, inClass };
    if (next !== r) {
      if (residents === s.residents) residents = { ...residents };
      residents[r.id] = next;
    }
  }

  const moodAt = new Map<number, number>();
  for (const h of Object.values(s.households)) if (h.home !== null) moodAt.set(h.home, h.mood);
  let buildings = s.buildings;
  for (const b of Object.values(s.buildings)) {
    if (!isUnlocked(s.progress, "upgrade") || b.template !== UPGRADE.template || !isFinishedHouse(b) || b.level >= 2 || b.upgrade) continue;
    const good = upgradeShortfall(landValue[b.id] ?? 0, coverage[b.id], moodAt.get(b.id)).length === 0;
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

export function serviceStats(s: Pick<SimState, "buildings" | "residents" | "households" | "gameMinutes" | "coverage" | "landValue" | "levers">): ServiceStats {
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
  return { houses, covered, pupils: classPupils(s).size, seats: schoolSeats(s), literate: c.adults > 0 ? c.literate / c.adults : 0, avgLandValue: houses > 0 ? value / houses : 0, level2 };
}

// ---------- reach drawing ----------

export type Segment = [[number, number], [number, number]];

export function reachSegments(roads: RoadGraph, x: number, y: number, range: number, net: Net = roadNet(roads)): Segment[] {
  const p = snapToRoad(net, x, y);
  if (!p || p.off > range) return [];
  const limit = range - p.off;
  const tree = spotTree(net, p, range);
  const out: Segment[] = [];
  for (const e of net.edges) {
    const spans: [number, number][] = [];
    const da = tree.dist.get(e.a);
    const db = tree.dist.get(e.b);
    if (da !== undefined) spans.push([0, limit - da]);
    if (db !== undefined) spans.push([e.length - (limit - db), e.length]);
    if (e.id === p.edge.id) spans.push([p.t - limit, p.t + limit]);
    const at = (m: number): [number, number] => [e.ax + ((e.bx - e.ax) * m) / e.length, e.ay + ((e.by - e.ay) * m) / e.length];
    const clipped = spans
      .map(([lo, hi]): [number, number] => [Math.max(0, lo), Math.min(e.length, hi)])
      .filter(([lo, hi]) => hi > lo)
      .sort((p1, p2) => p1[0] - p2[0]);
    let cur: [number, number] | null = null;
    for (const span of clipped) {
      if (cur && span[0] <= cur[1]) cur[1] = Math.max(cur[1], span[1]);
      else {
        if (cur) out.push([at(cur[0]), at(cur[1])]);
        cur = [span[0], span[1]];
      }
    }
    if (cur) out.push([at(cur[0]), at(cur[1])]);
  }
  return out;
}