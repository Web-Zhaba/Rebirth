import { describe, expect, it } from "vitest";
import { PointerClickTracker } from "./pointer";

describe("PointerClickTracker", () => {
  it("accepts a primary tap after pointerup", () => {
    const clicks = new PointerClickTracker();
    clicks.pointerDown(1, [20, 30]);
    clicks.pointerUp(1);
    expect(clicks.isClick(1, [24, 33])).toBe(true);
  });

  it("rejects a drag beyond the click tolerance", () => {
    const clicks = new PointerClickTracker();
    clicks.pointerDown(1, [20, 30]);
    clicks.pointerUp(1);
    expect(clicks.isClick(1, [40, 30])).toBe(false);
  });

  it("rejects clicks from a two-pointer gesture", () => {
    const clicks = new PointerClickTracker();
    clicks.pointerDown(1, [20, 30]);
    clicks.pointerDown(2, [80, 30]);
    clicks.pointerUp(1);
    expect(clicks.isClick(1, [20, 30])).toBe(false);
    clicks.pointerUp(2);
    expect(clicks.isClick(2, [80, 30])).toBe(false);
  });

  it("supports a MouseEvent click fallback without a pointer id", () => {
    const clicks = new PointerClickTracker();
    clicks.pointerDown(3, [10, 10]);
    clicks.pointerUp(3);
    expect(clicks.isClick(null, [12, 12])).toBe(true);
  });

  it("rejects a pointer that was cancelled", () => {
    const clicks = new PointerClickTracker();
    clicks.pointerDown(7, [10, 10]);
    clicks.pointerCancel(7);
    expect(clicks.isClick(7, [10, 10])).toBe(false);
  });

  it("does not reuse a stale drag start when the browser reuses a pointer id", () => {
    const clicks = new PointerClickTracker();
    clicks.pointerDown(1, [0, 0]);
    clicks.pointerUp(1);
    expect(clicks.isClick(1, [20, 20])).toBe(false);
    clicks.pointerDown(1, [50, 50]);
    clicks.pointerUp(1);
    expect(clicks.isClick(1, [51, 50])).toBe(true);
  });
});
