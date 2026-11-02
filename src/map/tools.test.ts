import { describe, expect, it } from "vitest";
import { panLockedForTool, ROAD_MAX_MPP, ZONE_MAX_MPP } from "./tools";

describe("map pan ownership", () => {
  it("locks panning while a building placement tool is active", () => {
    expect(panLockedForTool("well", ZONE_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("gumno", ZONE_MAX_MPP / 2)).toBe(true);
  });

  it("keeps temporary Space-pan available while placing", () => {
    expect(panLockedForTool("well", ZONE_MAX_MPP / 2, true)).toBe(false);
  });

  it("keeps the map movable outside the tool's working zoom", () => {
    expect(panLockedForTool("well", ZONE_MAX_MPP * 2)).toBe(false);
  });

  it("locks panning for polygon-based fields and clearings too", () => {
    expect(panLockedForTool("field", ZONE_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("clearing", ZONE_MAX_MPP / 2)).toBe(true);
  });

  it("preserves the existing road and zone-brush behaviour", () => {
    expect(panLockedForTool("path", ROAD_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("res", ZONE_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool("clear", ZONE_MAX_MPP / 2)).toBe(true);
    expect(panLockedForTool(null, ZONE_MAX_MPP / 2)).toBe(false);
  });
});
