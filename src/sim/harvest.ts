import { assignFields, expectedKg, FIELD, haOf, windowAt, workOf } from "./fields";
import { calendar, YEAR_DAYS } from "./time";
import { cropOf } from "./tech";
import type { HarvestStats, SimState } from "./types";

// What the fields give the town this year: the grain already in the barn, the grain this year's sowing promises, and the
// grain the land could give. The harvest lands all at once, in the first half of autumn, so a day's figure is only the
// year's average — which is how the food balance reads it (foodIncome in production.ts).
//
// Since the sowing days still let the player sow, a field left unsown is counted at its potential then. Once that window
// closes, only what was actually sown counts, so a spring missed shows up in the food balance at midsummer, not at the
// harvest.

type FieldSource = Pick<SimState, "gameMinutes" | "zones" | "prod" | "buildings"> & Partial<Pick<SimState, "weather" | "progress">>;

export function harvestStats(s: FieldSource): HarvestStats {
  const cal = calendar(s.gameMinutes);
  const crop = cropOf(s);
  const assign = assignFields(s.zones.fields, s.buildings);
  let gathered = 0;
  let promised = 0;
  let potential = 0;
  for (const f of s.zones.fields) {
    const w = workOf(s.prod.fields, f.id, cal.year);
    gathered += w.reaped;
    if (!assign.has(f.id)) continue;
    promised += expectedKg(f, w, crop);
    potential += FIELD.yieldKgHa * haOf(f) * crop;
  }
  // Summer and autumn count what the sowing made possible. Spring counts the land (it is still to be sown) and so does
  // winter (the barn holds this year's grain already; the next harvest comes from the next sowing).
  const sowing = windowAt(s.gameMinutes) === "sowing";
  const grain = !sowing && (cal.season === 1 || cal.season === 2) ? promised : potential;
  return { year: cal.year, gathered, promised, potential, perDay: grain / YEAR_DAYS };
}
