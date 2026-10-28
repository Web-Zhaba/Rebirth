import { describe, expect, it } from "vitest";
import { trackpadPanDelta, wheelIntent } from "./trackpadModel";

describe("trackpad wheel classification", () => {
  it("treats smooth pixel gestures as pan", () => {
    expect(wheelIntent({ deltaX: 12, deltaY: 3, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("pan");
    expect(wheelIntent({ deltaX: 0, deltaY: 18, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("pan");
  });

  it("leaves mouse wheel and pinch to MapLibre zoom", () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: true, metaKey: false })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: false, metaKey: true })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false, metaKey: false })).toBe("zoom");
  });

  it("preserves precise movement and clamps accidental spikes", () => {
    expect(trackpadPanDelta({ deltaX: -4, deltaY: 9 })).toEqual([-4, 9]);
    expect(trackpadPanDelta({ deltaX: 300, deltaY: -400 })).toEqual([160, -160]);
  });
});
