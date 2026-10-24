import { BUILDINGS, foodCapacity, houseCapacity } from "./buildings";
import { assignFields, expectedKg, FIELD, idleGumnos, FISH, haOf, HARVEST_END_DAY, idleFarmers, idleWorkers, idleWorkplaces, jobsOf, workOf } from "./fields";
import { nextRandom } from "./rng";
import { covers, SERVICE, servicesIn } from "./services";
import { WORK_END, WORK_START, workableEdges } from "./roads";
import { calendar, dayOf, dayStart, YEAR_MIN } from "./time";
import type { Building, BuildingQuery, Household, PeopleState, PeopleStats, Resident, RoadGraph, SimState, EventKind } from "./types";
import { CELL_SIZE } from "./zones";

export const FOUNDERS = 10; // founding party: 3 households in tents
export const ADULT_MIN = 16; // years
export const ADULT_MAX = 60; // working age is [16, 60)
export const WALK_SPEED = 4000 / 60; // m/min, 4 km/h
export const MAX_COMMUTE = 45; // minutes
export const MAX_EVENTS = 50;

// All life-event rates live here (annual unless noted).
export const RATES = {
  birthYear: 0.3,
  marriageDay: 0.02, // per eligible woman per day
  maxMarriagesPerDay: 3,
  immigrationDay: 0.5, // per vacant house, times attractiveness
  moodLeaveDay: 0.1, // per household in a house with mood below MOOD_LEAVE
};
export const MOOD_START = 60;
export const MOOD_LEAVE = 35;
// Food: kg a day per person, and the days of it that immigrants bring along.
export const FOOD = { adult: 0.7, child: 0.45, immigrantDays: 60 };
// Annual death probability by age band.
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
// Surname form for a person of the given sex; masculine base forms in, invariable ones stay.
export const surnameFor = (last: string, sex: "m" | "f"): string => (sex === "f" && FEM_SUFFIX.test(last) ? `${last}а` : last);
// "Семья Смирновых"
export const familyGenitive = (last: string): string => (FEM_SUFFIX.test(last) ? `${last}ых` : last);
export const fullName = (r: Pick<Resident, "first" | "last">): string => `${r.first} ${r.last}`;

// ---------- working copy ----------

type Rand = () => number;

interface W extends PeopleState {
  now: number;
}

const pick = <T>(arr: readonly T[], rand: Rand): T => arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];

export const ageOf = (born: number, now: number): number => (now - born) / YEAR_MIN;
const isAdultAge = (age: number): boolean => age >= ADULT_MIN && age < ADULT_MAX;

export const emptyPeople = (): PeopleState => ({ residents: {}, households: {}, nextPersonId: 1, nextHouseholdId: 1, events: [] });

function cloneW(s: PeopleState, now: number): W {
  const residents: Record<number, Resident> = {};
  for (const r of Object.values(s.residents)) residents[r.id] = { ...r };
  const households: Record<number, Household> = {};
  for (const h of Object.values(s.households)) households[h.id] = { ...h, members: h.members.slice() };
  return { residents, households, nextPersonId: s.nextPersonId, nextHouseholdId: s.nextHouseholdId, events: s.events.slice(), now };
}

function say(w: W, kind: EventKind, text: string): void {
  w.events.push({ at: w.now, kind, text });
}

function addPerson(w: W, first: string, last: string, sex: "m" | "f", age: number, household: number): Resident {
  const id = w.nextPersonId++;
  const r: Resident = { id, first, last, sex, born: w.now - age * YEAR_MIN, household, spouse: null, job: null, commute: null, idleDays: 0, literate: false, school: 0 };
  w.residents[id] = r;
  return r;
}

// A married couple (ages in [ageMin, ageMax]) with `kids` children, as a new household.
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

// Child counts of the three founding couples: 4 children in all, at most 2 per couple.
const FOUNDER_KIDS = [[2, 2, 0], [2, 0, 2], [0, 2, 2], [2, 1, 1], [1, 2, 1], [1, 1, 2]];

// 10 founders: 3 married couples (20-40) with 4 children between them, living in tents.
export function createFounders(rng: number, now: number): { people: PeopleState; rng: number } {
  let state = rng;
  const rand: Rand = () => {
    const [v, n] = nextRandom(state);
    state = n;
    return v;
  };
  const w: W = { ...emptyPeople(), now };
  const kids = pick(FOUNDER_KIDS, rand);
  for (let i = 0; i < 3; i++) makeFamily(w, rand, 20, 40, kids[i], null, true);
  const { now: _now, ...people } = w;
  return { people, rng: state };
}

