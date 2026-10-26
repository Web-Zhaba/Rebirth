import { describe, expect, it } from "vitest";
import type { EconomyStats } from "../sim/types";
import { emptyWeather, type WeatherState } from "../sim/weather";
import { buildFactorText, effectLines, weatherChip, weatherImpact, weatherReason, weatherWarning, workFactorText } from "./weatherModel";

const site = { lat: 50, lng: 14, elev: 200, seed: 1, phase: 0 };

const ws = (o: Partial<WeatherState> = {}, now: Partial<WeatherState["now"]> = {}): WeatherState => ({
  ...emptyWeather(),
  site,
  now: { temp: 12, cloud: 0.2, precip: 0, snow: false, wind: 3, ...now },
  ...o,
});

// Only the fields the model reads; the rest of EconomyStats is irrelevant to these words.
const eco = (o: Partial<EconomyStats> = {}): EconomyStats =>
  ({
    fields: { count: 0, ha: 0, assignedHa: 0, sown: 0, reaped: 0, expected: 0, window: null },
    firewood: 0,
    unheated: { households: 0, people: 0 },
    ...o,
  }) as EconomyStats;

describe("weatherReason", () => {
  it("is silent on a mild clear day", () => {
    expect(weatherReason(ws())).toBeNull();
    expect(weatherReason(ws({ site: null }))).toBeNull();
  });
  it("names the strongest blocker first", () => {
    expect(weatherReason(ws({ snowpack: 0.2 }, { precip: 1, snow: true, temp: -4 }))).toBe("снег на земле");
    expect(weatherReason(ws({ frozen: 0.8 }, { temp: -3 }))).toBe("земля промёрзла");
    expect(weatherReason(ws({ ice: 0.8 }, { temp: -3 }))).toBe("вода подо льдом");
    expect(weatherReason(ws({}, { precip: 0.5 }))).toBe("дождь");
    expect(weatherReason(ws({}, { precip: 1.5 }))).toBe("ливень");
    expect(weatherReason(ws({}, { wind: 15 }))).toBe("буря");
    expect(weatherReason(ws({ soil: 0.97 }))).toBe("распутица");
    expect(weatherReason(ws({ soil: 0.1 }))).toBe("засуха");
    expect(weatherReason(ws({}, { temp: 35 }))).toBe("жара");
    expect(weatherReason(ws({}, { temp: -16 }))).toBe("мороз");
    expect(weatherReason(ws({}, { temp: 2 }))).toBe("оттепель");
  });
});

describe("effectLines", () => {
  it("always shows the field and build factors", () => {
    const lines = effectLines(ws());
    expect(lines.map((l) => l.key)).toEqual(["field", "build"]);
    expect(lines[0].value).toBe("100 %");
    expect(lines[0].tone).toBe("ok");
  });
  it("marks rain as a warning and adds fuel and food only when they bite", () => {
    const lines = effectLines(ws({}, { precip: 0.5, wind: 3 }), eco({ firewood: 0.8, unheated: { households: 1, people: 2 } }));
    const by = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(by.field.value).toBe("60 %");
    expect(by.field.tone).toBe("warn");
    expect(by.build.tone).toBe("warn");
    expect(by.wood.value).toBe("0,8 м³ в день");
    expect(by.cold.tone).toBe("bad");
  });
  it("shows the extra food need in the cold", () => {
    const lines = effectLines(ws({ yesterday: { min: -10, max: -5, rain: 0 } }));
    const food = lines.find((l) => l.key === "food");
    expect(food?.value).toBe("+18 %");
    expect(food?.tone).toBe("warn");
  });
});

describe("weatherImpact", () => {
  it("ignores winter fields without a field window", () => {
    expect(weatherImpact(ws({ frozen: 0.8 }, { temp: -10 }))).toBeNull();
  });
  it("warns when a field window is open and the work is slow", () => {
    expect(weatherImpact(ws({}, { precip: 0.5 }), eco({ fields: { ...eco().fields, window: "sowing" } }))).toBe("warn");
  });
  it("is bad without firewood", () => {
    expect(weatherImpact(ws(), eco({ unheated: { households: 2, people: 5 } }))).toBe("bad");
  });
});

describe("weatherWarning", () => {
  it("is silent on a good day", () => {
    expect(weatherWarning(ws())).toBeNull();
  });
  it("says what the rain cuts", () => {
    expect(weatherWarning(ws({}, { precip: 0.5 }), eco())).toBe("Дождь: стройка 60 %");
  });
  it("puts fuel first", () => {
    expect(weatherWarning(ws(), eco({ unheated: { households: 1, people: 2 } }))).toBe("Нет дров: мёрзнут 2 чел.");
  });
});

describe("per-building lines", () => {
  it("a gumno stops on snow", () => {
    const t = workFactorText("gumno", ws({ snowpack: 0.2 }, { temp: -3, snow: true, precip: 0.5 }));
    expect(t).toEqual({ pct: 0, reason: "снег на земле" });
  });
  it("a slowed workplace names the reason, a full one has no line", () => {
    expect(workFactorText("sawpit", ws({}, { temp: 10, precip: 0.5 }))).toEqual({ pct: 90, reason: "дождь" });
    expect(workFactorText("sawpit", ws())).toBeNull();
  });
  it("a site under construction shows the artel factor", () => {
    expect(buildFactorText(ws({}, { precip: 0.5 }))).toEqual({ pct: 60, reason: "дождь" });
    expect(buildFactorText(ws())).toBeNull();
  });
});

describe("weatherChip", () => {
  it("carries the effects and the impact marker", () => {
    const c = weatherChip(ws({}, { precip: 0.5 }), 1, eco({ fields: { ...eco().fields, window: "sowing" } }))!;
    expect(c.impact).toBe("warn");
    expect(c.effects.map((e) => e.key)).toEqual(["field", "build"]);
  });
  it("has no marker on a calm day", () => {
    expect(weatherChip(ws(), 1, eco())!.impact).toBeNull();
  });
});