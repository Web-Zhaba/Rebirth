import { describe, expect, it } from "vitest";
import type { EconomyStats } from "../sim/types";
import { dayPhase, deltaDir, foodNet, perDay, warnings } from "./topbarModel";
import { calendar, isNight } from "../sim/clock";

const eco = (o: Partial<EconomyStats> = {}): EconomyStats => ({
  foodCap: 10000,
  foodPerDay: 100,
  foodDays: 50,
  yesterday: { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 },
  fields: { count: 0, ha: 0, assignedHa: 0, sown: 0, reaped: 0, expected: 0, window: "none" as never },
  avgMood: 0,
  forage: 0,
  brushwood: 0,
  outlook: 1,
  eveningWares: 0,
  fieldWork: 1,
  buildFactor: 1,
  firewood: 0,
  unheated: { households: 0, people: 0 },
  ...o,
});

describe("top bar model", () => {
  it("formats daily deltas with a real minus sign", () => {
    expect(perDay(24)).toBe("+24/дн");
    expect(perDay(-3)).toBe("−3/дн");
    expect(perDay(1.25, "м³")).toBe("+1,3/дн".replace("/дн", " м³/дн"));
    expect(perDay(0.01)).toBeNull();
    expect(deltaDir(-3)).toBe("down");
    expect(deltaDir(0)).toBe("");
  });

  it("day phase agrees with clock.ts night", () => {
    for (let m = 0; m < 1440; m += 30) expect(dayPhase(calendar(m).hour) === "night").toBe(isNight(m));
    expect(dayPhase(8)).toBe("morning");
    expect(dayPhase(14)).toBe("day");
    expect(dayPhase(19)).toBe("evening");
  });

  it("food net is production plus foraging minus eating", () => {
    expect(foodNet(eco({ yesterday: { food: 40, logs: 0, planks: 0, stone: 0, wares: 0 }, forage: 24, foodPerDay: 100 }))).toBe(-36);
  });

  it("warns about famine, low food, missing hands and logs", () => {
    const base = { food: 5000, eco: eco(), builders: 2, queue: 0, logs: 5, building: 0 };
    expect(warnings(base)).toEqual([]);
    expect(warnings({ ...base, food: 10 }).map((w) => w.id)).toEqual(["famine"]);
    expect(warnings({ ...base, eco: eco({ foodDays: 12 }) }).map((w) => w.id)).toEqual(["lowfood"]);
    expect(warnings({ ...base, queue: 3, builders: 0, building: 1, logs: 0 }).map((w) => w.id)).toEqual(["nohands", "nologs"]);
  });
});