// ---------- road net (built edges only) ----------

const NBUCKET = 64; // m
const bkey = (bx: number, by: number) => bx * 65536 + by;
const bidx = (v: number) => Math.floor(v / NBUCKET);

export interface Net {
  adj: Map<number, [number, number][]>; // node -> [neighbour, metres]
  grid: Map<number, { id: number; x: number; y: number }[]>;
}

export function buildNet(g: RoadGraph): Net {
  const adj = new Map<number, [number, number][]>();
  const link = (a: number, b: number, len: number) => {
    const l = adj.get(a);
    if (l) l.push([b, len]);
    else adj.set(a, [[b, len]]);
  };
  for (const e of Object.values(g.edges)) {
    if (e.done < e.labor) continue;
    link(e.a, e.b, e.length);
    link(e.b, e.a, e.length);
  }
  const grid = new Map<number, { id: number; x: number; y: number }[]>();
  for (const id of adj.keys()) {
    const n = g.nodes[id];
    const k = bkey(bidx(n.x), bidx(n.y));
    const item = { id, x: n.x, y: n.y };
    const l = grid.get(k);
    if (l) l.push(item);
    else grid.set(k, [item]);
  }
  return { adj, grid };
}

const MAX_RING = Math.ceil((MAX_COMMUTE * WALK_SPEED) / NBUCKET) + 1;

// Nearest net node by straight line, or null when none lies within walking range.
export function nearestNode(net: Net, x: number, y: number): { node: number; off: number } | null {
  const bx = bidx(x);
  const by = bidx(y);
  let best = null as { node: number; off: number } | null;
  for (let r = 0; r <= MAX_RING; r++) {
    for (let dx = -r; dx <= r; dx++) {
      const step = Math.abs(dx) === r ? 1 : 2 * r; // inner columns: only the top and bottom cell
      for (let dy = -r; dy <= r; dy += step) {
        const cell = net.grid.get(bkey(bx + dx, by + dy));
        if (!cell) continue;
        for (const n of cell) {
          const d = Math.hypot(n.x - x, n.y - y);
          if (!best || d < best.off || (d === best.off && n.id < best.node)) best = { node: n.id, off: d };
        }
      }
    }
    if (best && best.off <= r * NBUCKET) break;
  }
  return best && best.off <= MAX_COMMUTE * WALK_SPEED ? best : null;
}

export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
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
    const top: [number, number] = [keys[0], vals[0]];
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
    return top;
  }
}

// Road distance in metres from `start` to every node within `limit`.
export function reach(net: Net, start: number, limit: number): Map<number, number> {
  const dist = new Map<number, number>([[start, 0]]);
  const done = new Set<number>();
  const heap = new MinHeap();
  heap.push(0, start);
  while (heap.size > 0) {
    const [d, n] = heap.pop();
    if (done.has(n)) continue;
    done.add(n);
    for (const [m, len] of net.adj.get(n) ?? []) {
      const nd = d + len;
      if (nd > limit) continue;
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        heap.push(nd, m);
      }
    }
  }
  return dist;
}

