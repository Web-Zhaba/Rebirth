import { describe, expect, it } from "vitest";
import { gestureIntent, trackpadCameraDelta, WHEEL_GESTURE_MS, wheelIntent } from "./trackpad";

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

  it("reads the legacy delta where the browser gives it", () => {
    const base = { deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false };
    // a mouse notch at 250 % page zoom: a small pixel delta, still 120 legacy
    expect(wheelIntent({ ...base, deltaY: 40, wheelDeltaY: -120, wheelDeltaX: 0 })).toBe("zoom");
    // a fast trackpad swipe: a large pixel delta, exactly -3x legacy
    expect(wheelIntent({ ...base, deltaY: 64, wheelDeltaY: -192, wheelDeltaX: 0 })).toBe("camera");
  });

  it("keeps one intent through a gesture", () => {
    const e = (deltaY: number) => ({ deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false });
    let g = gestureIntent(null, e(8), 0);
    expect(g.intent).toBe("camera");
    g = gestureIntent(g, e(90), 16); // the swipe speeds up past a mouse notch's size
    expect(g.intent).toBe("camera");
    expect(gestureIntent(g, e(90), 16 + WHEEL_GESTURE_MS).intent).toBe("zoom"); // a new gesture
    expect(gestureIntent(g, { ...e(2), ctrlKey: true }, 20).intent).toBe("zoom"); // a pinch
  });

  it("maps horizontal movement to bearing, vertical movement to pitch, and clamps spikes", () => {
    expect(trackpadCameraDelta({ deltaX: -10, deltaY: 20 })).toEqual({ bearing: -1.7999999999999998, pitch: 2.4 });
    expect(trackpadCameraDelta({ deltaX: 300, deltaY: -400 })).toEqual({ bearing: 14.399999999999999, pitch: -9.6 });
  });
});
