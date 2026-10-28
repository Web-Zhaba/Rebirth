import { describe, expect, it } from "vitest";
import { researchStatusView } from "./researchStatusModel";

describe("research status", () => {
  it("shows active progress and the next queued technology", () => {
    expect(researchStatusView("Письменность", 0.437, ["Ирригация"])).toEqual({
      title: "Исследуется: Письменность, 43 %",
      next: "Далее: Ирригация",
      progress: 0.437,
      idle: false,
    });
  });

  it("has a useful empty state", () => {
    expect(researchStatusView(null, null, [])).toEqual({
      title: "Наука простаивает — выберите технологию",
      next: null,
      progress: null,
      idle: true,
    });
  });

  it("shows a waiting queue while idle", () => {
    expect(researchStatusView(null, null, ["Ирригация"]).next).toBe("В очереди: Ирригация");
  });

  it("clamps display progress", () => {
    expect(researchStatusView("A", 1.4, []).progress).toBe(1);
    expect(researchStatusView("A", -0.1, []).progress).toBe(0);
  });
});
