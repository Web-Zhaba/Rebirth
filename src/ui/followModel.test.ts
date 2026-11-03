import { describe, expect, it } from "vitest";
import type { Rest, Trip, Whereabouts } from "../map/life";
import type { Building, ResidentQuery } from "../sim/types";
import { buildingCentre, followStatus, residentPlace, residentPoint, residentWalk, type ResidentPlace } from "./followModel";

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
    const off = (place: Whereabouts | null): ResidentPlace => ({ walk: null, place });
    const on = (purpose: Trip["purpose"]): ResidentPlace => ({ walk: { trip: walk({ purpose }), pos: [0, 0] }, place: null });
    expect(followStatus(null, off(null)).key).toBe("gone");
    expect(followStatus(person(), on("work")).text).toBe("Идёт на работу");
    expect(followStatus(person(), on("home")).text).toBe("Идёт домой");
    expect(followStatus(person(), on("tavern")).text).toBe("Идёт на вечерний сбор");
    expect(followStatus(person(), off({ where: "work", at: null }))).toMatchObject({ key: "work", text: "На работе" });
    expect(followStatus(person(), off({ where: "site", at: [1, 1] }))).toMatchObject({ key: "site", text: "На стройке" });
    expect(followStatus(person(), off({ where: "tavern", at: null }))).toMatchObject({ key: "tavern", text: "На вечернем сборе" });
    expect(followStatus(person(), off({ where: "home", at: null }))).toMatchObject({ key: "home", text: "Дома" });
    expect(followStatus(person({ home: null }), off({ where: "home", at: [3, 0] }))).toMatchObject({ key: "camp", text: "В лагере" });
    expect(followStatus(person(), off(null))).toMatchObject({ key: "home" }); // no life drawn for them yet
  });

  it("reads where they are from the same rests their figure stands by", () => {
    // a jobless builder: at the site in work hours though they have no job, at home after
    const builder: Rest = { who: 7, sex: "m", age: 30, home: null, work: { at: [50, 50], from: 420, to: 1140, build: true } };
    const at = (m: number) => residentPlace([], [builder], 7, m);
    expect(at(600).place).toMatchObject({ where: "site", at: [50, 50] });
    expect(followStatus(person({ job: null }), at(600)).key).toBe("site");
    expect(followStatus(person({ job: null }), at(1200)).key).toBe("home");
    expect(residentPlace([], [], 7, 600)).toEqual({ walk: null, place: null });
  });

  it("points the camera where they show, else where their walk ended, else at the building they are in", () => {
    const buildings = { 1: house(1, 100, 0), 2: house(2, 300, 0) };
    expect(buildingCentre(buildings[1])).toEqual([100.5, 0.5]);
    expect(residentPoint(person(), { where: "site", at: [50, 50] }, buildings)).toEqual([50, 50]);
    expect(residentPoint(person(), { where: "tavern", at: null, last: walk({ purpose: "tavern" }) }, buildings)).toEqual([100, 0]);
    expect(residentPoint(person(), { where: "work", at: null }, buildings)).toEqual([300.5, 0.5]);
    expect(residentPoint(person(), { where: "home", at: null }, buildings)).toEqual([100.5, 0.5]);
    expect(residentPoint(person({ home: null }), null, buildings)).toEqual([0, 0]);
    // a stale workplace id falls back to the house rather than to the camp
    expect(residentPoint(person({ job: 999 }), { where: "work", at: null }, buildings)).toEqual([100.5, 0.5]);
  });
});