// Midpoint of the lot edge that faces the road (the door).
export function lotFront(b: Building): [number, number] {
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

// Finished houses without a household, lowest id first.
export function vacantHouses(buildings: Record<number, Building>, households: Record<number, Household>): number[] {
  const taken = new Set<number>();
  for (const h of Object.values(households)) if (h.home !== null) taken.add(h.home);
  const out: number[] = [];
  for (const b of Object.values(buildings)) if (isFinishedHouse(b) && !taken.has(b.id)) out.push(b.id);
  return out;
}

// Is there construction work (unfinished buildings, house upgrades or roads a work party can reach)?
export function constructionWork(buildings: Record<number, Building>, roads: RoadGraph): boolean {
  for (const b of Object.values(buildings)) if (b.state !== "active" || b.upgrade) return true;
  return workableEdges(roads).length > 0;
}

// ---------- aggregates ----------

interface Counts {
  pop: number;
  adults: number;
  children: number;
  employed: number;
  jobless: number; // adults with no regular job
  commuteSum: number;
  literate: number; // literate adults
}

// Counted at the start of the game day, so the result is the same whenever it is asked within a day.
const countCache = new WeakMap<object, { day: number; c: Counts }>();

export function countResidents(residents: Record<number, Resident>, now: number): Counts {
  const day = dayOf(now);
  const hit = countCache.get(residents);
  if (hit && hit.day === day) return hit.c;
  const at = dayStart(now);
  const c: Counts = { pop: 0, adults: 0, children: 0, employed: 0, jobless: 0, commuteSum: 0, literate: 0 };
  for (const r of Object.values(residents)) {
    c.pop++;
    const age = ageOf(r.born, at);
    if (age < ADULT_MIN) c.children++;
    else if (age < ADULT_MAX) {
      c.adults++;
      if (r.literate) c.literate++;
      if (r.job !== null) {
        c.employed++;
        c.commuteSum += r.commute ?? 0;
      } else c.jobless++;
    }
  }
  countCache.set(residents, { day, c });
  return c;
}

// Food the idle adults gather for the town (berries, mushrooms, fishing, small game), kg a day each.
export const FORAGE = { day: 1.2, winter: 0.4 };
export const forageRate = (gameMinutes: number): number => (calendar(gameMinutes).season === 3 ? FORAGE.winter : FORAGE.day);

// Adults with nothing to do: jobless (or farmers with no field work) while there is no construction work
// for them to join. Their number is the unemployed of peopleStats.
export function idleResidents(s: ArtelState): Set<number> {
  const out = new Set<number>();
  if (constructionWork(s.buildings, s.roads)) return out;
  const farmless = idleGumnos(s);
  for (const r of Object.values(s.residents)) {
    if (!isAdultAge(ageOf(r.born, s.gameMinutes))) continue;
    if (r.job === null || farmless.has(r.job)) out.add(r.id);
  }
  return out;
}

// Kg of food the idle adults gather in a day right now.
export const forageKg = (s: ArtelState): number => idleResidents(s).size * forageRate(s.gameMinutes);

export const MIN_ARTEL_SHARE = 0.2;
export const MIN_ARTEL_FLOOR = 3;

type ArtelState = Pick<SimState, "residents" | "buildings" | "roads" | "gameMinutes" | "zones" | "prod" | "stock">;

// The construction artel: every adult without a regular job, plus farmers while the land has no work
// for them and the workers of workshops without inputs. While construction work exists it has at least
// max(3, ceil(20 % of the adults)) hands; the shortfall is drafted from the employed (they keep their
// jobs, but production is scaled down, see productionScale).
export function artel(s: ArtelState): { hands: number; drafted: number; employed: number } {
  const c = countResidents(s.residents, s.gameMinutes);
  const idle = idleWorkers(s);
  const hands = c.jobless + idle;
  let drafted = 0;
  if (constructionWork(s.buildings, s.roads)) {
    const min = Math.max(MIN_ARTEL_FLOOR, Math.ceil(MIN_ARTEL_SHARE * c.adults - 1e-9));
    drafted = Math.max(0, Math.min(min - hands, c.employed - idle));
  }
  return { hands, drafted, employed: c.employed };
}

export const builderCount = (s: ArtelState): number => {
  const a = artel(s);
  return a.hands + a.drafted;
};

// Share of the work that is done at the workplaces while some of their workers are drafted.
export function productionScale(s: ArtelState): number {
  const a = artel(s);
  return a.employed > 0 ? 1 - a.drafted / a.employed : 1;
}

// Can the food last a full year? projected = stock + exactly one harvest + the fishers' daily output x 360;
// the harvest is this year's unreaped expected amount while the window has not closed (a field not sown yet
// counts in full: 400 kg/ha), otherwise next year's (400 kg/ha of every field a gumno works).
// need = today's consumption x 360. 0 below 90 % of the need, 1 from 120 %.
export function foodOutlook(s: ArtelState & { households: SimState["households"] }): number {
  const need = foodPerDay(s.residents, s.gameMinutes);
  if (need <= 0) return 1;
  const cal = calendar(s.gameMinutes);
  const days = 360;
  let projected = s.stock.food;
  const open = cal.dayOfYear <= HARVEST_END_DAY;
  const assign = assignFields(s.zones.fields, s.buildings);
  for (const f of s.zones.fields) {
    if (!assign.has(f.id)) continue;
    const w = workOf(s.prod.fields, f.id, cal.year);
    if (!open || w.sowH <= 0) projected += FIELD.yieldKgHa * haOf(f);
    else projected += Math.max(0, expectedKg(f, w) - w.reaped);
  }
  const fishers = new Map<number, number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) fishers.set(r.job, (fishers.get(r.job) ?? 0) + 1);
  let daily = 0;
  for (const [id, n] of fishers) if (s.buildings[id]?.template === "fisher" && s.buildings[id].state === "active") daily += n * FISH.kgHour * (WORK_END - WORK_START) * (cal.season === 3 ? FISH.winter : 1);
  projected += (daily + forageKg(s)) * days;
  return Math.min(1, Math.max(0, (projected / (need * days) - 0.9) / 0.3));
}

