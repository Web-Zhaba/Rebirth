import { describe, expect, it } from "vitest";
import { screenshotKey } from "./screenshotModel";

describe("screenshot mode keys", () => {
  it("toggles with F10", () => {
    expect(screenshotKey(false, "F10")).toBe(true);
    expect(screenshotKey(true, "F10")).toBe(false);
  });

  it("Escape exits only while screenshot mode is active", () => {
    expect(screenshotKey(true, "Escape")).toBe(false);
    expect(screenshotKey(false, "Escape")).toBeNull();
    expect(screenshotKey(true, "A")).toBeNull();
  });
});
