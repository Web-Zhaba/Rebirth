import { describe, expect, it } from "vitest";
import { panLockedForTool, ROAD_MAX_MPP, BUILD_MAX_MPP } from "./tools";

describe("map pan ownership", () => {
  it("locks panning while a building placement tool is active", () => {
    expect(panLockedForTool("well", BUILD_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("gumno", BUILD_MAX_MPP / 2)).toBe(true);
  });

  it("keeps temporary Space-pan available while placing", () => {
    expect(panLockedForTool("well", BUILD_MAX_MPP / 2, true)).toBe(false);
  });

  it("keeps the map movable outside the tool's working zoom", () => {
    expect(panLockedForTool("well", BUILD_MAX_MPP * 2)).toBe(false);
  });

  it("locks panning for polygon-based fields and clearings too", () => {
    expect(panLockedForTool("field", BUILD_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("clearing", BUILD_MAX_MPP / 2)).toBe(true);
  });

  it("locks panning for roads and the house stroke too", () => {
    expect(panLockedForTool("path", ROAD_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("house", BUILD_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool(null, BUILD_MAX_MPP / 2)).toBe(false);
  });
});
