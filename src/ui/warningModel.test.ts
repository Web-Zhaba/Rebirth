import { describe, expect, it } from "vitest";
import { freshWarnings, governmentWarning, serviceWarningText, warningAction } from "./warningModel";
import type { GovView } from "../sim/government";

describe("warning transitions", () => {
  it("shows only newly appeared problems", () => {
    expect(freshWarnings(new Set(["lowfood"]), [{ id: "lowfood", text: "same" }, { id: "nologs", text: "new" }])).toEqual([
      { id: "nologs", text: "new" },
    ]);
  });

  it("can notify again after a problem resolved and reappeared", () => {
    expect(freshWarnings(new Set(["nologs"]), [])).toEqual([]);
    expect(freshWarnings(new Set(), [{ id: "nologs", text: "again" }])).toEqual([{ id: "nologs", text: "again" }]);
  });

  it("routes economy and service warnings to their useful target", () => {
    expect(warningAction("famine")).toBe("town");
    expect(warningAction("service:well")).toEqual({ overlay: "well" });
    expect(warningAction("service:bogus")).toBeNull();
    expect(warningAction("weather")).toBeNull();
  });

  it("formats Russian house counts", () => {
    expect(serviceWarningText("Вода", 1)).toBe("1 дом без услуги «Вода»");
    expect(serviceWarningText("Вода", 3)).toBe("3 дома без услуги «Вода»");
    expect(serviceWarningText("Вода", 11)).toBe("11 домов без услуги «Вода»");
    expect(serviceWarningText("Вода", 22)).toBe("22 дома без услуги «Вода»");
  });
});

describe("government warnings", () => {
  const gov = { head: 1, last: null, headSince: 120 };
  const candidate: GovView["choice"]["people"][number] = { id: 2, name: "Alex", sex: "m", age: 30, parts: [], effect: { mood: 0, manage: 0, attract: 0, work: 0 } };
  const republic: Pick<GovView, "settled" | "form" | "terms" | "choice"> = { settled: true, form: "republic", terms: 1, choice: { kind: "open", people: [candidate] } };

  it("shows an election warning only after expiry and with candidates", () => {
    expect(governmentWarning(gov, republic)).toBeNull();
    const expired = { ...republic, terms: 2 };
    expect(governmentWarning(gov, expired)).toEqual({ kind: "election" });
    expect(governmentWarning(gov, { ...expired, choice: { ...expired.choice, people: [] } })).toBeNull();
  });

  it("tracks an available heir by the outgoing reign, including when the head dies", () => {
    const monarchy = { ...republic, form: "monarchy", choice: { ...republic.choice, kind: "heir" } } as const;
    expect(governmentWarning(gov, monarchy)).toEqual({ kind: "heir", reign: "1:120" });
    expect(governmentWarning({ ...gov, head: null, last: 1 }, monarchy)).toEqual({ kind: "heir", reign: "1:120" });
    expect(governmentWarning({ ...gov, head: 2 }, monarchy)).toEqual({ kind: "heir", reign: "2:120" });
    expect(governmentWarning(gov, { ...monarchy, choice: republic.choice })).toBeNull();
    expect(governmentWarning(gov, { ...monarchy, settled: false })).toBeNull();
  });
});
