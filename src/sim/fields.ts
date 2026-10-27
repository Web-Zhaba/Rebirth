import { BUILDINGS } from "./buildings";
import { calendar, DAYS_PER_SEASON, YEAR_SCALE } from "./time";
import { cropOf } from "./tech";
import { fieldWork } from "./weatherEffects";
import type { Building, Field, FieldWork, Resident, SimState, Stock, Window } from "./types";

// Food from work that needs no field: kg per worker-hour and the factor of each season (0 spring .. 3 winter).
// The fisher is buffed on purpose (P-food); the hunter and the kitchen garden are the other ways to feed the town.
export const FOOD_RATE: Record<string, { kgHour: number; season: [number, number, number, number] }> = {
  fisher: { kgHour: 0.6, season: [1, 1, 1, 0.5] },
  garden: { kgHour: 0.2, season: [1, 1, 1, 0] }, // the beds lie fallow in winter
  hunter: { kgHour: 0.15, season: [0.5, 0.5, 1, 2] }, // game comes down to the izba in the cold
  // Alternative food: berries, mushrooms and nuts (a staffed forager feeds about 4 adults a year; an orchard 5-7 once it bears; an apiary 1-2); fruit trees (production.ts: a
  // bearing orchard, scaled by the year's quality); honey (kg of food equivalent, weather decides most of it).
  forager: { kgHour: 0.13, season: [0.3, 1, 1.4, 0] },
  orchard: { kgHour: 0.8, season: [0, 0, 1, 0] },
  apiary: { kgHour: 0.3, season: [0.3, 1, 0.7, 0] },
};
// Gathering in the forest asks for this share of forest around the site (growth.ts checks it).
export const FORAGER_FOREST = 0.2;
// Years before planted trees bear.
export const ORCHARD_YEARS = 1;
export const foodKgHour = (template: string, season: number): number => {
  const r = FOOD_RATE[template];
  return r ? r.kgHour * r.season[season] : 0;
};

// Field work tuning (design: PLAN.md section 8).
export const FIELD = {
  yieldKgHa: 400 * YEAR_SCALE, // per year, net of seed
  sowHoursHa: 50 * YEAR_SCALE,
  harvestHoursHa: 200 * YEAR_SCALE,
  reapKgHour: 2,
  haPerJob: 2.5,
  maxJobs: 16,
  radius: 400, // m, from the lot centre of a gumno to the centroid of a field
  harvestDays: DAYS_PER_SEASON / 2, // first half of autumn
};
// Day of the year on which the harvest window closes (autumn is the third season).
export const HARVEST_END_DAY = 2 * DAYS_PER_SEASON + FIELD.harvestDays;

// Sowing goes on into the first days of summer, but a late hour counts for half: a farm that stands a little after
// spring still sows a part of its fields instead of losing the whole year.
export const LATE_SOWING = { days: 4, credit: 0.5 };

export const haOf = (f: Field): number => f.area / 10_000;

export function fieldCentroid(f: Pick<Field, "pts">): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = f.pts.length - 1; i < f.pts.length; j = i++) {
    const k = f.pts[j][0] * f.pts[i][1] - f.pts[i][0] * f.pts[j][1];
    a += k;
    cx += (f.pts[j][0] + f.pts[i][0]) * k;
    cy += (f.pts[j][1] + f.pts[i][1]) * k;
  }
  if (Math.abs(a) < 1e-9) return [f.pts.reduce((m, p) => m + p[0], 0) / f.pts.length, f.pts.reduce((m, p) => m + p[1], 0) / f.pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}

