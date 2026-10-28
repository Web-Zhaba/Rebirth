import { BUILDINGS, foodCapacity, houseCapacity } from "./buildings";
import { buildFloor, buildingPriority, capacityOf } from "./jobs";
import { isCleared } from "./clearing";
import { assignFields, bears, expectedKg, FIELD, FOOD_RATE, foodKgHour, idleGumnos, idleOrchards, haOf, HARVEST_END_DAY, idleFarmers, idleWorkers, idleWorkplaces, jobsOf, workOf } from "./fields";
import { nextRandom } from "./rng";
import { covers, SERVICE, servicesIn } from "./services";
import { workableEdges } from "./roads";
import { rationFood, tolokaActive, workLength, type Levers } from "./levers";
import { calendar, DAYS_PER_SEASON, dayOf, dayStart, YEAR_DAYS, YEAR_MIN } from "./time";
import type { Building, BuildingQuery, Clearing, Household, Incoming, PeopleState, PeopleStats, Resident, RoadGraph, SimState, Stock, EventKind } from "./types";
import { cropOf } from "./tech";
import { foodNeedFactor, mortalityFactor, orchardQuality } from "./weatherEffects";
import type { WeatherState } from "./weather";
import { CELL_SIZE } from "./zones";

export const FOUNDERS = 14;
export const ADULT_MIN = 16;
export const ADULT_MAX = 60;
export const WALK_SPEED = 4000 / 60;
export const MAX_COMMUTE = 45;
export const MAX_EVENTS = 50;

export const RATES = {
  birthYear: 0.3,
  marriageDay: 0.02,
  maxMarriagesPerDay: 3,
  immigrationDay: 1.0,
  moodLeaveDay: 0.1,
};
export const MOOD_START = 60;
export const MOOD_LEAVE = 35;
export const FOOD = { adult: 0.7, child: 0.45, immigrantDays: 60 };

const DEATH_BANDS: [number, number][] = [
  [5, 0.03],
  [15, 0.005],
  [50, 0.008],
  [60, 0.02],
  [70, 0.05],
  [Infinity, 0.15],
];
export const deathRate = (age: number): number => DEATH_BANDS.find(([max]) => age < max)![1];

// ---------- names ----------

export const MALE_NAMES = [
  "Иван", "Фёдор", "Пётр", "Василий", "Степан", "Григорий", "Дмитрий", "Никита", "Алексей", "Андрей",
  "Семён", "Михаил", "Тимофей", "Яков", "Матвей", "Егор", "Кузьма", "Лаврентий", "Прохор", "Трофим",
  "Ермолай", "Артемий", "Макар", "Назар", "Ефим", "Силантий", "Игнат", "Харитон",
];
export const FEMALE_NAMES = [
  "Марья", "Аграфена", "Пелагея", "Анна", "Евдокия", "Прасковья", "Татьяна", "Ульяна", "Фекла", "Матрёна",
  "Дарья", "Ксения", "Акулина", "Домна", "Устинья", "Василиса", "Агафья", "Настасья", "Авдотья", "Аксинья",
  "Марфа", "Варвара", "Степанида", "Ирина", "Улита", "Федосья", "Лукерья",
];
export const SURNAMES = [
  "Смирнов", "Кузнецов", "Попов", "Васильев", "Петров", "Соколов", "Михайлов", "Новиков", "Фёдоров", "Морозов",
  "Волков", "Алексеев", "Лебедев", "Семёнов", "Егоров", "Павлов", "Козлов", "Степанов", "Николаев", "Орлов",
  "Андреев", "Макаров", "Никитин", "Захаров", "Зайцев", "Соловьёв", "Борисов", "Яковлев", "Григорьев", "Романов",
  "Воробьёв", "Сергеев", "Кузьмин", "Фролов", "Александров", "Дмитриев", "Королёв", "Гусев", "Ильин", "Максимов",
  "Поляков", "Сорокин", "Белов", "Медведев", "Антонов", "Тарасов", "Жуков", "Баранов", "Комаров", "Давыдов",
  "Седых", "Черных", "Долгих", "Рыжих",
];

const FEM_SUFFIX = /(ов|ев|ёв|ин|ын)$/;
export const surnameFor = (last: string, sex: "m" | "f"): string => (sex === "f" && FEM_SUFFIX.test(last) ? `${last}а` : last);
export const familyGenitive = (last: string): string => (FEM_SUFFIX.test(last) ? `${last}ых` : last);
export const fullName = (r: Pick<Resident, "first" | "last">): string => `${r.first} ${r.last}`;

// ---------- working copy ----------

type Rand = () => number;

interface W extends PeopleState {
  now: number;
}

const pick = <T>(arr: readonly T[], rand: Rand): T => arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];

export const ageOf = (born: number, now: number): number => (now - born) / YEAR_MIN;
export const isAdultAge = (age: number): boolean => age >= ADULT_MIN && age < ADULT_MAX;

export const emptyPeople = (): PeopleState => ({ residents: {}, households: {}, nextPersonId: 1, nextHouseholdId: 1, events: [] });

