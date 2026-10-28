import { describe, expect, it } from "vitest";
import { trackpadPanDelta, wheelIntent } from "./trackpadModel";

describe("trackpad wheel classification", () => {
  it("treats smooth pixel gestures as pan", () => {
    expect(wheelIntent({ deltaX: 12, deltaY: 3, deltaMode: 0, ctrlKey: false })).toBe("pan");
    expect(wheelIntent({ deltaX: 0, deltaY: 12, deltaMode: 0, ctrlKey: false })).toBe("pan");
  });

  it("leaves mouse wheel and pinch to MapLibre zoom", () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 120, deltaMode: 0, ctrlKey: false })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: true })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false })).toBe("zoom");
  });

  it("preserves trackpad movement direction", () => {
    expect(trackpadPanDelta({ deltaX: -4, deltaY: 9 })).toEqual([-4, 9]);
  });
});