// Field id -> id of the nearest active gumno within FIELD.radius (ties: lowest id). Fields out of range are absent.
export function assignFields(fields: readonly Field[], buildings: Record<number, Building>): Map<number, number> {
  const gumnos = Object.values(buildings).filter((b) => b.template === "gumno" && b.state === "active");
  const out = new Map<number, number>();
  if (gumnos.length === 0) return out;
  for (const f of fields) {
    const [x, y] = fieldCentroid(f);
    let best = FIELD.radius;
    let id = -1;
    for (const g of gumnos) {
      const d = Math.hypot(g.lot.cx - x, g.lot.cy - y);
      if (d < best || (d === best && id >= 0 && g.id < id)) {
        best = d;
        id = g.id;
      }
    }
    if (id >= 0) out.set(f.id, id);
  }
  return out;
}

export function assignedHa(gumno: number, fields: readonly Field[], assign: Map<number, number>): number {
  let ha = 0;
  for (const f of fields) if (assign.get(f.id) === gumno) ha += haOf(f);
  return ha;
}

// Job capacity of a building: fixed by the template, except a gumno, which needs one hand per 2.5 ha.
export function jobsOf(b: Building, s: Pick<SimState, "buildings" | "zones">, assign?: Map<number, number>): number {
  if (b.template !== "gumno") return BUILDINGS[b.template]?.jobs ?? 0;
  const a = assign ?? assignFields(s.zones.fields, s.buildings);
  return Math.max(0, Math.min(FIELD.maxJobs, Math.ceil(assignedHa(b.id, s.zones.fields, a) / FIELD.haPerJob - 1e-9)));
}

// ---------- seasons ----------

export function windowAt(gameMinutes: number): Window {
  const c = calendar(gameMinutes);
  if (c.season === 0 || (c.season === 1 && c.dayOfSeason <= LATE_SOWING.days)) return "sowing";
  if (c.season === 2 && c.dayOfSeason <= FIELD.harvestDays) return "harvest";
  return null;
}

// Person-hours of work a field still has in the open window; `crop` (yield potential) shortens or lengthens the harvest.
export function remainingHours(f: Field, w: FieldWork, win: Window, crop = 1): number {
  if (win === "sowing") return Math.max(0, FIELD.sowHoursHa * haOf(f) - w.sowH);
  if (win === "harvest") return Math.max(0, FIELD.harvestHoursHa * haOf(f) * sownShare(f, w) * crop - w.harvH);
  return 0;
}

// Sowing progress per hour of work now: 1 in spring, less in the late days.
export const sowCredit = (gameMinutes: number): number => (calendar(gameMinutes).season === 0 ? 1 : LATE_SOWING.credit);

type Idle = Pick<SimState, "residents" | "buildings" | "gameMinutes" | "zones" | "prod" | "stock"> & Partial<Pick<SimState, "weather" | "progress">>;

// Active gumnos with no work for their farmers right now.
export function idleGumnos(s: Idle): Set<number> {
  const out = new Set<number>();
  const win = windowAt(s.gameMinutes);
  const gumnos = Object.values(s.buildings).filter((b) => b.template === "gumno" && b.state === "active");
  if (gumnos.length === 0) return out;
  if (win === null || (s.weather && fieldWork(s.weather) <= 0)) { // frozen, snowed in: the farmers join the artel
    for (const b of gumnos) out.add(b.id);
    return out;
  }
  const year = calendar(s.gameMinutes).year;
  const assign = assignFields(s.zones.fields, s.buildings);
  const left = new Map<number, number>();
  for (const f of s.zones.fields) {
    const g = assign.get(f.id);
    if (g !== undefined) left.set(g, (left.get(g) ?? 0) + remainingHours(f, workOf(s.prod.fields, f.id, year), win, cropOf(s)));
  }
  for (const b of gumnos) if ((left.get(b.id) ?? 0) <= 1e-9) out.add(b.id);
  return out;
}

// The stock good a workshop needs to work at all.
export const WORKSHOP_INPUT: Record<string, keyof Stock> = { sawpit: "logs", smithy: "logs", carpentry: "planks" };