function cloneW(s: PeopleState, now: number): W {
  const residents: Record<number, Resident> = {};
  for (const r of Object.values(s.residents)) residents[r.id] = { ...r };
  const households: Record<number, Household> = {};
  for (const h of Object.values(s.households)) households[h.id] = { ...h, members: h.members.slice() };
  return { residents, households, nextPersonId: s.nextPersonId, nextHouseholdId: s.nextHouseholdId, events: s.events.slice(), now };
}

const homePos = (b: { lot: { cx: number; cy: number } } | undefined): [number, number] | undefined => (b ? [b.lot.cx, b.lot.cy] : undefined);

function say(w: W, kind: EventKind, text: string, pos?: [number, number]): void {
  w.events.push(pos ? { at: w.now, kind, text, pos } : { at: w.now, kind, text });
}

function addPerson(w: W, first: string, last: string, sex: "m" | "f", age: number, household: number): Resident {
  const id = w.nextPersonId++;
  const r: Resident = { id, first, last, sex, born: w.now - age * YEAR_MIN, household, spouse: null, job: null, commute: null, idleDays: 0, literate: false, school: 0 };
  w.residents[id] = r;
  return r;
}

function makeFamily(w: W, rand: Rand, ageMin: number, ageMax: number, kids: number, home: number | null, founder = false): Household {
  const last = pick(SURNAMES, rand);
  const id = w.nextHouseholdId++;
  const h: Household = { id, last, home, members: [], arrived: w.now, founder, mood: MOOD_START };
  w.households[id] = h;
  const hAge = ageMin + rand() * (ageMax - ageMin);
  const wAge = ageMin + rand() * (ageMax - ageMin);
  const husband = addPerson(w, pick(MALE_NAMES, rand), last, "m", hAge, id);
  const wife = addPerson(w, pick(FEMALE_NAMES, rand), surnameFor(last, "f"), "f", wAge, id);
  husband.spouse = wife.id;
  wife.spouse = husband.id;
  h.members.push(husband.id, wife.id);
  const maxKid = Math.max(0, Math.min(14, wAge - 18));
  for (let k = 0; k < kids; k++) {
    const sex = rand() < 0.5 ? "m" : "f";
    const kid = addPerson(w, pick(sex === "m" ? MALE_NAMES : FEMALE_NAMES, rand), surnameFor(last, sex), sex, rand() * maxKid, id);
    h.members.push(kid.id);
  }
  return h;
}

const FOUNDER_KIDS = [[2, 2, 1, 1], [1, 2, 2, 1], [2, 1, 1, 2], [1, 1, 2, 2], [2, 2, 2, 0], [0, 2, 2, 2], [2, 0, 2, 2], [2, 2, 0, 2]];

export function createFounders(rng: number, now: number): { people: PeopleState; rng: number } {
  let state = rng;
  const rand: Rand = () => {
    const [v, n] = nextRandom(state);
    state = n;
    return v;
  };
  const w: W = { ...emptyPeople(), now };
  const kids = pick(FOUNDER_KIDS, rand);
  for (let i = 0; i < 4; i++) makeFamily(w, rand, 20, 40, kids[i], null, true);
  const { now: _now, ...people } = w;
  return { people, rng: state };
}

// ---------- road net (built edges only) ----------

export interface NetEdge {
  id: number;
  a: number;
  b: number;
  length: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
  l2: number;
}

export interface Net {
  adj: Map<number, [number, number][]>;
  edges: NetEdge[];
}

export function buildNet(g: RoadGraph): Net {
  const adj = new Map<number, [number, number][]>();
  const link = (a: number, b: number, len: number) => {
    const l = adj.get(a);
    if (l) l.push([b, len]);
    else adj.set(a, [[b, len]]);
  };
  const edges: NetEdge[] = [];
  for (const e of Object.values(g.edges)) {
    if (e.done < e.labor) continue;
    link(e.a, e.b, e.length);
    link(e.b, e.a, e.length);
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    edges.push({
      id: e.id,
      a: e.a,
      b: e.b,
      length: e.length,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      dx,
      dy,
      l2: dx * dx + dy * dy,
    });
  }
  return { adj, edges };
}

export interface Spot {
  edge: NetEdge;
  t: number;
  off: number;
  at: [number, number];
}

// Оптимизированный snapToRoad: без аллокаций в цикле и без вычислений sqrt для каждого ребра
export function snapToRoad(net: Net, x: number, y: number): Spot | null {
  let bestEdge: NetEdge | null = null;
  let bestF = 0;
  let bestAtX = 0, bestAtY = 0;
  let bestOff2 = Infinity;

  const len = net.edges.length;
  for (let i = 0; i < len; i++) {
    const e = net.edges[i];
    const dx = e.dx, dy = e.dy, l2 = e.l2;
    const f = l2 > 0 ? Math.min(1, Math.max(0, ((x - e.ax) * dx + (y - e.ay) * dy) / l2)) : 0;
    const atX = e.ax + dx * f;
    const atY = e.ay + dy * f;
    const offX = atX - x;
    const offY = atY - y;
    const off2 = offX * offX + offY * offY;
    if (off2 < bestOff2) {
      bestOff2 = off2;
      bestEdge = e;
      bestF = f;
      bestAtX = atX;
      bestAtY = atY;
    }
  }

  if (!bestEdge) return null;
  return {
    edge: bestEdge,
    t: bestF * bestEdge.length,
    off: Math.sqrt(bestOff2),
    at: [bestAtX, bestAtY],
  };
}

