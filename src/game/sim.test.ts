import { describe, expect, it } from "vitest";
import { OFFLINE_CAP_MS } from "./defs";
import { CENTRE, RING1, info } from "./fixtures";
import { advanceTo, build, buildCost, initialEconomy, rates, step, yieldMult, type EconomyState } from "./sim";

const base = (o: Partial<EconomyState> = {}): EconomyState => ({ ...initialEconomy(CENTRE, 0), ...o });
const withFarms = (n: number, pop: number): EconomyState =>
  base({
    pop,
    buildings: {
      [CENTRE]: { type: "camp", mult: 1 },
      ...Object.fromEntries(RING1.slice(0, n).map((c) => [c, { type: "farm" as const, mult: 1 }])),
    },
  });

describe("production", () => {
  it("camp is not affected by staffing", () => {
    const r = rates(base({ pop: 1 }));
    expect(r.staffing).toBe(1);
    expect(r.wood).toBeCloseTo(0.2);
    expect(r.food).toBeCloseTo(0.4 - 0.1);
  });
  it("full staffing", () => {
    const r = rates(withFarms(1, 4)); // needs 2 workers
    expect(r.staffing).toBe(1);
    expect(r.food).toBeCloseTo(0.4 + 0.6 - 0.4);
  });
  it("partial staffing scales farm output", () => {
    const r = rates(withFarms(2, 2)); // needs 4, has 2
    expect(r.staffing).toBe(0.5);
    expect(r.food).toBeCloseTo(0.4 + 2 * 0.6 * 0.5 - 0.2);
  });
  it("step leaves its input untouched", () => {
    const s = base();
    const copy = JSON.parse(JSON.stringify(s));
    const n = step(s);
    expect(s).toEqual(copy);
    expect(n.time).toBe(1000);
  });
});

describe("food and population", () => {
  it("clamps food at 0 and starves down to 1", () => {
    let s = base({ food: 0, pop: 3, buildings: {} });
    for (let i = 0; i < 500; i++) {
      s = step(s);
      expect(s.food).toBe(0);
    }
    expect(s.pop).toBe(1);
  });
  it("starving reduces pop by 0.02/s", () => {
    const s = step(base({ food: 0, pop: 3, buildings: {} }));
    expect(s.pop).toBeCloseTo(2.98);
  });
  it("growth is capped at housing", () => {
    let s = base({ food: 1e6, pop: 3 });
    for (let i = 0; i < 200; i++) s = step(s);
    expect(s.pop).toBe(5);
  });
});

describe("advanceTo", () => {
  it("one big jump equals many small ones", () => {
    const s0 = withFarms(2, 3);
    const end = 3600 * 1000;
    const once = advanceTo(s0, end);
    let many = s0;
    let t = 0;
    let seed = 12345;
    while (t < end) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      t = Math.min(end, t + 1 + (seed % 7000));
      many = advanceTo(many, t);
    }
    expect(many).toEqual(once);
  });
  it("caps offline time at 24 h", () => {
    const s0 = base();
    const a = advanceTo(s0, OFFLINE_CAP_MS);
    const b = advanceTo(s0, OFFLINE_CAP_MS + 5 * 3600 * 1000);
    expect(b.time).toBe(OFFLINE_CAP_MS + 5 * 3600 * 1000);
    expect(b.wood).toBeCloseTo(a.wood); // the extra 5 h were dropped
    expect(b.pop).toBe(a.pop);
  });
});

describe("costs and building", () => {
  it("scales 1.15^n rounded up", () => {
    let s = base({ wood: 1000 });
    expect(buildCost("hut", s).wood).toBe(15);
    s = build(s, "hut", RING1[0], info(RING1[0]));
    expect(buildCost("hut", s).wood).toBe(18); // 17.25
    s = build(s, "hut", RING1[1], info(RING1[1]));
    expect(buildCost("hut", s).wood).toBe(20); // 19.84
    expect(buildCost("lumber", s)).toEqual({ food: 10, wood: 15, stone: 0 });
  });
  it("pays the cost and stores the multiplier", () => {
    const i = info(RING1[0], "meadow", { river: true });
    const s = build(base(), "farm", RING1[0], i);
    expect(s.wood).toBe(0);
    expect(s.buildings[RING1[0]].mult).toBeCloseTo(0.7 + 0.6 + 0.3);
  });
  it("yield multipliers", () => {
    expect(yieldMult("lumber", info(RING1[0], "forest"))).toBeCloseTo(1.5);
    expect(yieldMult("quarry", info(RING1[0], "rock", { slope: 40 }))).toBeCloseTo(2.5);
    expect(yieldMult("hut", info(RING1[0]))).toBe(1);
  });
});