// Workshops that made nothing yesterday and find their input missing now: their workers have nothing to do.
function blockedWorkshops(s: Pick<Idle, "buildings" | "stock" | "prod">): Set<number> {
  const out = new Set<number>();
  for (const b of Object.values(s.buildings)) {
    const good = WORKSHOP_INPUT[b.template];
    if (good && b.state === "active" && s.stock[good] <= 1e-9 && (s.prod.yesterday[b.id] ?? 0) <= 1e-9) out.add(b.id);
  }
  return out;
}

// Orchards with nothing to pick: the trees do not bear yet, or it is not autumn.
export function idleOrchards(s: Idle): Set<number> {
  const out = new Set<number>();
  const autumn = calendar(s.gameMinutes).season === 2;
  for (const b of Object.values(s.buildings)) if (b.template === "orchard" && b.state === "active" && !(autumn && bears(b, s.gameMinutes))) out.add(b.id);
  return out;
}

// Workplaces whose workers join the construction artel: farmers while the land has no work for them,
// the workers of workshops blocked by missing inputs, and the gardeners of an orchard out of season.
export function idleWorkplaces(s: Idle): Set<number> {
  const out = idleGumnos(s);
  for (const id of blockedWorkshops(s)) out.add(id);
  for (const id of idleOrchards(s)) out.add(id);
  return out;
}

// Fruit trees bear a year after the orchard was finished (Building.ripe, stamped by the daily step).
export const bears = (b: Pick<Building, "ripe">, now: number): boolean => b.ripe !== undefined && now >= b.ripe;

// Farmers (workers of a gumno) join the artel outside the two windows, and inside one
// when their gumno has no work left in it.
export function idleFarmers(s: Idle): number {
  const idle = idleGumnos(s);
  return idle.size === 0 ? 0 : countWorkers(s.residents, idle);
}

export function idleWorkers(s: Idle): number {
  const idle = idleWorkplaces(s);
  return idle.size === 0 ? 0 : countWorkers(s.residents, idle);
}

function countWorkers(residents: Record<number, Resident>, set: Set<number>): number {
  let n = 0;
  for (const r of Object.values(residents)) if (r.job !== null && set.has(r.job)) n++;
  return n;
}

// ---------- yearly progress ----------

export const emptyWork = (year: number): FieldWork => ({ year, sowH: 0, harvH: 0, reaped: 0 });

export const workOf = (fields: Record<number, FieldWork>, id: number, year: number): FieldWork => {
  const w = fields[id];
  return w && w.year === year ? w : emptyWork(year);
};

export const sownShare = (f: Field, w: FieldWork): number => Math.min(1, w.sowH / (FIELD.sowHoursHa * haOf(f)));
// Kg the field can still give this year (what sowing made possible, times the yield potential `crop` of the weather).
export const expectedKg = (f: Field, w: FieldWork, crop = 1): number => FIELD.yieldKgHa * haOf(f) * sownShare(f, w) * crop;

// ---------- progress for the 3D fields ----------

// What a field shows of this year's work: the share of its area sown and the share of its area harvested (0..1, in steps of
// 1/PROGRESS_STEPS so the client sees a change only when it is visible). Fields with no work this year are absent.
export const PROGRESS_STEPS = 50;
export interface FieldProgress {
  sown: number;
  harv: number;
}
const quant = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * PROGRESS_STEPS) / PROGRESS_STEPS;

export function fieldProgress(s: Pick<SimState, "zones" | "prod" | "gameMinutes"> & Partial<Pick<SimState, "weather" | "progress">>): Record<number, FieldProgress> {
  const out: Record<number, FieldProgress> = {};
  const year = calendar(s.gameMinutes).year;
  const crop = cropOf(s);
  for (const f of s.zones.fields) {
    const w = s.prod.fields[f.id];
    if (!w || w.year !== year) continue;
    const sown = sownShare(f, w);
    const need = FIELD.harvestHoursHa * haOf(f) * sown * crop;
    const harv = need > 1e-9 ? Math.min(1, w.harvH / need) * sown : 0;
    if (sown > 0 || harv > 0) out[f.id] = { sown: quant(sown), harv: quant(harv) };
  }
  return out;
}
