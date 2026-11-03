import { describe, expect, it } from "vitest";
import { lightOpacity, placeAt, positionAt, standAt, whereAt, type Rest, type Trip } from "./life";

const trip: Trip = {
  id: 1,
  kind: "walk",
  pts: [
    [0, 0],
    [100, 0],
    [100, 50],
  ],
  depart: 600,
  speed: 10, // 150 m total -> 15 min
};

describe("placeAt", () => {
  it("heads along the segment it is on, turning at the corner", () => {
    expect(placeAt(trip, 605)!.dir).toEqual([1, 0]);
    expect(placeAt(trip, 613)!.dir).toEqual([0, 1]);
  });
  it("keeps the last heading on arrival", () => {
    expect(placeAt(trip, 615)!.dir).toEqual([0, 1]);
  });
});

describe("positionAt", () => {
  it("is null before departure and after arrival", () => {
    expect(positionAt(trip, 599)).toBeNull();
    expect(positionAt(trip, 616)).toBeNull();
  });
  it("starts and ends at the endpoints", () => {
    expect(positionAt(trip, 600)).toEqual([0, 0]);
    const end = positionAt(trip, 615)!;
    expect(end[0]).toBeCloseTo(100);
    expect(end[1]).toBeCloseTo(50);
  });
  it("interpolates along segments and around corners", () => {
    const a = positionAt(trip, 605)!;
    expect(a[0]).toBeCloseTo(50);
    expect(a[1]).toBeCloseTo(0);
    const b = positionAt(trip, 612)!;
    expect(b[0]).toBeCloseTo(100);
    expect(b[1]).toBeCloseTo(20);
  });
  it("handles trips crossing midnight", () => {
    const late: Trip = { ...trip, depart: 1435 };
    const p = positionAt(late, 3)!; // 8 min after departure -> 80 m
    expect(p[0]).toBeCloseTo(80);
    expect(positionAt(late, 20)).toBeNull();
  });
  it("is null for degenerate trips", () => {
    expect(positionAt({ ...trip, pts: [[0, 0]] }, 600)).toBeNull();
    expect(positionAt({ ...trip, speed: 0 }, 600)).toBeNull();
    expect(positionAt({ ...trip, pts: [[1, 1], [1, 1]] }, 600)).toBeNull();
  });
});

describe("lightOpacity", () => {
  it("is off by day and on at night", () => {
    expect(lightOpacity("house", 12)).toBe(0);
    expect(lightOpacity("house", 2)).toBeGreaterThan(0.5);
    expect(lightOpacity("house", 20.5)).toBeGreaterThan(0.3);
  });
  it("lights workplaces only until 21:00", () => {
    expect(lightOpacity("work", 20.5)).toBeGreaterThan(0);
    expect(lightOpacity("work", 21.5)).toBe(0);
    expect(lightOpacity("work", 3)).toBe(0);
  });
});

describe("standAt", () => {
  const rest: Rest = { who: 7, sex: "f", age: 30, home: [5, 5], work: { at: [500, 0], from: 420, to: 1140 } };
  const at = (r: Rest, walks: Trip[], m: number) => standAt(r, walks, m)?.at ?? null;
  it("without walks: at work in work hours, else at home", () => {
    expect(at(rest, [], 600)).toEqual([500, 0]);
    expect(standAt(rest, [], 600)!.working).toBe(true);
    expect(at(rest, [], 1200)).toEqual([5, 5]);
    expect(standAt(rest, [], 1200)!.working).toBe(false);
    expect(at({ ...rest, work: undefined }, [], 600)).toEqual([5, 5]);
  });
  it("indoors, in a house or a workshop, out of sight", () => {
    expect(standAt({ ...rest, home: null }, [], 1200)).toBeNull();
    expect(standAt({ ...rest, work: { at: null, from: 420, to: 1140 } }, [], 600)).toBeNull();
  });
  it("with walks: where the one that ended last took them, across midnight too; a tavern is indoors", () => {
    const out: Trip = { id: 14, kind: "walk", pts: [[0, 0], [100, 0]], depart: 360, speed: 10, who: 7, purpose: "work" };
    const back: Trip = { ...out, id: 15, pts: [[100, 0], [0, 0]], depart: 1140, purpose: "home" };
    const tavern: Trip = { ...out, id: 16, depart: 1200, purpose: "tavern" };
    expect(at(rest, [out, back], 400)).toEqual([500, 0]);
    expect(at(rest, [out, back], 1300)).toEqual([5, 5]);
    expect(at(rest, [out, back], 200)).toEqual([5, 5]); // home since last evening
    expect(at(rest, [out, back], 1139)).toEqual([500, 0]); // past work hours, but not left yet
    expect(standAt(rest, [out, back, tavern], 1250)).toBeNull();
  });
  it("without a walk to work the hours put them at work, though they walk to the tavern in the evening", () => {
    const builder: Rest = { ...rest, work: { at: [500, 0], from: 420, to: 1140, build: true } };
    const tavern: Trip = { id: 16, kind: "walk", pts: [[0, 0], [100, 0]], depart: 1200, speed: 10, who: 7, purpose: "tavern" };
    const home: Trip = { ...tavern, id: 17, pts: [[100, 0], [0, 0]], depart: 1290, purpose: "home" };
    expect(whereAt(builder, [tavern, home], 600)).toEqual({ where: "site", at: [500, 0] });
    expect(standAt(builder, [tavern, home], 600)!.working).toBe(true);
    expect(whereAt(builder, [tavern, home], 1250)).toMatchObject({ where: "tavern", at: null, last: tavern });
    expect(whereAt(builder, [tavern, home], 1350)).toMatchObject({ where: "home", at: [5, 5], last: home });
    expect(whereAt(builder, [tavern, home], 300)).toMatchObject({ where: "home", at: [5, 5] }); // home since last night
  });
  it("the same resident always faces the same way", () => {
    expect(standAt(rest, [], 1200)).toEqual(standAt(rest, [], 1300));
  });
});
