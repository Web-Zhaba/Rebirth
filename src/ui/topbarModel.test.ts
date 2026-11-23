import { describe, expect, it } from "vitest";
import type { EconomyStats } from "../sim/types";
import { dayPhase, deltaDir, foodNet, harvestText, perDay, warnings } from "./topbarModel";
import { calendar, isNight } from "../sim/clock";

const eco = (o: Partial<EconomyStats> = {}): EconomyStats => ({
  foodCap: 10000,
  foodPerDay: 100,
  foodDays: 50,
  yesterday: { food: 0, logs: 0, planks: 0, stone: 0, clothes: 0, dishes: 0, furniture: 0, tools: 0 },
  fields: { count: 0, ha: 0, assignedHa: 0, sown: 0, reaped: 0, expected: 0, window: "none" as never },
  harvest: { year: 1, gathered: 0, promised: 0, potential: 0, perDay: 0 },
  foodIn: { fields: 0, makers: 0, forage: 0, total: 0 },
  avgMood: 0,
  admin: { pop: 0, capacity: 150, factor: 1 },
  forage: 0,
  brushwood: 0,
  outlook: 1,
  eveningWares: 0,
  traders: 0,
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

  it("food net is the year's income minus eating, not yesterday's output", () => {
    const income = (fields: number, makers: number, forage: number) => eco({ foodIn: { fields, makers, forage, total: fields + makers + forage }, foodPerDay: 100 });
    expect(foodNet(income(8, 6, 0))).toBe(-86);
    expect(foodNet(income(11, 7, 2))).toBe(-80);
    expect(foodNet(income(11, 7, 90))).toBe(8);
    // a day of the harvest itself says nothing about the rate: the net stays the year's average
    const harvestDay = eco({ foodIn: { fields: 11, makers: 0, forage: 0, total: 11 }, foodPerDay: 100, yesterday: { food: 356, logs: 0, planks: 0, stone: 0, clothes: 0, dishes: 0, furniture: 0, tools: 0 } });
    expect(foodNet(harvestDay)).toBe(-89);
  });

  it("reads the year's harvest as gathered of promised, or just gathered", () => {
    const h = (gathered: number, promised: number) => ({ year: 1, gathered, promised, potential: 356, perDay: 11 });
    expect(harvestText(h(120, 356))).toBe("120 кг из 356 кг");
    expect(harvestText(h(356, 356))).toBe("356 кг из 356 кг"); // nothing lost, nothing left standing
    expect(harvestText(h(356, 0))).toBe("356 кг"); // no sowing to compare with
    expect(harvestText(h(0, 356))).toBe("0 кг из 356 кг"); // sowing done, the reaping ahead
  });

  it("warns about famine, low food, missing hands and logs", () => {
    const base = { food: 5000, eco: eco(), builders: 2, queue: 0, logs: 5, building: 0 };
    expect(warnings(base)).toEqual([]);
    expect(warnings({ ...base, food: 10 }).map((w) => w.id)).toEqual(["famine"]);
    expect(warnings({ ...base, eco: eco({ foodDays: 12 }) }).map((w) => w.id)).toEqual(["lowfood"]);
    expect(warnings({ ...base, queue: 3, builders: 0, building: 1, logs: 0 }).map((w) => w.id)).toEqual(["nohands", "nologs"]);
  });

  it("names the residents whose needs are not met", () => {
    const base = { food: 5000, eco: eco(), builders: 2, queue: 0, logs: 5, building: 0 };
    const needs = { avg: { food: 40, rest: 90, social: 90, warmth: 90 }, starving: 3, tired: 2, lonely: 1, freezing: 4, work: 0.8 };
    expect(warnings({ ...base, needs }).map((w) => w.id)).toEqual(["starving", "tired", "lonely", "freezing"]);
    expect(warnings({ ...base, needs: { ...needs, starving: 0, tired: 0, lonely: 0, freezing: 0 } })).toEqual([]);
  });
});
