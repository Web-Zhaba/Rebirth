import { BUILDINGS, type JobGroup, type JobKey, type Priority } from "./buildings";
import { jobsOf } from "./fields";
import type { Building, SimState } from "./types";
import type { Levers } from "./levers";

// Job priorities and staff limits: who may work where (the assignment itself is `jobsStep` in people.ts).

type Jobs = Pick<SimState, "buildings" | "zones">;

// Priority 0..3 of a job group (2 for a state without levers).
export const priorityOf = (l: Pick<Levers, "jobs"> | undefined, key: JobKey): Priority => l?.jobs?.[key] ?? 2;

export const groupOf = (b: Pick<Building, "template">): JobGroup | null => BUILDINGS[b.template]?.group ?? null;

// Priority of the group a building belongs to (2 for a building without one).
export const buildingPriority = (b: Pick<Building, "template">, l: Pick<Levers, "jobs"> | undefined): Priority => {
  const g = groupOf(b);
  return g === null ? 2 : priorityOf(l, g);
};

// Places that staff limit leaves open: `staff` absent means all of them.
export const staffCap = (b: Pick<Building, "staff">, jobs: number): number => (b.staff === undefined ? jobs : Math.max(0, Math.min(jobs, Math.floor(b.staff))));

// People a workplace may hire now: its jobs, down to the staff limit, none while its group has priority «нет».
export function capacityOf(b: Building, s: Jobs & { levers?: Pick<Levers, "jobs"> }, assign?: Map<number, number>): number {
  const g = groupOf(b);
  if (g === null || priorityOf(s.levers, g) === 0) return 0;
  return staffCap(b, jobsOf(b, s, assign));
}

// Share of the adults the builders have at least (while construction work exists), by the priority of construction.
export const BUILD_SHARE: readonly number[] = [0, 0.1, 0.2, 0.4];
export const MIN_BUILDERS = 3;

export function buildFloor(adults: number, l: Pick<Levers, "jobs"> | undefined): number {
  const share = BUILD_SHARE[priorityOf(l, "build")];
  return share > 0 ? Math.max(MIN_BUILDERS, Math.ceil(share * adults - 1e-9)) : 0;
}