export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  private topPair: [number, number] = [0, 0];

  get size(): number {
    return this.keys.length;
  }
  push(k: number, v: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const k0 = keys[0], v0 = vals[0];
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= k) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    this.topPair[0] = k0;
    this.topPair[1] = v0;
    return this.topPair;
  }
}

export interface Tree {
  dist: Map<number, number>;
  prev: Map<number, number>;
}

export function treeFrom(net: Net, seeds: [number, number][], limit: number): Tree {
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const done = new Set<number>();
  const heap = new MinHeap();
  for (const [n, d] of seeds) {
    if (d > limit || d >= (dist.get(n) ?? Infinity)) continue;
    dist.set(n, d);
    heap.push(d, n);
  }
  while (heap.size > 0) {
    const [d, n] = heap.pop();
    if (done.has(n)) continue;
    done.add(n);
    for (const [m, len] of net.adj.get(n) ?? []) {
      const nd = d + len;
      if (nd > limit) continue;
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        prev.set(m, n);
        heap.push(nd, m);
      }
    }
  }
  return { dist, prev };
}

export const spotTree = (net: Net, p: Spot, limit: number): Tree =>
  treeFrom(
    net,
    [
      [p.edge.a, p.t],
      [p.edge.b, p.edge.length - p.t],
    ],
    limit - p.off,
  );

export function walkMetres(tree: Tree, p: Spot, q: Spot): number {
  const e = q.edge;
  let road = Math.min((tree.dist.get(e.a) ?? Infinity) + q.t, (tree.dist.get(e.b) ?? Infinity) + e.length - q.t);
  if (p.edge.id === e.id) road = Math.min(road, Math.abs(p.t - q.t));
  return p.off + road + q.off;
}

export function lotFront(b: Building): [number, number] {
  if (b.door) return b.door;
  const { cx, cy, angle, d } = b.lot;
  const vx = -Math.sin(angle) * b.side;
  const vy = Math.cos(angle) * b.side;
  const front = (CELL_SIZE * d) / 2;
  return [cx - vx * front, cy - vy * front];
}

// ---------- buildings and houses ----------

export const isFinishedHouse = (b: Building | undefined): b is Building => !!b && b.zone === "res" && b.state === "active";
export const isWorkplace = (b: Building | undefined): b is Building => !!b && b.zone !== "res" && b.state === "active";
const houseCap = (b: Building): number => houseCapacity(b);

export function vacantHouses(buildings: Record<number, Building>, households: Record<number, Household>): number[] {
  const taken = new Set<number>();
  for (const h of Object.values(households)) if (h.home !== null) taken.add(h.home);
  const out: number[] = [];
  for (const b of Object.values(buildings)) if (isFinishedHouse(b) && !taken.has(b.id)) out.push(b.id);
  return out;
}

export function constructionWork(buildings: Record<number, Building>, roads: RoadGraph, clearings: readonly Clearing[] = [], stock?: Pick<Stock, "stone">): boolean {
  for (const b of Object.values(buildings)) if (b.state !== "active" || b.upgrade) return true;
  if (clearings.some((c) => !isCleared(c))) return true;
  return workableEdges(roads, stock).length > 0;
}

// ---------- aggregates ----------

interface Counts {
  pop: number;
  adults: number;
  children: number;
  employed: number;
  jobless: number;
  inClass: number;
  commuteSum: number;
  literate: number;
}

const countCache = new WeakMap<object, { day: number; c: Counts }>();

export function countResidents(residents: Record<number, Resident>, now: number): Counts {
  const day = dayOf(now);
  const hit = countCache.get(residents);
  if (hit && hit.day === day) return hit.c;
  const at = dayStart(now);
  const c: Counts = { pop: 0, adults: 0, children: 0, employed: 0, jobless: 0, inClass: 0, commuteSum: 0, literate: 0 };
  for (const r of Object.values(residents)) {
    c.pop++;
    const age = ageOf(r.born, at);
    if (age < ADULT_MIN) c.children++;
    else if (age < ADULT_MAX) {
      c.adults++;
      c.literate += r.school / 100;
      if (r.inClass) c.inClass++;
      else if (r.job !== null) {
        c.employed++;
        c.commuteSum += r.commute ?? 0;
      } else c.jobless++;
    }
  }
  countCache.set(residents, { day, c });
  return c;
}

export const FORAGE = { day: 1.2, winter: 0.4 };
export const forageRate = (gameMinutes: number): number => (calendar(gameMinutes).season === 3 ? FORAGE.winter : FORAGE.day);

