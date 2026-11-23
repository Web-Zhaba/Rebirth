import { describe, expect, it } from "vitest";
import type { Building, Finds } from "../../sim/types";
import { progressStep, PROGRESS_STEPS, sameKey, type ItemKey } from "./itemMemo";

const bld = { id: 1, template: "izba" } as Building;
const finds = { foundations: [], pois: [], streets: [], revealed: [] } as unknown as Finds;

const key = (over: Partial<ItemKey> = {}): ItemKey => ({
  building: bld,
  finds,
  overlay: "none",
  lamp: undefined,
  flag: undefined,
  tint: "",
  step: PROGRESS_STEPS,
  ...over,
});

describe("sameKey", () => {
  it("is the same picture when every part is the same object or value", () => {
    expect(sameKey(key(), key())).toBe(true);
  });

  it("rebuilds the item when the building itself changed", () => {
    expect(sameKey(key(), key({ building: { id: 1, template: "izba" } as Building }))).toBe(false);
  });

  it("rebuilds it when the town hall's flag, the lamp or the overlay colour changed", () => {
    expect(sameKey(key(), key({ lamp: "house" }))).toBe(false);
    expect(sameKey(key(), key({ tint: "#ff0000" }))).toBe(false);
    expect(sameKey(key(), key({ overlay: "value" }))).toBe(false);
    const flag = { kind: "bars", colors: ["#000000"] } as unknown as ItemKey["flag"];
    expect(sameKey(key(), key({ flag }))).toBe(false);
  });

  it("rebuilds it when the finds were replaced, even by equal content (their ids are looked up there)", () => {
    expect(sameKey(key(), key({ finds: { ...finds } as Finds }))).toBe(false);
  });

  it("keeps dark buildings dark: absent lamp and flag compare by identity", () => {
    expect(sameKey(key({ lamp: undefined }), key({ lamp: undefined }))).toBe(true);
    expect(sameKey(key({ flag: undefined }), key({ flag: undefined }))).toBe(true);
  });

  it("keeps a site's item between two progress steps and rebuilds it on the next", () => {
    expect(sameKey(key({ step: 3 }), key({ step: 3 }))).toBe(true);
    expect(sameKey(key({ step: 3 }), key({ step: 4 }))).toBe(false);
  });
});

describe("progressStep", () => {
  it("is a whole step per 1/24 of the work", () => {
    expect(progressStep(0)).toBe(0);
    expect(progressStep(0.001)).toBe(0);
    expect(progressStep(1 / PROGRESS_STEPS)).toBe(1);
    expect(progressStep(0.5)).toBe(12);
  });

  it("is the last step when the work is done, including overshoot", () => {
    expect(progressStep(1)).toBe(PROGRESS_STEPS);
    expect(progressStep(1.5)).toBe(PROGRESS_STEPS);
  });

  it("does not change between two ticks that barely moved the site", () => {
    expect(progressStep(0.3)).toBe(progressStep(0.3 + 1 / 60));
  });
});
