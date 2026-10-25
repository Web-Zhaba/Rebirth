import { BUILDINGS, JOB_GROUPS } from "./buildings";
import { jobsOf, assignFields } from "./fields";
import { buildFloor, capacityOf, groupOf, priorityOf } from "./jobs";
import { ageOf, artel, constructionWork, countResidents, isAdultAge, isWorkplace } from "./people";
import type { JobGroupRow, JobReport, SimState } from "./types";

// The work report the Town panel shows: per job group, the workers and the places left by priority and staff limits.
export function jobReport(s: SimState): JobReport {
  const assign = assignFields(s.zones.fields, s.buildings);
  const rows = new Map<string, JobGroupRow>(JOB_GROUPS.map((key) => [key, { key, workers: 0, places: 0, open: 0, closedByPriority: 0, closedByStaff: 0 }]));
  const staffed = new Map<number, number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) staffed.set(r.job, (staffed.get(r.job) ?? 0) + 1);
  for (const b of Object.values(s.buildings)) {
    const g = isWorkplace(b) ? groupOf(b) : null;
    if (g === null || !BUILDINGS[b.template]) continue;
    const row = rows.get(g)!;
    const jobs = jobsOf(b, s, assign);
    const cap = capacityOf(b, s, assign);
    const workers = staffed.get(b.id) ?? 0;
    row.workers += workers;
    row.places += cap;
    row.open += Math.max(0, cap - workers);
    if (priorityOf(s.levers, g) === 0) row.closedByPriority += jobs;
    else row.closedByStaff += jobs - cap;
  }
  const c = countResidents(s.residents, s.gameMinutes);
  let tentAdults = 0;
  for (const h of Object.values(s.households)) {
    if (h.home !== null) continue;
    for (const m of h.members) if (s.residents[m] && isAdultAge(ageOf(s.residents[m].born, s.gameMinutes))) tentAdults++;
  }
  const construction = constructionWork(s.buildings, s.roads, s.clearings);
  return {
    groups: JOB_GROUPS.map((k) => rows.get(k)!),
    adults: c.adults,
    jobless: c.jobless,
    tentAdults,
    construction,
    floor: construction ? buildFloor(c.adults, s.levers) : 0,
    drafted: artel(s).drafted,
  };
}