export function idleResidents(s: ArtelState): Set<number> {
  const out = new Set<number>();
  if (constructionWork(s.buildings, s.roads, s.clearings, s.stock)) return out;
  const farmless = idleGumnos(s);
  const orchards = idleOrchards(s);
  for (const r of Object.values(s.residents)) {
    if (!isAdultAge(ageOf(r.born, s.gameMinutes)) || r.inClass) continue;
    if (r.job === null || farmless.has(r.job) || orchards.has(r.job)) out.add(r.id);
  }
  return out;
}

export const forageKg = (s: ArtelState): number => idleResidents(s).size * forageRate(s.gameMinutes);

type ArtelState = Pick<SimState, "residents" | "buildings" | "roads" | "gameMinutes" | "zones" | "prod" | "stock"> & { clearings?: Clearing[]; levers?: Levers };

export function artel(s: ArtelState): { hands: number; drafted: number; employed: number } {
  const c = countResidents(s.residents, s.gameMinutes);
  const idle = idleWorkers(s);
  const hands = c.jobless + idle;
  let drafted = 0;
  if (constructionWork(s.buildings, s.roads, s.clearings, s.stock)) {
    const min = buildFloor(c.adults, s.levers);
    drafted = Math.max(0, Math.min(min - hands, c.employed - idle));
  }
  return { hands, drafted, employed: c.employed };
}

export const builderCount = (s: ArtelState): number => {
  if (tolokaActive(s.levers, s.gameMinutes)) {
    const c = countResidents(s.residents, s.gameMinutes);
    return c.adults - c.inClass;
  }
  const a = artel(s);
  return a.hands + a.drafted;
};

export function productionScales(s: ArtelState): [number, number, number, number] {
  if (tolokaActive(s.levers, s.gameMinutes)) return [0, 0, 0, 0];
  const a = artel(s);
  const out: [number, number, number, number] = [1, 1, 1, 1];
  if (a.drafted <= 0) return out;
  const idle = idleWorkplaces(s);
  const n = [0, 0, 0, 0];
  for (const r of Object.values(s.residents)) {
    const b = r.job === null || idle.has(r.job) ? undefined : s.buildings[r.job];
    if (b) n[buildingPriority(b, s.levers)]++;
  }
  let need = a.drafted;
  for (let p = 0; p < 4 && need > 0; p++) {
    const take = Math.min(need, n[p]);
    if (n[p] > 0) out[p] = 1 - take / n[p];
    need -= take;
  }
  return out;
}

export function productionScale(s: ArtelState): number {
  if (tolokaActive(s.levers, s.gameMinutes)) return 0;
  const a = artel(s);
  return a.employed > 0 ? 1 - a.drafted / a.employed : 1;
}

export function foodOutlook(s: ArtelState & { households: SimState["households"] } & Partial<Pick<SimState, "weather">>): number {
  const need = foodPerDay(s.residents, s.gameMinutes, s.levers);
  if (need <= 0) return 1;
  const cal = calendar(s.gameMinutes);
  const days = YEAR_DAYS;
  let projected = s.stock.food;
  const open = cal.dayOfYear <= HARVEST_END_DAY;
  const assign = assignFields(s.zones.fields, s.buildings);
  const crop = cropOf(s);
  for (const f of s.zones.fields) {
    if (!assign.has(f.id)) continue;
    const w = workOf(s.prod.fields, f.id, cal.year);
    if (!open) projected += FIELD.yieldKgHa * haOf(f);
    else if (w.sowH <= 0) projected += FIELD.yieldKgHa * haOf(f) * crop;
    else projected += Math.max(0, expectedKg(f, w, crop) - w.reaped);
  }
  const workers = new Map<number, number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);
  let daily = 0;
  for (const [id, n] of workers) {
    const b = s.buildings[id];
    if (!b || b.state !== "active") continue;
    if (b.template === "orchard") {
      if (bears(b, s.gameMinutes)) projected += n * FOOD_RATE.orchard.kgHour * workLength(s.levers) * DAYS_PER_SEASON * orchardQuality(s.prod.orchard);
    } else daily += n * foodKgHour(b.template, cal.season) * workLength(s.levers);
  }
  projected += (daily + forageKg(s)) * days;
  return Math.min(1, Math.max(0, (projected / (need * days) - 0.9) / 0.3));
}

export function foodPerDay(residents: Record<number, Resident>, now: number, levers?: Levers, weather?: WeatherState): number {
  const c = countResidents(residents, now);
  return (c.adults * FOOD.adult + c.children * FOOD.child) * rationFood(levers) * foodNeedFactor(weather);
}

export function peopleStats(s: ArtelState & Pick<SimState, "households">): PeopleStats {
  const c = countResidents(s.residents, s.gameMinutes);
  const work = constructionWork(s.buildings, s.roads, s.clearings, s.stock);
  const farmers = idleFarmers(s);
  const blocked = idleWorkers(s) - farmers;
  let tents = 0;
  let households = 0;
  for (const h of Object.values(s.households)) {
    households++;
    if (h.home === null) tents++;
  }
  return {
    pop: c.pop,
    adults: c.adults,
    children: c.children,
    employed: c.employed,
    builders: work ? c.jobless + farmers + blocked + artel(s).drafted : 0,
    unemployed: work ? 0 : c.jobless + farmers,
    inClass: c.inClass,
    tents,
    avgCommute: c.employed > 0 ? c.commuteSum / c.employed : 0,
    households,
  };
}

