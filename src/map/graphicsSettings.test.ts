import { describe, expect, it } from "vitest";
import { ANTIALIAS_MODES, antialias, setAntialias } from "./graphicsSettings";

// The map's multisampling is a start-up choice (engine/gpu/device.ts): the count is baked into the pipelines, so the
// settings dialog can only offer what the engine knows how to build.

describe("antialiasing setting", () => {
  it("offers the sample counts the map can be built with", () => {
    expect(ANTIALIAS_MODES).toEqual([1, 4]); // WebGPU: four samples or none
  });

  it("defaults to four samples and follows the player's choice", () => {
    expect(antialias.value).toBe(4); // no storage in a test process: the default, as before the setting existed
    setAntialias(1);
    expect(antialias.value).toBe(1);
    setAntialias(4);
    expect(antialias.value).toBe(4);
  });
});
