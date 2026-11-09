import { describe, expect, it } from "vitest";
import { goodsTotal, homeGoods, takeGoods } from "./goods";
import type { Stock } from "./types";

const st = (clothes: number, dishes: number, furniture: number, tools: number): Stock => ({ food: 0, logs: 0, planks: 0, stone: 0, clothes, dishes, furniture, tools });

describe("goods", () => {
  it("totals the goods and the household goods", () => {
    expect(goodsTotal(st(1, 2, 3, 4))).toBe(10);
    expect(homeGoods(st(1, 2, 3, 4))).toBe(6);
  });
  it("takes household goods from the largest piles and keeps the tools", () => {
    const out = takeGoods(st(8, 4, 0, 5), 10)!;
    expect(homeGoods(out)).toBeCloseTo(2);
    expect(out.tools).toBe(5);
    expect(Math.min(out.clothes, out.dishes, out.furniture)).toBeGreaterThanOrEqual(0);
    expect(takeGoods(st(3, 3, 3, 50), 10)).toBeNull();
  });
});
