import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { FIELD } from "./fields";
import { emptyGrowth } from "./growth";
import { harvestStats } from "./harvest";
import { emptyRoads } from "./roads";
import { cropOf } from "./tech";
import { YEAR_DAYS } from "./time";
import type { Building, Field, SimState } from "./types";
import { emptyZones } from "./zones";

// A field of 10 ha, and the year's grain once it is sown: what these figures are measured against.
const HECTARES = 10;
const at = (day: number, hour = 12, year = 1) => ((year - 1) * YEAR_DAYS + day - 1) * 1440 + hour * 60 - 360;
const SPRING = at(2); // the sowing days (year 1, season 0)
const MIDSUMMER = at(13); // after the late sowing days (summer days 1-4), before the harvest
const HARVEST = at(18); // the first half of autumn
const WINTER = at(28);

const bld = (id: number, template: string, x: number): Building => {
  const t = BUILDINGS[template];
  return {
    id,
    template,
    zone: t.zone,
    lot: { cx: x, cy: 3 + 4 * t.d, angle: 0, w: t.w, d: t.d },
    side: 1,
    footprint: [[x, 5], [x + 1, 5], [x + 1, 6], [x, 6]],
    height: t.height,
    state: "active",
    labor: t.labor,
    done: t.labor,
    created: 0,
    paid: true,
    level: 1,
    streak: 0,
  };
};

const rect = (id: number, x0: number, y0: number, x1: number, y1: number): Field => ({
  id,
  pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
  area: (x1 - x0) * (y1 - y0),
});
const FIELD10 = (id = 1) => rect(id, 100, 60, 300, 560); // 10 ha

function town(gm: number, fields: Field[], bs: Building[] = [bld(1, "gumno", 200)], sown = 0, reaped = 0): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  const s: SimState = { realTime: 0, gameMinutes: gm, roads: emptyRoads(), zones: { ...emptyZones(), fields }, ...emptyGrowth(7, gm), buildings };
  return sown > 0 || reaped > 0 ? { ...s, prod: { ...s.prod, fields: { 1: { year: 1, sowH: sown, harvH: 0, reaped } } } } : s;
}

const SOWN = FIELD.sowHoursHa * HECTARES; // the hours a field of 10 ha takes
const yieldOf = (s: SimState) => FIELD.yieldKgHa * HECTARES * cropOf(s);

describe("harvest", () => {
  it("counts the land while the sowing days last", () => {
    const h = harvestStats(town(SPRING, [FIELD10()]));
    expect(h).toMatchObject({ year: 1, gathered: 0, promised: 0 });
    expect(h.potential).toBeCloseTo(yieldOf(town(SPRING, [FIELD10()])));
    expect(h.perDay).toBeCloseTo(h.potential / YEAR_DAYS);
  });

  it("counts only what was sown once that window has closed", () => {
    const half = harvestStats(town(MIDSUMMER, [FIELD10()], undefined, SOWN / 2));
    expect(half.promised).toBeCloseTo(yieldOf(town(MIDSUMMER, [FIELD10()])) / 2);
    expect(half.perDay).toBeCloseTo(half.promised / YEAR_DAYS);
    // a spring missed is not hidden until the harvest: at midsummer the fields give nothing at all
    expect(harvestStats(town(MIDSUMMER, [FIELD10()])).perDay).toBe(0);
  });

  it("separates the grain in the barn from the grain still standing", () => {
    const s = town(HARVEST, [FIELD10()], undefined, SOWN, 40);
    const h = harvestStats(s);
    expect(h.gathered).toBe(40);
    expect(h.promised).toBeCloseTo(yieldOf(s)); // the whole year's crop, reaped or not
    expect(h.perDay).toBeCloseTo(h.promised / YEAR_DAYS);
  });

  it("counts the land again in winter, when the barn already holds the year's grain", () => {
    const s = town(WINTER, [FIELD10()], undefined, SOWN, 40);
    expect(harvestStats(s).perDay).toBeCloseTo(harvestStats(s).potential / YEAR_DAYS);
  });

  it("gives nothing for fields no gumno serves", () => {
    const s = town(MIDSUMMER, [FIELD10()], [bld(1, "barn", 200)], SOWN, 40);
    expect(harvestStats(s)).toMatchObject({ gathered: 40, promised: 0, potential: 0, perDay: 0 });
  });

  it("follows the crop the weather and the research allow", () => {
    const s = town(SPRING, [FIELD10()]);
    const dry = { ...s, weather: { ...s.weather, crop: 0.5 } };
    expect(harvestStats(dry).potential).toBeCloseTo(harvestStats(s).potential / 2);
  });

  it("starts over with the new year", () => {
    const s = town(at(2, 12, 2), [FIELD10()], undefined, SOWN, 40); // spring of year 2, last year's work behind
    expect(harvestStats(s)).toMatchObject({ year: 2, gathered: 0 });
  });
});
