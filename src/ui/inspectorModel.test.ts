import { describe, expect, it } from "vitest";
import type { Building, BuildingQuery, Clearing } from "../sim/types";
import { areaText, buildingStatus, clearingView, siteHands, templateIcon } from "./inspectorModel";

const b = (over: Partial<Building>): Building =>
  ({ id: 1, template: "sawpit", state: "active", labor: 50, done: 50, level: 1, streak: 0, paid: true, ...over }) as Building;
const work = (over: Partial<Extract<BuildingQuery, { kind: "workplace" }>>): BuildingQuery => ({ kind: "workplace", capacity: 2, workers: [], ...over });

describe("buildingStatus", () => {
  it("reports construction states", () => {
    expect(buildingStatus(b({ state: "building" }), null, false).label).toBe("строится");
    expect(buildingStatus(b({ state: "planned" }), null, true).label).toBe("ждёт материалов");
    expect(buildingStatus(b({ state: "planned" }), null, false).label).toBe("в очереди");
    expect(buildingStatus(b({ upgrade: { labor: 1, done: 0, paid: true } }), null, false).label).toBe("перестраивается");
  });
  it("reports workplace problems", () => {
    expect(buildingStatus(b({}), work({}), false)).toEqual({ label: "нет работников", tone: "bad" });
    expect(buildingStatus(b({}), work({ production: { good: "planks", yesterday: 0, missing: "брёвна" } }), false).label).toBe("нет сырья");
    const w = { id: 1, name: "А", age: 30, commute: 3, idle: false };
    expect(buildingStatus(b({}), work({ workers: [w] }), false)).toEqual({ label: "работает", tone: "ok" });
  });
});

describe("helpers", () => {
  it("picks icons", () => {
    expect(templateIcon("izba")).toBe("res");
    expect(templateIcon("smithy")).toBe("craft");
    expect(templateIcon("tavern")).toBe("trade");
    expect(templateIcon("sawpit")).toBe("sawpit");
  });
  it("limits hands to a crew except on a toloka", () => {
    expect(siteHands(20, false)).toBe(6);
    expect(siteHands(20, true)).toBe(20);
    expect(siteHands(3, false)).toBe(3);
  });
  it("computes clearing numbers", () => {
    const c = { id: 1, pts: [], area: 10000, forest: 1, labor: 100, done: 25 } as Clearing;
    const v = clearingView(c);
    expect(v.share).toBe(0.25);
    expect(v.logsAll).toBeCloseTo(250);
    expect(v.logsNow).toBeCloseTo(62.5);
    expect(v.remaining).toBe(75);
  });
  it("formats area", () => {
    expect(areaText(12500)).toBe("1,3 га");
    expect(areaText(4000)).toBe("0,40 га");
  });
});
