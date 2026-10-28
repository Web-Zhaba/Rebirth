import { describe, expect, it } from "vitest";
import { hasHotkey, HOTKEY_SECTIONS } from "./hotkeysModel";

describe("hotkeys model", () => {
  it("documents screenshot mode", () => {
    expect(hasHotkey("F10")).toBe(true);
    expect(HOTKEY_SECTIONS.flatMap((s) => s.rows).find((r) => r.keys.includes("F10"))?.desc).toContain("HUD");
  });

  it("keeps the main navigation shortcuts documented", () => {
    expect(hasHotkey("N")).toBe(true);
    expect(hasHotkey("?")).toBe(true);
  });
});
