import { describe, expect, it } from "vitest";
import { tabId, tabPanelId } from "./tabSemantics";

describe("tab semantics ids", () => {
  it("pairs tabs with stable panel ids", () => {
    expect(tabId("town", "people")).toBe("town-tab-people");
    expect(tabPanelId("town", "people")).toBe("town-panel-people");
  });

  it("keeps distinct tab groups isolated", () => {
    expect(tabId("build", "roads")).not.toBe(tabId("notebook", "roads"));
    expect(tabPanelId("build", "roads")).not.toBe(tabPanelId("notebook", "roads"));
  });
});
