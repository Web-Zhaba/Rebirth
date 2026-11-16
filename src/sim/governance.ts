import { BUILDINGS, scaledJobs } from "./buildings";
import { manageMul, workMul, type Government } from "./government";
import type { Building, Resident } from "./types";

// Administration. The founding elders manage a hamlet; a town hall and district offices
// manage more, each by the share of its clerks at work. Past what the town can manage every work rate (production,
// field work, construction) drops gently: «перегрузка управления». The head of the town (sim/government.ts) widens or
// narrows what the town can manage and speeds or slows every work.
export const ADMIN = {
  elders: 150, // residents the town manages without any office
  slope: 0.4, // work rate 1 / (1 + slope x (load - 1)) past the capacity
  floor: 0.5, // the rate never drops below this
};

export interface AdminState {
  pop: number;
  capacity: number; // residents the town can manage now
  factor: number; // 0.5..1, every work rate is multiplied by it
}

// An office of the administration (its rules' `manages`: the residents a fully staffed one adds).
export const isOffice = (template: string): boolean => !!BUILDINGS[template]?.manages;

// The work rate at `pop` residents with `capacity` managed.
export function overload(pop: number, capacity: number): number {
  const load = capacity > 0 ? pop / capacity : Infinity;
  return load <= 1 ? 1 : Math.max(ADMIN.floor, 1 / (1 + ADMIN.slope * (load - 1)));
}

// Jobs change at the daily step and when a workplace opens, so this holds as long as both objects do.
const cache = new WeakMap<object, WeakMap<object, AdminState>>();

type AdminSource = { residents: Record<number, Resident>; buildings: Record<number, Building>; gov?: Government | null; gameMinutes?: number };

export function adminOf(s: AdminSource): AdminState {
  const base = officesOf(s);
  if (!s.gov || s.gameMinutes === undefined) return base;
  const capacity = base.capacity * manageMul({ ...s, gameMinutes: s.gameMinutes });
  return { pop: base.pop, capacity, factor: overload(base.pop, capacity) };
}

function officesOf(s: AdminSource): AdminState {
  let byBuildings = cache.get(s.residents);
  if (!byBuildings) {
    byBuildings = new WeakMap();
    cache.set(s.residents, byBuildings);
  }
  const hit = byBuildings.get(s.buildings);
  if (hit) return hit;
  const clerks = new Map<number, number>();
  let pop = 0;
  for (const r of Object.values(s.residents)) {
    pop++;
    if (r.job !== null && isOffice(s.buildings[r.job]?.template ?? "")) clerks.set(r.job, (clerks.get(r.job) ?? 0) + 1);
  }
  let capacity = ADMIN.elders;
  for (const b of Object.values(s.buildings)) {
    if (b.state !== "active" || !isOffice(b.template)) continue;
    const jobs = scaledJobs(BUILDINGS[b.template].jobs, b);
    capacity += scaledJobs(BUILDINGS[b.template].manages!, b) * (jobs > 0 ? Math.min(1, (clerks.get(b.id) ?? 0) / jobs) : 1);
  }
  const out = { pop, capacity, factor: overload(pop, capacity) };
  byBuildings.set(s.buildings, out);
  return out;
}

// The rate every work runs at: the administration's load times the head's hand.
export const adminFactor = (s: AdminSource): number => adminOf(s).factor * (s.gov && s.gameMinutes !== undefined ? workMul({ ...s, gameMinutes: s.gameMinutes }) : 1);
