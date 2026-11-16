import { covers, SERVICE } from "./services";
import { BUILDINGS } from "./buildings";
import { YEAR_MIN } from "./time";
import type { Resident, SimState } from "./types";

// Places in one active school building.
// Grown-ups the town may send to school, from the age a child leaves school; up to the working age of people.ts.
const ADULT_FROM = SERVICE.schoolTo;
const ADULT_TO = 60;

export type SchoolState = Pick<SimState, "buildings" | "residents" | "households" | "coverage" | "gameMinutes" | "levers"> & Partial<Pick<SimState, "gov">>;

export const schoolSeats = (s: Pick<SimState, "buildings">): number =>
  Object.values(s.buildings).reduce((n, b) => n + (b.state === "active" ? (BUILDINGS[b.template]?.seats ?? 0) : 0), 0);

// Who is in class today, by resident id. Children 7–14 in a house a school covers come first; when the town sends its
// grown-ups to school, illiterate adults in covered houses come next. Teachers stay at their post. Taken in id order,
// up to the seats of the active schools.
export function classPupils(s: SchoolState): Set<number> {
  const out = new Set<number>();
  const seats = schoolSeats(s);
  if (seats === 0) return out;
  const inReach = (r: Resident) => {
    const home = s.households[r.household]?.home;
    return home != null && covers(s.coverage[home], "school");
  };
  const isTeacher = (r: Resident) => r.job !== null && !!BUILDINGS[s.buildings[r.job]?.template ?? ""]?.seats;
  const people = Object.values(s.residents).sort((a, b) => a.id - b.id);
  const take = (wanted: (age: number, r: Resident) => boolean) => {
    for (const r of people) {
      if (out.size >= seats) return;
      const age = (s.gameMinutes - r.born) / YEAR_MIN;
      if (wanted(age, r) && !isTeacher(r) && r.id !== s.gov?.head && inReach(r)) out.add(r.id); // the head sits in the town hall
    }
  };
  take((age) => age >= SERVICE.schoolFrom && age < SERVICE.schoolTo);
  if (s.levers.adultSchool) take((age, r) => age >= ADULT_FROM && age < ADULT_TO && !r.literate);
  return out;
}
