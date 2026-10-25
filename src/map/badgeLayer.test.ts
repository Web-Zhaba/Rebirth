import { describe, expect, it } from "vitest";
import { emptyJobs } from "../sim/levers";
import type { Building, BuildingQuery } from "../sim/types";
import { badgeFor } from "./badgeModel";

const b = (over: Partial<Building> = {}): Building =>
  ({ id: 1, template: "smithy", zone: "craft", state: "active", labor: 100, done: 0, ...over }) as Building;
const query = (workers: number[] = []): BuildingQuery => ({ kind: "workplace", capacity: 3, workers }) as unknown as BuildingQuery;
const jobs = (over: Record<string, number> = {}) => ({ jobs: { ...emptyJobs(), ...over } });

describe("badgeFor", () => {
  it("shows the percent while building", () => {
    expect(badgeFor(b({ state: "building", done: 42 }), null)?.label).toBe("42%");
  });
  it("says no people for an open workplace without workers", () => {
    expect(badgeFor(b(), query(), jobs())?.label).toBe("нет людей");
  });
  it("shows the reason when hiring is closed by staff 0 or priority none", () => {
    expect(badgeFor(b({ staff: 0 }), query(), jobs())?.label).toBe("набор закрыт");
    expect(badgeFor(b(), query(), jobs({ crafts: 0 }))?.label).toBe("приоритет «нет»");
  });
  it("shows nothing for a staffed workplace", () => {
    expect(badgeFor(b(), query([1]), jobs())).toBeNull();
  });
});
