import { describe, expect, it } from "vitest";
import { duplicateTemplate, needsRoadDemolishConfirm } from "./actionModel";

describe("quick actions", () => {
  const tools = ["well", "market", "woodcutter"];

  it("duplicates only ordinary player-placed templates", () => {
    expect(duplicateTemplate("well", undefined, tools)).toBe("well");
    expect(duplicateTemplate("izba", undefined, tools)).toBeNull();
    expect(duplicateTemplate("well", "old:1", tools)).toBeNull();
  });

  it("confirms only demolition of completed expensive roads", () => {
    expect(needsRoadDemolishConfirm("bridge", 100, 100)).toBe(true);
    expect(needsRoadDemolishConfirm("stone", 50, 50)).toBe(true);
    expect(needsRoadDemolishConfirm("dirt", 100, 100)).toBe(false);
    expect(needsRoadDemolishConfirm("bridge", 40, 100)).toBe(false);
  });
});