// Kg of food the town eats in a day.
export function foodPerDay(residents: Record<number, Resident>, now: number): number {
  const c = countResidents(residents, now);
  return c.adults * FOOD.adult + c.children * FOOD.child;
}

export function peopleStats(s: ArtelState & Pick<SimState, "households">): PeopleStats {
  const c = countResidents(s.residents, s.gameMinutes);
  const work = constructionWork(s.buildings, s.roads);
  const farmers = idleFarmers(s);
  const blocked = idleWorkers(s) - farmers; // workers of workshops without inputs: busy by job, free for the artel
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
    tents,
    avgCommute: c.employed > 0 ? c.commuteSum / c.employed : 0,
    households,
  };
}

// ---------- daily step ----------

export type Rule = "death" | "birth" | "marriage" | "immigration" | "emigration";

// `rand` replaces the seeded generator (tests); `only` limits the random rules that run.
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

// Can `r` leave the household without leaving children behind with no adult?
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

function jobsStep(w: W, s: SimState, work: boolean): void {
  const { buildings } = s;
  const limit = MAX_COMMUTE * WALK_SPEED;
  const cap = new Map<number, number>();
  const wps: Building[] = [];
  const assign = assignFields(s.zones.fields, buildings);
  for (const b of Object.values(buildings)) {
    if (!isWorkplace(b)) continue;
    wps.push(b);
    cap.set(b.id, jobsOf(b, s, assign));
  }
  const workers = new Map<number, number>();
  const lose = (r: Resident) => {
    if (r.job !== null) workers.set(r.job, (workers.get(r.job) ?? 1) - 1);
    r.job = null;
    r.commute = null;
  };
  for (const r of Object.values(w.residents)) {
    if (!isAdultAge(ageOf(r.born, w.now))) {
      r.job = null;
      r.commute = null;
    } else if (r.job !== null) {
      if (cap.has(r.job) && (workers.get(r.job) ?? 0) < cap.get(r.job)!) workers.set(r.job, (workers.get(r.job) ?? 0) + 1);
      else {
        r.job = null;
        r.commute = null;
      }
    }
  }
  const net = buildNet(s.roads);
  if (net.adj.size === 0 || wps.length === 0) {
    for (const r of Object.values(w.residents)) lose(r);
  } else {
    const spot = new Map<number, { node: number; off: number } | null>();
    const locate = (key: number, x: number, y: number) => {
      let l = spot.get(key);
      if (l === undefined) {
        l = nearestNode(net, x, y);
        spot.set(key, l);
      }
      return l;
    };
    const workAt = new Map<number, { id: number; off: number }[]>();
    for (const b of wps) {
      const [x, y] = lotFront(b);
      const l = locate(b.id, x, y);
      if (!l) continue;
      const list = workAt.get(l.node);
      if (list) list.push({ id: b.id, off: l.off });
      else workAt.set(l.node, [{ id: b.id, off: l.off }]);
    }
    const groups: { node: number; off: number; h: Household }[] = [];
    const origin = locate(-1, 0, 0);
    for (const h of Object.values(w.households)) {
      const adults = h.members.filter((m) => isAdultAge(ageOf(w.residents[m].born, w.now)));
      if (adults.length === 0) continue;
      const home = h.home === null ? undefined : buildings[h.home];
      let l: { node: number; off: number } | null;
      if (home) {
        const [x, y] = lotFront(home);
        l = locate(-2 - home.id, x, y);
      } else l = origin;
      if (h.home === null) for (const m of adults) lose(w.residents[m]); // the tent camp builds its homes first
      else if (l) groups.push({ node: l.node, off: l.off, h });
      else for (const m of adults) lose(w.residents[m]);
    }
    groups.sort((p, q) => p.node - q.node || p.h.id - q.h.id);
    let curNode = Number.NaN;
    let cands: { id: number; m: number }[] = [];
    let candMap = new Map<number, number>();
    for (const g of groups) {
      if (g.node !== curNode) {
        curNode = g.node;
        cands = [];
        for (const [n, d] of reach(net, g.node, limit)) {
          for (const c of workAt.get(n) ?? []) if (d + c.off <= limit) cands.push({ id: c.id, m: d + c.off });
        }
        cands.sort((p, q) => p.m - q.m || p.id - q.id);
        candMap = new Map(cands.map((c) => [c.id, c.m]));
      }
      const adults = g.h.members.map((m) => w.residents[m]).filter((r) => isAdultAge(ageOf(r.born, w.now)));
      for (const r of adults) {
        if (r.job === null) continue;
        const m = candMap.get(r.job);
        const t = m === undefined ? Infinity : (g.off + m) / WALK_SPEED;
        if (t <= MAX_COMMUTE) r.commute = Math.round(t * 10) / 10;
        else lose(r);
      }
      for (const r of adults) {
        if (r.job !== null) continue;
        for (const c of cands) {
          const t = (g.off + c.m) / WALK_SPEED;
          if (t > MAX_COMMUTE) break;
          if ((workers.get(c.id) ?? 0) >= (cap.get(c.id) ?? 0)) continue;
          workers.set(c.id, (workers.get(c.id) ?? 0) + 1);
          r.job = c.id;
          r.commute = Math.round(t * 10) / 10;
          break;
        }
      }
    }
  }
  for (const r of Object.values(w.residents)) {
    if (!isAdultAge(ageOf(r.born, w.now))) continue;
    if (r.job !== null) r.idleDays = 0;
    else if (!work) r.idleDays++;
  }
}

