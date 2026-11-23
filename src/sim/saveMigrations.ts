import { emptyGrowth, seedOf } from "./growth";
import { SERVICE } from "./services";
import { YEAR_MIN, YEAR_SCALE } from "./time";
import { emptyRoads } from "./roads";
import { emptyZones } from "./zones";
import { isNum, isRecord, parseCity } from "./saveChecks";
import type { SaveV4 } from "./types";

// The save format's history, one migration per change. A save must load in any later version, not only the next one
// (a portal under moderation lags behind the others): the version dispatch is in parseSave (save.ts).
//
// - v1, v2 — old localStorage saves: the city is kept, the village starts fresh (`migrateLegacy`).
// - v3 — a 360-day year: `born` is rescaled so every resident keeps their age in years, school days scale with the
//   year (`fromV3`).
// - v4 — the current format. Older shapes inside it ("saves from before goods groups", "before house levels", ...)
//   are read with their fallbacks by the parsers of save.ts, never rejected: a broken entry is dropped, not the save.

// v3 had a 360-day year. Game time and every timestamp stay as they are (the date is re-read in the
// new calendar); `born` is rescaled so each resident keeps their age in years, school days scale with the year.
const YEAR_MIN_V3 = 360 * 1440;
export function fromV3(v: Record<string, unknown>): Record<string, unknown> {
  const sim = v.sim;
  if (!isRecord(sim) || !isNum(sim.gameMinutes) || !isRecord(sim.residents)) return { ...v, version: 4 };
  const now = sim.gameMinutes;
  const residents: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(sim.residents)) {
    if (!isRecord(r) || !isNum(r.born)) {
      residents[k] = r;
      continue;
    }
    // v3 kept school days (of a 360-day year); the literacy progress is a share of the child's school time now.
    const school = isNum(r.school) ? Math.min(100, (r.school * YEAR_SCALE * 100) / SERVICE.childLiteracyDays) : r.school;
    residents[k] = { ...r, born: now - (now - r.born) * (YEAR_MIN / YEAR_MIN_V3), school };
  }
  return { ...v, version: 4, sim: { ...sim, residents } };
}

// Old localStorage saves (v1, v2): keep the city, start a fresh village.
export function migrateLegacy(raw: string, now: number): SaveV4 | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;
  const city = parseCity(o.city);
  if (!city) return null;
  return { version: 4, city, sim: { realTime: now, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt)) } };
}

// Saves from before goods groups trade "wares": they trade clothing now.
export function oldTrade(v: unknown): unknown {
  if (!isRecord(v)) return v;
  const fix = (g: unknown) => (g === "wares" ? "clothes" : g);
  return { ...v, give: fix(v.give), get: fix(v.get) };
}
