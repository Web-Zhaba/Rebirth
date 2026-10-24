import { BUILDINGS } from "./buildings";
import { calendar } from "./time";
import type { Building, Field, FieldWork, Resident, SimState, Window } from "./types";

// Field work tuning (design: PLAN.md section 8).
export const FIELD = {
  yieldKgHa: 400, // net of seed
  sowHoursHa: 50,
  harvestHoursHa: 200,
  reapKgHour: 2,
  haPerJob: 2.5,
  maxJobs: 16,
  radius: 400, // m, from the lot centre of a gumno to the centroid of a field
  harvestDays: 45, // of autumn
};

export const haOf = (f: Field): number => f.area / 10_000;

export function fieldCentroid(f: Field): [number, number] {
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
  if (c.season === 0) return "sowing";
  if (c.season === 2 && c.dayOfSeason <= FIELD.harvestDays) return "harvest";
  return null;
}

// Person-hours of work a field still has in the open window.
export function remainingHours(f: Field, w: FieldWork, win: Window): number {
  if (win === "sowing") return Math.max(0, FIELD.sowHoursHa * haOf(f) - w.sowH);
  if (win === "harvest") return Math.max(0, FIELD.harvestHoursHa * haOf(f) * sownShare(f, w) - w.harvH);
  return 0;
}

// Farmers (workers of a gumno) join the artel outside the two windows, and inside one
// when their gumno has no work left in it.
export function idleFarmers(s: Pick<SimState, "residents" | "buildings" | "gameMinutes" | "zones" | "prod">): number {
  const win = windowAt(s.gameMinutes);
  const farmers = new Map<number, number>();
  for (const r of Object.values(s.residents) as Resident[]) {
    if (r.job === null) continue;
    const b = s.buildings[r.job];
    if (b && b.template === "gumno" && b.state === "active") farmers.set(b.id, (farmers.get(b.id) ?? 0) + 1);
  }
  if (farmers.size === 0) return 0;
  let n = 0;
  if (win === null) {
    for (const k of farmers.values()) n += k;
    return n;
  }
  const year = calendar(s.gameMinutes).year;
  const assign = assignFields(s.zones.fields, s.buildings);
  const left = new Map<number, number>();
  for (const f of s.zones.fields) {
    const g = assign.get(f.id);
    if (g !== undefined) left.set(g, (left.get(g) ?? 0) + remainingHours(f, workOf(s.prod.fields, f.id, year), win));
  }
  for (const [g, k] of farmers) if ((left.get(g) ?? 0) <= 1e-9) n += k;
  return n;
}

// ---------- yearly progress ----------

export const emptyWork = (year: number): FieldWork => ({ year, sowH: 0, harvH: 0, reaped: 0 });

export const workOf = (fields: Record<number, FieldWork>, id: number, year: number): FieldWork => {
  const w = fields[id];
  return w && w.year === year ? w : emptyWork(year);
};

export const sownShare = (f: Field, w: FieldWork): number => Math.min(1, w.sowH / (FIELD.sowHoursHa * haOf(f)));
// Kg the field can still give this year (what sowing made possible).
export const expectedKg = (f: Field, w: FieldWork): number => FIELD.yieldKgHa * haOf(f) * sownShare(f, w);
