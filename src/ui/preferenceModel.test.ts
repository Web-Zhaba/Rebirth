import { describe, expect, it } from "vitest";
import { effectiveLayer, storedChoice } from "./preferenceModel";

describe("stored UI choices", () => {
  it("accepts only allowed stored values", () => {
    expect(storedChoice("zones", ["roads", "zones"] as const, "roads")).toBe("zones");
    expect(storedChoice("bad", ["roads", "zones"] as const, "roads")).toBe("roads");
    expect(storedChoice(null, ["roads", "zones"] as const, "roads")).toBe("roads");
  });

  it("temporarily overrides a manual layer and restores it", () => {
    expect(effectiveLayer("traffic", "well")).toBe("well");
    expect(effectiveLayer("traffic", null)).toBe("traffic");
    expect(effectiveLayer("none", null)).toBe("none");
  });
});