// ---------- daily step ----------

export type Rule = "death" | "birth" | "marriage" | "emigration";

export interface RuleOpts {
  rand?: Rand;
  only?: Rule[];
}

function removePerson(w: W, r: Resident): void {
  const h = w.households[r.household];
  if (h) {
    h.members = h.members.filter((m) => m !== r.id);
    if (h.members.length === 0) delete w.households[h.id];
  }
  if (r.spouse !== null) {
    const sp = w.residents[r.spouse];
    if (sp) sp.spouse = null;
  }
  delete w.residents[r.id];
}

export function killResident(s: SimState, id: number): SimState {
  const r = s.residents[id];
  if (!r) return s;
  const w = cloneW(s, s.gameMinutes);
  say(w, "death", `${r.sex === "m" ? "Умер" : "Умерла"} ${fullName(r)}`, homePos(s.buildings[s.households[r.household]?.home ?? -1]));
  removePerson(w, w.residents[id]);
  return { ...s, residents: w.residents, households: w.households, events: w.events.slice(-MAX_EVENTS) };
}

function canLeave(w: W, r: Resident): boolean {
  const h = w.households[r.household];
  if (!h) return true;
  const others = h.members.filter((m) => m !== r.id);
  if (others.length === 0) return true;
  return others.some((m) => ageOf(w.residents[m].born, w.now) >= ADULT_MIN);
}

function detach(w: W, r: Resident): void {
  const h = w.households[r.household];
  if (!h) return;
  h.members = h.members.filter((m) => m !== r.id);
  if (h.members.length === 0) delete w.households[h.id];
}

const JOB_ROUNDS = 4;

interface JobCand {
  id: number;
  m: number;
}

function jobsStep(w: W, s: SimState, work: boolean | null): void {
  const { buildings } = s;
  const limit = MAX_COMMUTE * WALK_SPEED;
  const cap = new Map<number, number>();
  const pri = new Map<number, number>();
  const wps: Building[] = [];
  const assign = assignFields(s.zones.fields, buildings);
  for (const b of Object.values(buildings)) {
    if (!isWorkplace(b)) continue;
    wps.push(b);
    cap.set(b.id, capacityOf(b, s, assign));
    pri.set(b.id, buildingPriority(b, s.levers));
  }
  const workers = new Map<number, number>();
  const lose = (r: Resident) => {
    if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 1) - 1);
    r.job = null;
    r.commute = null;
  };
  for (const r of Object.values(w.residents)) {
    if (!isAdultAge(ageOf(r.born, w.now)) || r.inClass) {
      r.job = null;
      r.commute = null;
    } else if (r.job !== null) {
      if (cap.has(r.job)) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);
      else {
        r.job = null;
        r.commute = null;
      }
    }
  }
  const net = buildNet(s.roads);
  if (net.edges.length === 0 || wps.length === 0) {
    for (const r of Object.values(w.residents)) lose(r);
  } else {
    const spot = new Map<number, Spot | null>();
    const locate = (key: number, x: number, y: number) => {
      let l = spot.get(key);
      if (l === undefined) {
        l = snapToRoad(net, x, y);
        spot.set(key, l);
      }
      return l;
    };
    const workAt: { id: number; spot: Spot }[] = [];
    for (const b of wps) {
      const [x, y] = lotFront(b);
      const l = locate(b.id, x, y);
      if (l) workAt.push({ id: b.id, spot: l });
    }
    const origin = locate(-1, 0, 0);
    const groups: { spot: Spot; h: Household; adults: Resident[]; cands: JobCand[]; candMap: Map<number, number> }[] = [];
    for (const h of Object.values(w.households)) {
      const adults = h.members.map((m) => w.residents[m]).filter((r) => isAdultAge(ageOf(r.born, w.now)));
      if (adults.length === 0) continue;
      if (h.home === null) {
        for (const r of adults) lose(r);
        continue;
      }
      const home = buildings[h.home];
      let l: Spot | null;
      if (home) {
        const [x, y] = lotFront(home);
        l = locate(-2 - home.id, x, y);
      } else l = origin;
      if (l) groups.push({ spot: l, h, adults, cands: [], candMap: new Map() });
      else for (const r of adults) lose(r);
    }
    groups.sort((p, q) => p.spot.edge.id - q.spot.edge.id || p.spot.t - q.spot.t || p.h.id - q.h.id);

    // Оптимизированный поиск доступных вакансий:
    // Если рабочих мест меньше, чем семей, строим дерево Дейкстры от рабочих мест!
    if (workAt.length < groups.length) {
      for (const wk of workAt) {
        const tree = spotTree(net, wk.spot, limit);
        for (const g of groups) {
          const m = walkMetres(tree, wk.spot, g.spot);
          if (m <= limit) g.cands.push({ id: wk.id, m });
        }
      }
      for (const g of groups) {
        g.cands.sort((p, q) => p.m - q.m || p.id - q.id);
        g.candMap = new Map(g.cands.map((c) => [c.id, c.m]));
      }
    } else {
      for (const g of groups) {
        const tree = spotTree(net, g.spot, limit);
        for (const wk of workAt) {
          const m = walkMetres(tree, g.spot, wk.spot);
          if (m <= limit) g.cands.push({ id: wk.id, m });
        }
        g.cands.sort((p, q) => p.m - q.m || p.id - q.id);
        g.candMap = new Map(g.cands.map((c) => [c.id, c.m]));
      }
    }

    for (const g of groups) {
      for (const r of g.adults) {
        if (r.job === null) continue;
        const m = g.candMap.get(r.job);
        const t = m === undefined ? Infinity : m / WALK_SPEED;
        if (t <= MAX_COMMUTE) r.commute = Math.round(t * 10) / 10;
        else lose(r);
      }
    }

    const staff = new Map<number, Resident[]>();
    for (const r of Object.values(w.residents)) {
      if (r.job === null || (workers.get(r.job) ?? 0) <= (cap.get(r.job) ?? 0)) continue;
      const list = staff.get(r.job);
      if (list) list.push(r);
      else staff.set(r.job, [r]);
    }
    for (const [id, list] of staff) {
      list.sort((p, q) => (q.commute ?? 0) - (p.commute ?? 0) || q.id - p.id);
      for (let i = 0; i < list.length && (workers.get(id) ?? 0) > (cap.get(id) ?? 0); i++) lose(list[i]);
    }

    const round = (): boolean => {
      let moved = false;
      for (const g of groups) {
        for (const r of g.adults) {
          const had = r.job !== null;
          let best: JobCand | null = null;
          let bp = had ? pri.get(r.job!)! : -1;
          if (bp >= 3) continue;
          for (const c of g.cands) {
            if (c.m / WALK_SPEED > MAX_COMMUTE) break;
            const p = pri.get(c.id)!;
            if (p <= bp || (workers.get(c.id) ?? 0) >= (cap.get(c.id) ?? 0)) continue;
            best = c;
            bp = p;
            if (p >= 3) break;
          }
          if (!best) continue;
          if (had) {
            workers.set(r.job!, (workers.get(r.job!) ?? 1) - 1);
            moved = true;
          }
          workers.set(best.id, (workers.get(best.id) ?? 0) + 1);
          r.job = best.id;
          r.commute = Math.round((best.m / WALK_SPEED) * 10) / 10;
        }
      }
      return moved;
    };
    for (let i = 0; i < JOB_ROUNDS && round(); i++);
  }
  for (const r of Object.values(w.residents)) {
    if (!isAdultAge(ageOf(r.born, w.now)) || r.inClass) continue;
    if (r.job !== null) r.idleDays = 0;
    else if (work === false) r.idleDays++;
  }
}

