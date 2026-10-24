import { describe, expect, it } from "vitest";
import { gridDisk } from "h3-js";
import { CENTRE, RING1, RING2, info } from "./fixtures";
import { canBuild } from "./placement";
import { initialEconomy, type EconomyState } from "./sim";
import type { BuildingType } from "./defs";
import type { CellInfo } from "../world/cells";

const rich = (o: Partial<EconomyState> = {}): EconomyState => ({ ...initialEconomy(CENTRE, 0), food: 500, wood: 500, stone: 500, ...o });
const dry = (cell: string) => info(cell, "meadow");
const check = (type: BuildingType, i: CellInfo, state = rich(), neighbours?: CellInfo[]) =>
  canBuild(type, {
    info: i,
    neighbours: neighbours ?? gridDisk(i.cell, 1).filter((c) => c !== i.cell).map((c) => dry(c)),
    state,
  });
const reason = (r: ReturnType<typeof check>) => (r.ok ? "ok" : r.reason);
const A = RING1[0];

describe("canBuild", () => {
  it("land rules", () => {
    expect(reason(check("farm", info(A, "forest")))).toBe("Нужен луг");
    expect(check("farm", info(A, "meadow")).ok).toBe(true);
    expect(reason(check("lumber", info(A, "meadow")))).toBe("Нужен лес");
    expect(check("lumber", info(A, "forest")).ok).toBe(true);
    expect(reason(check("quarry", info(A, "meadow")))).toBe("Нужны скалы или склон");
    expect(check("quarry", info(A, "rock")).ok).toBe(true);
    expect(check("quarry", info(A, "meadow", { slope: 6 })).ok).toBe(true);
    expect(check("well", info(A, "sand")).ok).toBe(true);
    expect(check("well", info(A, "wetland")).ok).toBe(false);
    expect(check("hut", info(A, "sand", { river: true })).ok).toBe(true);
    expect(check("hut", info(A, "rock", { river: true })).ok).toBe(false);
  });
  it("steep blocks hut and farm only", () => {
    const steep = { steep: true, slope: 15 };
    expect(reason(check("farm", info(A, "meadow", steep)))).toBe("Слишком круто");
    expect(reason(check("hut", info(A, "forest", { ...steep, river: true })))).toBe("Слишком круто");
    expect(check("quarry", info(A, "rock", steep)).ok).toBe(true);
  });
  it("water is never buildable", () => {
    expect(reason(check("well", info(A, "water")))).toBe("Нельзя строить на воде");
  });
  it("needs an adjacent occupied cell", () => {
    expect(check("farm", dry(A)).ok).toBe(true);
    expect(reason(check("farm", dry(RING2[0])))).toBe("Нужно строить рядом с поселением");
  });
  it("occupied cell is refused", () => {
    expect(reason(check("farm", dry(CENTRE)))).toBe("Клетка занята");
  });
  it("camp cannot be built", () => {
    expect(check("camp", dry(A)).ok).toBe(false);
  });
  it("hut water access: neighbour water, river, own water, well, none", () => {
    expect(reason(check("hut", dry(A)))).toBe("Нет воды рядом");
    const wet = [{ ...dry(RING1[1]), landShares: { ...dry(A).landShares, water: 0.2 } }];
    expect(check("hut", dry(A), rich(), wet).ok).toBe(true);
    expect(check("hut", info(A, "meadow", { river: true })).ok).toBe(true);
    const own = info(A, "meadow");
    own.landShares.water = 0.1;
    expect(check("hut", own).ok).toBe(true);
    const near = gridDisk(A, 2).find((c) => c !== A && c !== CENTRE)!;
    const withWell = rich({ buildings: { ...rich().buildings, [near]: { type: "well", mult: 1 } } });
    expect(check("hut", dry(A), withWell).ok).toBe(true);
  });
  it("insufficient resources", () => {
    expect(reason(check("farm", dry(A), rich({ wood: 19 })))).toBe("Не хватает дерева");
    expect(reason(check("lumber", info(A, "forest"), rich({ food: 5 })))).toBe("Не хватает еды");
  });
});
