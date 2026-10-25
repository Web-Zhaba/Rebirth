import { describe, expect, it } from "vitest";
import { PLACE_TOOLS, type Tool } from "../map/tools";
import { CATEGORIES, categoryOf, ITEM_KEYS, toolForKey, toolInfo } from "./buildMenu";

describe("build menu", () => {
  const all = CATEGORIES.flatMap((c) => c.tools);
  it("lists every tool exactly once, at most six per category", () => {
    const want: Tool[] = ["path", "dirt", "bulldoze", "res", "craft", "trade", "field", "clearing", "clear", ...PLACE_TOOLS];
    expect([...all].sort()).toEqual([...want].sort());
    for (const c of CATEGORIES) expect(c.tools.length).toBeLessThanOrEqual(ITEM_KEYS.length);
    expect(CATEGORIES.length).toBe(6);
  });
  it("maps keys to items of the active category, B to demolish", () => {
    expect(toolForKey("KeyQ", "food")).toBe("gumno");
    expect(toolForKey("KeyQ", "farm")).toBe("woodcutter");
    expect(toolForKey("KeyR", "farm")).toBe("barn");
    expect(toolForKey("KeyY", "roads")).toBeNull();
    expect(toolForKey("KeyB", "services")).toBe("bulldoze");
    expect(toolForKey("Digit1", "farm")).toBeNull();
    expect(categoryOf("bulldoze").id).toBe("roads");
  });
  it("takes costs from the sim tables", () => {
    const i = toolInfo("well");
    expect(i.labor).toBe("30 чел.-ч");
    expect(i.materials.map((m) => m.text)).toEqual(["2 м³", "0,5 м³", "3 т"]);
    expect(i.reach).toContain("150");
    expect(toolInfo("fisher").site).toContain("воды");
    expect(toolInfo("path").labor).toContain("0,1");
  });
});