export function rebalanceJobs(s: SimState): SimState {
  const w = cloneW(s, s.gameMinutes);
  jobsStep(w, s, null);
  return { ...s, residents: w.residents, households: w.households };
}

export function dailyStep(s: SimState, opts: RuleOpts = {}): SimState {
  const w = cloneW(s, s.gameMinutes);
  const { buildings } = s;
  let stock = s.stock;
  let rng = s.rng;
  const rand: Rand =
    opts.rand ??
    (() => {
      const [v, n] = nextRandom(rng);
      rng = n;
      return v;
    });
  const on = (r: Rule) => !opts.only || opts.only.includes(r);
  const now = w.now;
  const work = constructionWork(buildings, s.roads, s.clearings, s.stock);
  const ids = () => Object.keys(w.residents).map(Number);

  if (on("death")) {
    for (const id of ids()) {
      const r = w.residents[id];
      const home = w.households[r.household]?.home;
      const care = (home != null && covers(s.coverage[home], "healer") ? SERVICE.healerDeathFactor : 1) * mortalityFactor(s.weather, w.households[r.household]?.cold);
      if (rand() < (deathRate(ageOf(r.born, now)) * care) / YEAR_DAYS) {
        say(w, "death", `${r.sex === "m" ? "Умер" : "Умерла"} ${fullName(r)}`);
        removePerson(w, r);
      }
    }
  }

  if (on("birth")) {
    for (const h of Object.values(w.households)) {
      if (h.home === null) continue;
      const home = buildings[h.home];
      if (!isFinishedHouse(home)) continue;
      const cap = houseCap(home);
      for (const m of h.members.slice()) {
        if (h.members.length >= cap) break;
        const r = w.residents[m];
        const age = ageOf(r.born, now);
        if (r.sex !== "f" || r.spouse === null || age < 18 || age > 42) continue;
        if (rand() < RATES.birthYear / YEAR_DAYS) {
          const sex = rand() < 0.5 ? "m" : "f";
          const kid = addPerson(w, pick(sex === "m" ? MALE_NAMES : FEMALE_NAMES, rand), surnameFor(h.last, sex), sex, 0, h.id);
          h.members.push(kid.id);
          say(w, "birth", `${sex === "m" ? "Родился" : "Родилась"} ${fullName(kid)}`);
        }
      }
    }
  }

  if (on("marriage")) {
    const vacant = vacantHouses(buildings, w.households);
    if (vacant.length > 0) {
      const men: Resident[] = [];
      const women: Resident[] = [];
      for (const r of Object.values(w.residents)) {
        if (r.spouse !== null) continue;
        const age = ageOf(r.born, now);
        if (r.sex === "m" && age >= 18 && age <= 40) men.push(r);
        else if (r.sex === "f" && age >= 17 && age <= 38) women.push(r);
      }
      const used = new Set<number>();
      let pairs = 0;
      for (const woman of women) {
        if (pairs >= RATES.maxMarriagesPerDay || vacant.length === 0) break;
        if (rand() >= RATES.marriageDay) continue;
        if (!canLeave(w, woman)) continue;
        const man = men.find((m) => !used.has(m.id) && m.household !== woman.household && canLeave(w, m));
        if (!man) continue;
        used.add(man.id);
        used.add(woman.id);
        detach(w, man);
        detach(w, woman);
        const home = vacant.shift()!;
        const id = w.nextHouseholdId++;
        w.households[id] = { id, last: man.last, home, members: [man.id, woman.id], arrived: now, founder: false, mood: MOOD_START };
        man.household = id;
        woman.household = id;
        man.spouse = woman.id;
        woman.spouse = man.id;
        woman.last = surnameFor(man.last, "f");
        pairs++;
        say(w, "marriage", `Поженились ${fullName(man)} и ${fullName(woman)}`);
      }
    }
  }

  {
    const vacant = vacantHouses(buildings, w.households);
    for (const h of Object.values(w.households)) {
      if (h.home !== null || vacant.length === 0) continue;
      const i = vacant.findIndex((b) => houseCap(buildings[b]) >= h.members.length);
      if (i < 0) continue;
      h.home = vacant.splice(i, 1)[0];
      say(w, "movein", `Семья ${familyGenitive(h.last)} (${h.members.length} чел.) заселилась в дом`, homePos(buildings[h.home]));
    }
  }

  if (on("emigration")) {
    for (const h of Object.values(w.households)) {
      if (h.home === null || h.founder) continue;
      if (!(h.mood < MOOD_LEAVE) || !(rand() < RATES.moodLeaveDay)) continue;
      const n = h.members.length;
      const pop = Object.keys(w.residents).length;
      stock = { ...stock, food: stock.food * (1 - n / pop) };
      for (const m of h.members) delete w.residents[m];
      delete w.households[h.id];
      say(w, "departure", `Семья ${familyGenitive(h.last)} (${n} чел.) покинула поселение`, homePos(buildings[h.home]));
    }
  }

  jobsStep(w, s, work);

  const attract = (() => {
    let adults = 0;
    let jobless = 0;
    for (const r of Object.values(w.residents)) {
      if (!isAdultAge(ageOf(r.born, now))) continue;
      adults++;
      if (r.job === null && !r.inClass) jobless++;
    }
    const unemployment = adults > 0 && !work ? jobless / adults : 0;
    const outlook = foodOutlook({ ...s, residents: w.residents, households: w.households, stock });
    let moodSum = 0;
    for (const h of Object.values(w.households)) moodSum += h.mood;
    const hs = Object.keys(w.households).length;
    const avgMood = hs > 0 ? moodSum / hs : MOOD_START;
    return Math.min(1, Math.max(0, 1 - unemployment * 2)) * outlook * Math.min(1, Math.max(0, avgMood / 100));
  })();

  return {
    ...s,
    rng,
    stock,
    attract,
    residents: w.residents,
    households: w.households,
    nextPersonId: w.nextPersonId,
    nextHouseholdId: w.nextHouseholdId,
    events: w.events.slice(-MAX_EVENTS),
  };
}

