import { describe, expect, it } from "vitest";
import { fieldProgress, FIELD, haOf } from "./fields";
import { calendar } from "./time";
import type { Field, FieldWork } from "./types";

const field = (id: number): Field => ({ id, area: 20_000, pts: [[0, 0], [100, 0], [100, 200], [0, 200]] }) as unknown as Field;
const AT = 5 * 24 * 60; // some game minute
const year = calendar(AT).year;
const state = (fields: Field[], work: Record<number, FieldWork>) => ({ zones: { fields } as never, prod: { fields: work } as never, gameMinutes: AT });

describe("fieldProgress", () => {
  it("skips fields with no work this year", () => {
    const f = field(1);
    expect(fieldProgress(state([f], {}))).toEqual({});
    expect(fieldProgress(state([f], { 1: { year: year - 1, sowH: 99999, harvH: 0, reaped: 0 } }))).toEqual({});
  });
  it("reports sown and harvested shares of the field area, quantised", () => {
    const f = field(1);
    const sowAll = FIELD.sowHoursHa * haOf(f);
    const reapAll = FIELD.harvestHoursHa * haOf(f);
    const p = fieldProgress(state([f], { 1: { year, sowH: sowAll / 2, harvH: 0, reaped: 0 } }));
    expect(p[1]).toEqual({ sown: 0.5, harv: 0 });
    // half of the harvest of a half-sown field is a quarter of the area
    const q = fieldProgress(state([f], { 1: { year, sowH: sowAll / 2, harvH: reapAll / 4, reaped: 0 } }));
    expect(Math.abs(q[1].harv - 0.25)).toBeLessThanOrEqual(0.02);
    const done = fieldProgress(state([f], { 1: { year, sowH: sowAll * 2, harvH: reapAll * 5, reaped: 0 } }));
    expect(done[1]).toEqual({ sown: 1, harv: 1 });
    expect(Math.round(p[1].sown * 50)).toBe(p[1].sown * 50);
  });
});