// One game day of life: deaths, births, marriages, moving in, migration, jobs. Pure; all randomness
// comes from `s.rng` unless `opts.rand` is given.
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
  const work = constructionWork(buildings, s.roads);
  const ids = () => Object.keys(w.residents).map(Number);

  // 1. deaths
  if (on("death")) {
    for (const id of ids()) {
      const r = w.residents[id];
      const home = w.households[r.household]?.home;
      const care = home != null && covers(s.coverage[home], "healer") ? SERVICE.healerDeathFactor : 1;
      if (rand() < (deathRate(ageOf(r.born, now)) * care) / 360) {
        say(w, "death", `${r.sex === "m" ? "Умер" : "Умерла"} ${fullName(r)}`);
        removePerson(w, r);
      }
    }
  }

  // 2. births
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
        if (rand() < RATES.birthYear / 360) {
          const sex = rand() < 0.5 ? "m" : "f";
          const kid = addPerson(w, pick(sex === "m" ? MALE_NAMES : FEMALE_NAMES, rand), surnameFor(h.last, sex), sex, 0, h.id);
          h.members.push(kid.id);
          say(w, "birth", `${sex === "m" ? "Родился" : "Родилась"} ${fullName(kid)}`);
        }
      }
    }
  }

  // 3. marriages (a new household needs a vacant finished house)
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

  // 4. households in tents move into vacant finished houses (lowest id first, if the family fits)
  {
    const vacant = vacantHouses(buildings, w.households);
    for (const h of Object.values(w.households)) {
      if (h.home !== null || vacant.length === 0) continue;
      const i = vacant.findIndex((b) => houseCap(buildings[b]) >= h.members.length);
      if (i < 0) continue;
      h.home = vacant.splice(i, 1)[0];
      say(w, "movein", `Семья ${familyGenitive(h.last)} (${h.members.length} чел.) заселилась в дом`);
    }
  }

  // 5. immigration into the remaining vacant houses
  if (on("immigration")) {
    let adults = 0;
    let jobless = 0;
    for (const r of Object.values(w.residents)) {
      if (!isAdultAge(ageOf(r.born, now))) continue;
      adults++;
      if (r.job === null) jobless++;
    }
    const unemployment = adults > 0 && !work ? jobless / adults : 0;
    const need = foodPerDay(w.residents, now);
    const outlook = foodOutlook({ ...s, residents: w.residents, households: w.households, stock });
    let moodSum = 0;
    for (const h of Object.values(w.households)) moodSum += h.mood;
    const hs = Object.keys(w.households).length;
    const avgMood = hs > 0 ? moodSum / hs : MOOD_START;
    const attractive =
      Math.min(1, Math.max(0, 1 - unemployment * 2)) * outlook * Math.min(1, Math.max(0, avgMood / 100));
    for (const b of vacantHouses(buildings, w.households)) {
      if (!(rand() < RATES.immigrationDay * attractive)) continue;
      const room = Math.max(0, houseCap(buildings[b]) - 2);
      const kids = Math.floor(rand() * (Math.min(3, room) + 1));
      const h = makeFamily(w, rand, 18, 45, kids, b);
      say(w, "arrival", `Семья ${familyGenitive(h.last)} (${h.members.length} чел.) приехала в поселение`);
      // They bring 60 days of their own food, as far as the barns can hold it.
      let eat = 0;
      for (const m of h.members) eat += ageOf(w.residents[m].born, now) < ADULT_MIN ? FOOD.child : FOOD.adult;
      stock = { ...stock, food: Math.min(foodCapacity(buildings), stock.food + eat * FOOD.immigrantDays) };
    }
  }

  // 6. emigration of unhappy families (never the founding households, nor tents)
  if (on("emigration")) {
    for (const h of Object.values(w.households)) {
      if (h.home === null || h.founder) continue;
      if (!(h.mood < MOOD_LEAVE) || !(rand() < RATES.moodLeaveDay)) continue;
      const n = h.members.length;
      // They take their share of the food along.
      const pop = Object.keys(w.residents).length;
      stock = { ...stock, food: stock.food * (1 - n / pop) };
      for (const m of h.members) delete w.residents[m];
      delete w.households[h.id];
      say(w, "departure", `Семья ${familyGenitive(h.last)} (${n} чел.) покинула поселение`);
    }
  }

  // 7. jobs and idle days
  jobsStep(w, s, work);

  return {
    ...s,
    rng,
    stock,
    residents: w.residents,
    households: w.households,
    nextPersonId: w.nextPersonId,
    nextHouseholdId: w.nextHouseholdId,
    events: w.events.slice(-MAX_EVENTS),
  };
}