// ---------- immigration ----------

const ARRIVE_MIN = 6 * 60;
const ARRIVE_SPAN = 6 * 60;

export function immigrationStep(s: SimState, dt: number): SimState {
  const now = s.gameMinutes;
  let rng = s.rng;
  const rand: Rand = () => {
    const [v, n] = nextRandom(rng);
    rng = n;
    return v;
  };
  let incoming = s.incoming;
  let w: W | null = null;
  let stock = s.stock;
  if (incoming.some((f) => f.arrive <= now)) {
    const wk = (w = cloneW(s, now));
    const promised = new Set(incoming.map((f) => f.house));
    for (const f of incoming) {
      if (f.arrive > now) continue;
      const free = vacantHouses(s.buildings, wk.households);
      const house = free.includes(f.house) ? f.house : (free.find((id) => !promised.has(id)) ?? null);
      const room = house === null ? 3 : Math.max(0, houseCap(s.buildings[house]) - 2);
      const kids = Math.floor(rand() * (Math.min(3, room) + 1));
      const h = makeFamily(wk, rand, 18, 45, kids, house);
      say(wk, "arrival", `Семья ${familyGenitive(h.last)} (${h.members.length} чел.) приехала в поселение`, house === null ? undefined : homePos(s.buildings[house]));
      let eat = 0;
      for (const m of h.members) eat += ageOf(wk.residents[m].born, now) < ADULT_MIN ? FOOD.child : FOOD.adult;
      stock = { ...stock, food: Math.min(foodCapacity(s.buildings), stock.food + eat * FOOD.immigrantDays) };
    }
    incoming = incoming.filter((f) => f.arrive > now);
  }
  const p = 1 - (1 - Math.min(1, RATES.immigrationDay * s.attract)) ** (dt / 1440);
  if (p > 0) {
    const promised = new Set(incoming.map((f) => f.house));
    for (const id of vacantHouses(s.buildings, w ? w.households : s.households)) {
      if (promised.has(id) || !(rand() < p)) continue;
      incoming = [...incoming, { house: id, arrive: now + ARRIVE_MIN + rand() * ARRIVE_SPAN } satisfies Incoming];
    }
  }
  if (!w && incoming === s.incoming && rng === s.rng) return s;
  return {
    ...s,
    rng,
    stock,
    incoming,
    ...(w && { residents: w.residents, households: w.households, nextPersonId: w.nextPersonId, nextHouseholdId: w.nextHouseholdId, events: w.events.slice(-MAX_EVENTS) }),
  };
}

