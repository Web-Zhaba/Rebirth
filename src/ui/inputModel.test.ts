import { describe, expect, it } from "vitest";
import { cancelUiState, shouldRepeatTool } from "./inputModel";

describe("global input model", () => {
  it("clears the whole non-modal UI on Escape", () => {
    expect(cancelUiState({ tool: "well", rightPanel: "inspector", building: 7, clearing: 3, site: "osm:1" }, false)).toEqual({
      tool: null,
      rightPanel: null,
      building: null,
      clearing: null,
      site: null,
    });
  });

  it("leaves the map UI alone while a dialog owns Escape", () => {
    const state = { tool: "well", rightPanel: "inspector", building: 7, clearing: 3, site: "osm:1" };
    expect(cancelUiState(state, true)).toBe(state);
  });

  it("repeats the last tool only from an idle middle click", () => {
    expect(shouldRepeatTool(1, null, "well")).toBe(true);
    expect(shouldRepeatTool(0, null, "well")).toBe(false);
    expect(shouldRepeatTool(1, "well", "market")).toBe(false);
    expect(shouldRepeatTool(1, null, null)).toBe(false);
  });
});
