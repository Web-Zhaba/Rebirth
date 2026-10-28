import { describe, expect, it } from "vitest";
import { contextLayerForTool, placementCursor } from "./contextModel";

describe("context layers", () => {
  it("selects terrain context for placement tools", () => {
    expect(contextLayerForTool("clearing")).toBe("forest");
    expect(contextLayerForTool("woodcutter")).toBe("forest");
    expect(contextLayerForTool("forager")).toBe("forest");
    expect(contextLayerForTool("fisher")).toBe("water");
    expect(contextLayerForTool("quarry")).toBe("quarry");
    expect(contextLayerForTool("dig")).toBe("ruins");
    expect(contextLayerForTool("restore")).toBe("ruins");
    expect(contextLayerForTool("well")).toBeNull();
  });

  it("uses a forbidden cursor only for rejected lots", () => {
    expect(placementCursor(true, "ok")).toBe("crosshair");
    expect(placementCursor(true, "pending")).toBe("crosshair");
    expect(placementCursor(true, "bad")).toBe("not-allowed");
    expect(placementCursor(true, "none")).toBe("not-allowed");
    expect(placementCursor(false, "bad")).toBe("");
  });
});
