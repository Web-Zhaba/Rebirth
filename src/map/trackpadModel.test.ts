import { describe, expect, it } from "vitest";
import { trackpadCameraDelta, wheelIntent } from "./trackpadModel";

describe("trackpad wheel classification", () => {
  it("treats smooth pixel gestures as camera movement", () => {
    expect(wheelIntent({ deltaX: 12, deltaY: 3, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("camera");
    expect(wheelIntent({ deltaX: 0, deltaY: 18, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("camera");
  });

  it("leaves mouse wheel and pinch to MapLibre zoom", () => {
    expect(wheelIntent({ deltaX: 0, deltaY: 100, deltaMode: 0, ctrlKey: false, metaKey: false })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: true, metaKey: false })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 2, deltaMode: 0, ctrlKey: false, metaKey: true })).toBe("zoom");
    expect(wheelIntent({ deltaX: 0, deltaY: 3, deltaMode: 1, ctrlKey: false, metaKey: false })).toBe("zoom");
  });

  it("maps horizontal movement to bearing, vertical movement to pitch, and clamps spikes", () => {
    expect(trackpadCameraDelta({ deltaX: -10, deltaY: 20 })).toEqual({ bearing: -1.7999999999999998, pitch: 2.4 });
    expect(trackpadCameraDelta({ deltaX: 300, deltaY: -400 })).toEqual({ bearing: 14.399999999999999, pitch: -9.6 });
  });
});
