import { describe, expect, it } from "vitest";
import { PLACE_TOOLS, ROAD_MATERIALS, roadKindOf, type Tool } from "../map/tools";
import { CATEGORIES, categoryOf, ITEM_KEYS, toolForKey, toolInfo, toolLabel } from "./buildMenu";

describe("build menu", () => {
  const all = CATEGORIES.flatMap((c) => c.tools);
  it("lists every tool exactly once, at most eight per category", () => {
    const want: Tool[] = ["path", "dirt", "footbridge", "bridge", "bulldoze", "restore", "res", "craft", "trade", "field", "clearing", "clear", ...PLACE_TOOLS];
    expect([...all].sort()).toEqual([...want].sort());
    for (const c of CATEGORIES) expect(c.tools.length).toBeLessThanOrEqual(ITEM_KEYS.length);
    expect(CATEGORIES.length).toBe(6);
  });
  it("maps keys to items of the active category, B to demolish", () => {
    expect(toolForKey("KeyQ", "food")).toBe("gumno");
    expect(toolForKey("KeyQ", "farm")).toBe("woodcutter");
    expect(toolForKey("KeyR", "farm")).toBe("barn");
    expect(toolForKey("KeyY", "roads")).toBe("restore");
    expect(toolForKey("KeyU", "roads")).toBeNull();
    expect(toolForKey("KeyI", "roads")).toBeNull();
    expect(toolForKey("KeyY", "past")).toBeNull();
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
  it("shows the chosen material on the road and bridge tools", () => {
    expect(roadKindOf("dirt", { dirt: "dirt", bridge: "bridge" })).toBe("dirt");
    expect(roadKindOf("dirt", { dirt: "stone", bridge: "bridge" })).toBe("stone");
    expect(roadKindOf("bridge", { dirt: "dirt", bridge: "stonebridge" })).toBe("stonebridge");
    expect(roadKindOf("bulldoze")).toBeNull();
    expect(roadKindOf("well")).toBeNull();
    const stone = toolInfo("dirt", { dirt: "stone", bridge: "bridge" });
    expect(stone.label).toBe("Дорога");
    expect(stone.purpose).toContain("Каменная");
    expect(stone.materials.length).toBe(1);
    expect(toolInfo("dirt", { dirt: "dirt", bridge: "bridge" }).materials.length).toBe(0);
    expect(toolInfo("bridge", { dirt: "dirt", bridge: "stonebridge" }).site).toContain("60");
    expect(toolLabel("bridge")).toBe("Мост");
  });
  it("offers stone as a material, not as tools", () => {
    expect(ROAD_MATERIALS.dirt.map((m) => m.id)).toEqual(["dirt", "stone"]);
    expect(ROAD_MATERIALS.bridge.map((m) => m.id)).toEqual(["bridge", "stonebridge"]);
    expect(all).not.toContain("stone" as Tool);
    expect(all).not.toContain("stonebridge" as Tool);
  });
});