export function syncPeople<T extends Pick<SimState, "buildings" | "residents" | "households">>(s: T): T {
  let households = s.households;
  let residents = s.residents;
  const taken = new Set<number>();
  for (const h of Object.values(s.households)) {
    if (h.home === null) continue;
    if (isFinishedHouse(s.buildings[h.home]) && !taken.has(h.home)) taken.add(h.home);
    else {
      if (households === s.households) households = { ...households };
      households[h.id] = { ...h, home: null };
    }
  }
  for (const r of Object.values(s.residents)) {
    if (r.job === null || isWorkplace(s.buildings[r.job])) continue;
    if (residents === s.residents) residents = { ...residents };
    residents[r.id] = { ...r, job: null, commute: null };
  }
  return households === s.households && residents === s.residents ? s : { ...s, households, residents };
}

// ---------- inspector ----------

const WORK_TEXT: Record<string, string> = {
  smithy: "кузнец — Кузница",
  carpentry: "столяр — Столярная мастерская",
  pottery: "гончар — Гончарня",
  shop: "работает в Магазине",
  tavern: "работает в Таверне",
  gumno: "фермер — Ферма",
  woodcutter: "лесоруб",
  garden: "работает в Огороде",
  hunter: "охотник — Охотничий пост",
  forager: "собирает в лесу",
  orchard: "садовник — Сад",
  apiary: "пасечник",
  sawpit: "рабочий лесопилки",
  quarry: "рабочий карьера",
  fisher: "рыбак",
  well: "работает у колодца",
  market: "торгует на Рынке",
  chapel: "служит в Храме",
  school: "учитель — Школа",
  healer: "врач",
  dig: "землекоп — Раскоп",
};

function roleOf(s: Pick<SimState, "buildings">, r: Resident, age: number, work: boolean, idle: Set<number>): string {
  if (age < ADULT_MIN) return r.inClass ? "школьник" : "ребёнок";
  if (age >= ADULT_MAX) return r.sex === "m" ? "старик" : "старуха";
  if (r.inClass) return "учится в школе";
  if (r.job !== null && idle.has(r.job)) return work ? "на стройке" : "без работы";
  if (r.job !== null) {
    const b = s.buildings[r.job];
    const t = b && BUILDINGS[b.template];
    if (b && t) return WORK_TEXT[t.id] ?? `работает — ${t.name}`;
  }
  return work ? "на стройке" : "без работы";
}

export function queryBuilding(s: SimState, id: number): BuildingQuery | null {
  const b = s.buildings[id];
  const t = b && BUILDINGS[b.template];
  if (!b || !t) return null;
  const now = s.gameMinutes;
  if (b.zone === "res") {
    const work = constructionWork(s.buildings, s.roads, s.clearings, s.stock);
    const idle = idleWorkplaces(s);
    const households = Object.values(s.households)
      .filter((h) => h.home === id)
      .map((h) => ({
        id: h.id,
        last: h.last,
        mood: Math.round(h.mood),
        people: h.members
          .map((m) => s.residents[m])
          .filter((r): r is Resident => !!r)
          .map((r) => {
            const age = ageOf(r.born, now);
            return { id: r.id, name: fullName(r), age: Math.floor(age), sex: r.sex, role: roleOf(s, r, age, work, idle), literate: r.literate, learn: Math.round(r.school) };
          }),
      }));
    return {
      kind: "house",
      households,
      level: b.level,
      landValue: s.landValue[id] ?? 0,
      services: servicesIn(s.coverage[id]),
      upgrading: !!b.upgrade,
    };
  }
  const idle = idleWorkplaces(s).has(id);
  const workers = Object.values(s.residents)
    .filter((r) => r.job === id)
    .map((r) => ({ id: r.id, name: fullName(r), age: Math.floor(ageOf(r.born, now)), commute: r.commute, idle }));
  return { kind: "workplace", capacity: jobsOf(b, s), workers };
}