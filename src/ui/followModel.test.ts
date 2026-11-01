import { describe, expect, it } from "vitest";
import type { Trip } from "../map/lifeLayer";
import type { Building, ResidentQuery } from "../sim/types";
import { buildingCentre, followStatus, residentPoint, residentWalk } from "./followModel";

const walk = (over: Partial<Trip>): Trip => ({ id: 1, kind: "walk", pts: [[0, 0], [100, 0]], depart: 1140, speed: 100, who: 7, purpose: "home", ...over });

const person = (over: Partial<ResidentQuery> = {}): ResidentQuery => ({
  kind: "resident",
  id: 7,
  name: "Иван Тестов",
  age: 30,
  sex: "m",
  role: "кузнец — Кузница",
  home: 1,
  job: 2,
  commute: 5,
  idle: false,
  ...over,
});

const house = (id: number, x: number, y: number): Building => ({ id, footprint: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] }) as Building;

describe("following a resident", () => {
  it("picks the walk of that resident and ignores everybody else", () => {
    const trips = [
      walk({ id: 1, who: 8, depart: 1140 }),
      walk({ id: 2, who: 7, depart: 1140, purpose: "work" }),
      walk({ id: 3, who: 7, depart: 1200, purpose: "home", pts: [[100, 0], [0, 0]] }),
      { id: 4, kind: "cart" as const, pts: [[0, 0], [10, 0]] as [number, number][], depart: 1140, speed: 50 },
    ];
    const at1140 = residentWalk(trips, 7, 1140.5);
    expect(at1140?.trip.purpose).toBe("work");
    expect(at1140?.pos[0]).toBeGreaterThan(0);
    const at1200 = residentWalk(trips, 7, 1200.5);
    expect(at1200?.trip.purpose).toBe("home");
    expect(at1200?.pos[0]).toBeLessThan(100);
    expect(residentWalk(trips, 7, 1000)).toBeNull();
    expect(residentWalk(trips, 9, 1140.5)).toBeNull();
  });

  it("names where the resident is or where they are heading", () => {
    expect(followStatus(null, null, true).key).toBe("gone");
    expect(followStatus(person(), { trip: walk({ purpose: "work" }) }, true).text).toBe("Идёт на работу");
    expect(followStatus(person(), { trip: walk({ purpose: "home" }) }, true).text).toBe("Идёт домой");
    expect(followStatus(person(), { trip: walk({ purpose: "tavern" }) }, true).text).toBe("Идёт на вечерний сбор");
    expect(followStatus(person(), null, true)).toMatchObject({ key: "work", text: "На работе" });
    expect(followStatus(person(), null, false)).toMatchObject({ key: "home", text: "Дома" });
    expect(followStatus(person({ home: null }), null, false)).toMatchObject({ key: "camp", text: "В лагере" });
    expect(followStatus(person({ idle: true }), null, true)).toMatchObject({ key: "site", text: "На стройке" });
  });

  it("points the camera at the workplace in work hours and at home otherwise", () => {
    const buildings = { 1: house(1, 100, 0), 2: house(2, 300, 0) };
    expect(buildingCentre(buildings[1])).toEqual([100.5, 0.5]);
    expect(residentPoint(person(), true, buildings)).toEqual([300.5, 0.5]);
    expect(residentPoint(person(), false, buildings)).toEqual([100.5, 0.5]);
    expect(residentPoint(person({ home: null }), false, buildings)).toEqual([0, 0]);
    // a stale workplace id falls back to the house rather than to the camp
    expect(residentPoint(person({ job: 999 }), true, buildings)).toEqual([100.5, 0.5]);
  });
});