// Drops references to buildings that are gone: such households go back to tents, such workers lose the job.
// Returns the same object when nothing changes.
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
  shop: "работает в Лавке",
  tavern: "работает в Постоялом дворе",
  gumno: "земледелец — Гумно",
  woodcutter: "лесоруб",
  sawpit: "пильщик — Пильня",
  quarry: "каменотёс — Каменоломня",
  fisher: "рыбак",
  well: "работает у колодца",
  market: "торгует на Рынке",
  chapel: "служит в Часовне",
  school: "учитель — Школа",
  healer: "лекарь",
  dig: "землекоп — Раскоп",
};

function roleOf(s: Pick<SimState, "buildings">, r: Resident, age: number, work: boolean, idle: Set<number>): string {
  if (age < ADULT_MIN) return age >= SERVICE.schoolFrom && r.school > 0 ? "школьник" : "ребёнок";
  if (age >= ADULT_MAX) return r.sex === "m" ? "старик" : "старуха";
  if (r.job !== null && idle.has(r.job)) return work ? "на стройке" : "без работы";
  if (r.job !== null) {
    const b = s.buildings[r.job];
    const t = b && BUILDINGS[b.template];
    if (b && t) return WORK_TEXT[t.id] ?? `работает — ${t.name}`;
  }
  return work ? "на стройке" : "без работы";
}

// Who lives in a house, or who works in a workplace. Null when there is no such building.
export function queryBuilding(s: SimState, id: number): BuildingQuery | null {
  const b = s.buildings[id];
  const t = b && BUILDINGS[b.template];
  if (!b || !t) return null;
  const now = s.gameMinutes;
  if (b.zone === "res") {
    const work = constructionWork(s.buildings, s.roads);
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
            return { id: r.id, name: fullName(r), age: Math.floor(age), sex: r.sex, role: roleOf(s, r, age, work, idle), literate: r.literate };
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
