import { describe, expect, it } from "vitest";
import type { FoundFeature, FoundFoundation, FoundPlace, SimState } from "../sim/types";
import { placesView } from "./placesModel";

// A places tab as the snapshot carries it: two old streets 30 m apart, a house of each, old house numbers between them,
// one of them inside the dug house, one far from any street, and a sign that is not a house number.

const square = (x: number, y: number, half = 10): [number, number][] => [
  [x - half, y - half],
  [x + half, y - half],
  [x + half, y + half],
  [x - half, y + half],
];

const street = (id: string, name: string, y: number, restored?: number): FoundPlace => ({
  id,
  name,
  kind: "street",
  digId: 1,
  at: 0,
  lines: [[[0, y], [100, y]]],
  ...(restored === undefined ? {} : { restored }),
});

const house = (id: string, x: number, y: number, extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring: square(x, y), area: 400, digId: 1, at: 0, ...extra });

const number = (id: string, x: number, y: number): FoundFeature => ({ id, kind: "number", x, y, digId: 1, name: id });

const state = (finds: Partial<SimState["finds"]>): Pick<SimState, "finds" | "buildings" | "roads" | "progress"> =>
  ({
    finds: { foundations: [], features: [], streets: [], pois: [], ...finds },
    buildings: {},
    roads: { nodes: {}, edges: {} },
    progress: { recognised: {} },
  }) as unknown as Pick<SimState, "finds" | "buildings" | "roads" | "progress">;

describe("placesView", () => {
  const houses: FoundFoundation[] = [house("ha", 20, 2), house("hb", 20, 28)];
  const features: FoundFeature[] = [
    number("n1", 50, 1), // nearest to the first street: 1 m against 29 m
    number("n2", 50, 29), // nearest to the second
    number("n3", 50, 15), // 15 m from each: the first street in the list keeps it
    number("n4", 50, 100), // out of the reach of any street
    number("n5", 20, 2), // inside the dug house of the first street
    { id: "s1", kind: "sign", x: 5, y: 5, digId: 1 }, // not a house number
  ];

  it("gives each feature to one street: its nearest, once, in list order on a tie", () => {
    const { streets } = placesView(state({ streets: [street("a", "Улица А", 0), street("b", "Улица Б", 30)], foundations: houses, features }));
    const row = Object.fromEntries(streets.map((r) => [r.id, r]));
    // n1, n3 and n5 are the first street's; n2 the second's; n4 belongs to no street at all.
    expect(row.a.numbers).toEqual({ found: 1, total: 3 });
    expect(row.b.numbers).toEqual({ found: 0, total: 1 });
    expect(row.a.household).toEqual({ found: 1, total: 1 });
    expect(row.b.household).toEqual({ found: 1, total: 1 });
  });

  it("keeps the tie with the street listed first", () => {
    const { streets } = placesView(state({ streets: [street("b", "Улица Б", 30), street("a", "Улица А", 0)], foundations: houses, features }));
    const row = Object.fromEntries(streets.map((r) => [r.id, r]));
    expect(row.b.numbers.total).toBe(2); // n2 and the tied n3
    expect(row.a.numbers.total).toBe(2); // n1 and n5
  });

  it("leaves out a street with no houses of its own, unless its name came back", () => {
    const streets = [street("a", "Улица А", 0), street("c", "Улица В", 200), street("d", "Улица Г", 400, 5)];
    const { streets: rows } = placesView(state({ streets, foundations: houses, features }));
    expect(rows.map((r) => r.id)).toEqual(["a", "d"]); // the restored one last, the empty one gone
    expect(rows[1]).toMatchObject({ houses: 0, restored: true });
  });

  it("counts a house number as found only inside a dug house of that street", () => {
    const ghost = house("hb", 20, 28, { ghost: true });
    const { streets } = placesView(state({ streets: [street("a", "Улица А", 0), street("b", "Улица Б", 30)], foundations: [house("ha", 20, 2), ghost], features }));
    const row = Object.fromEntries(streets.map((r) => [r.id, r]));
    expect(row.a.household).toEqual({ found: 1, total: 1 });
    expect(row.b.household).toEqual({ found: 0, total: 1 }); // surveyed, not dug: no household of its own yet
  });
});
