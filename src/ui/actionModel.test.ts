import { describe, expect, it } from "vitest";
import { duplicateTool, needsRoadDemolishConfirm } from "./actionModel";

describe("quick actions", () => {
  it("builds another with the tool and kind of the building, not of a site restored as it was", () => {
    expect(duplicateTool("well", undefined)).toEqual({ tool: "well" });
    expect(duplicateTool("izba5", undefined)).toEqual({ tool: "house", variant: "izba5" });
    expect(duplicateTool("tavern", undefined)).toEqual({ tool: "shop", variant: "tavern" });
    expect(duplicateTool("logyard", undefined)).toEqual({ tool: "barn", variant: "logyard" });
    expect(duplicateTool("excavation", undefined)).toBeNull();
    expect(duplicateTool("well", "old:1")).toBeNull();
  });

  it("confirms only demolition of completed expensive roads", () => {
    expect(needsRoadDemolishConfirm("bridge", 100, 100)).toBe(true);
    expect(needsRoadDemolishConfirm("stone", 50, 50)).toBe(true);
    expect(needsRoadDemolishConfirm("dirt", 100, 100)).toBe(false);
    expect(needsRoadDemolishConfirm("bridge", 40, 100)).toBe(false);
  });
});
