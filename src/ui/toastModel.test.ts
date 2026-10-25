import { describe, expect, it } from "vitest";
import type { TownEvent } from "../sim/types";
import { diffEvents, hoursLeft, MAX_NEW, MAX_TOASTS, pushToast, type Toast } from "./toastModel";

const ev = (at: number, text = "x"): TownEvent => ({ at, kind: "built", text });
const toast = (id: number, important = false): Toast => ({ id, kind: important ? "goal" : "built", text: "t", important });

describe("diffEvents", () => {
  it("baseline marks everything seen and returns no news", () => {
    const r = diffEvents([ev(1), ev(2)], null);
    expect(r.fresh).toEqual([]);
    expect(r.seen.size).toBe(2);
  });
  it("returns only unseen events", () => {
    const base = diffEvents([ev(1), ev(2)], null).seen;
    const r = diffEvents([ev(1), ev(2), ev(3)], base);
    expect(r.fresh.map((e) => e.at)).toEqual([3]);
  });
  it("caps a burst to the newest", () => {
    const base = diffEvents([], null).seen;
    const burst = Array.from({ length: 12 }, (_, i) => ev(i, `e${i}`));
    const r = diffEvents(burst, base);
    expect(r.fresh).toHaveLength(MAX_NEW);
    expect(r.fresh.at(-1)?.at).toBe(11);
  });
});

describe("pushToast", () => {
  it("keeps at most MAX_TOASTS, dropping unimportant first", () => {
    let l: Toast[] = [toast(1, true), toast(2), toast(3), toast(4)];
    l = pushToast(l, toast(5));
    expect(l).toHaveLength(MAX_TOASTS);
    expect(l.map((t) => t.id)).toEqual([1, 3, 4, 5]);
  });
  it("drops the oldest when all are important", () => {
    const l = pushToast([toast(1, true), toast(2, true), toast(3, true), toast(4, true)], toast(5, true));
    expect(l.map((t) => t.id)).toEqual([2, 3, 4, 5]);
  });
});

describe("hoursLeft", () => {
  it("rounds up and floors at 1", () => {
    expect(hoursLeft(150, 0)).toBe(3);
    expect(hoursLeft(10, 100)).toBe(1);
  });
});
