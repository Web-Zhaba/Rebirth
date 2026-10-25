import { describe, expect, it } from "vitest";
import { rewardParts } from "./goalsModel";

describe("rewardParts", () => {
  it("splits a reward line and picks icons", () => {
    expect(rewardParts("пильня, амбар")).toEqual([
      { text: "пильня", icon: "sawpit" },
      { text: "амбар", icon: "barn" },
    ]);
  });
  it("falls back to a flag", () => {
    expect(rewardParts("что-то новое")[0].icon).toBe("flag");
  });
});
