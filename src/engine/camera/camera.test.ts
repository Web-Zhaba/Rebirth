import { describe, expect, it } from "vitest";
import { EYE_CLEARANCE, liftEyeAboveGround, type CameraState } from "./camera";

const cam = (o: Partial<CameraState> = {}): CameraState => ({ lat: 47.27, lng: 11.4, h: 0, distance: 100, heading: 30, pitch: 80, fovY: 36.87, ...o });

describe("liftEyeAboveGround", () => {
  it("leaves a camera that clears the ground alone", () => {
    const s = cam();
    liftEyeAboveGround(s, () => 0);
    expect(s.pitch).toBe(80);
  });

  it("tilts up until the eye clears a slope behind the target", () => {
    // ground 50 m above the target all around: the eye 100 m out must stay over 52 m, so cos(pitch) >= 0.52
    const s = cam();
    liftEyeAboveGround(s, () => 50);
    expect(s.pitch).toBeCloseTo((Math.acos((50 + EYE_CLEARANCE) / 100) * 180) / Math.PI, 1);
  });

  it("does nothing where the ground is unknown", () => {
    const s = cam();
    liftEyeAboveGround(s, () => null);
    expect(s.pitch).toBe(80);
  });
});
