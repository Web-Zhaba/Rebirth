import { describe, expect, it } from "vitest";
import { emptyGrowth } from "../sim/growth";
import { addRoad, emptyRoads } from "../sim/roads";
import { allResearched, initialProgress } from "../sim/tech";
import type { FoundFoundation, SimState, StoredArticle } from "../sim/types";
import { emptyZones } from "../sim/zones";
import { articleFor, buildHeritageView, speedGain } from "./heritageModel";

type Pt = [number, number];
const ring: Pt[] = [[0, 0], [20, 0], [20, 30], [0, 30]];
const site = (extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id: "a", ring, area: 600, digId: 1, at: 0, cls: "place_of_worship", name: "Церковь Покрова", ...extra });

const road = () => {
  const r = addRoad(emptyRoads(), [[-100, 40], [100, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};
const sim = (f: FoundFoundation, progress = initialProgress(), roads = road()) =>
  ({ ...emptyGrowth(1), roads, zones: emptyZones(), progress, finds: { foundations: [f], pois: [], streets: [], revealed: [] } }) as unknown as Parameters<typeof buildHeritageView>[0]["sim"];
const article = (title: string): StoredArticle => ({ id: "ru:1", title, extract: "", url: "https://ru.wikipedia.org/wiki/X", lang: "ru", lat: 0, lng: 0, at: 0 });

describe("heritage view", () => {
  it("describes the site and its restoration as it was", () => {
    const f = site({ height: 11 });
    const v = buildHeritageView({ site: f, sim: sim(f, { ...initialProgress(), techs: ["faith"] }), mul: 2, articles: [] });
    expect(v).toMatchObject({ title: "Церковь Покрова", kind: "Культовое здание", domain: "care", domainName: "Вера и здоровье", area: 600, height: 11, floors: 3, state: null, canOrder: true, note: null, template: "chapel", purpose: "Храм" });
    const k = Math.round((600 / 84) * 100) / 100 * 3; // every old floor at once
    expect(v.cost.labor).toBe(Math.round(180 * k));
    expect(v.research).toBe("+10 % к скорости: Вера и здоровье");
    expect(v.effects).toContain("Работает как «Храм»");
    expect(v.insight).toBe("«Травник»: «Врачевание» изучается быстрее на 30 %"); // «Свод» is used up: its tech is researched
  });
  it("closes a purpose whose technology is not researched; a kind without one comes back as a monument", () => {
    const f = site();
    const v = buildHeritageView({ site: f, sim: sim(f), mul: 1, articles: [] });
    expect(v.canOrder).toBe(false);
    expect(v.note).toContain("Назначение закрыто");
    const castle = site({ cls: "castle" });
    const c = buildHeritageView({ site: castle, sim: sim(castle), mul: 1, articles: [] });
    expect(c).toMatchObject({ template: "restored", purpose: "Памятник", canOrder: true });
    expect(c.effects[0]).toBe("Без жителей и рабочих мест");
  });
  it("names a missing road and a settled state", () => {
    const f = site();
    const far = buildHeritageView({ site: f, sim: sim(f, allResearched(), emptyRoads()), mul: 1, articles: [] });
    expect(far.canOrder).toBe(false);
    expect(far.note).toBe("Нужна построенная дорога рядом");
    const done = site({ state: "restored" });
    const d = buildHeritageView({ site: done, sim: sim(done), mul: 1, articles: [] });
    expect(d).toMatchObject({ state: "restored", stateText: "Восстановлена", canOrder: false });
    expect(buildHeritageView({ site: site({ state: "lost" }), sim: sim(site({ state: "lost" })), mul: 1, articles: [] }).stateText).toBe("Утрачена");
  });
  it("has a nameless site titled by its kind, and a site not yet recorded closed", () => {
    const f = site({ name: undefined });
    expect(buildHeritageView({ site: f, sim: sim(f), mul: 1, articles: [] }).title).toBe("Культовое здание");
    const other = sim(site({ id: "b" }));
    expect(buildHeritageView({ site: f, sim: other, mul: 1, articles: [] }).canOrder).toBe(false);
  });
  it("halves a further site of a kind already ordered or restored, with no new idea", () => {
    const done = site({ id: "x", cls: "castle", state: "restored" });
    const next = site({ cls: "castle" });
    const s = { ...sim(done, allResearched()), finds: { foundations: [done, next], pois: [], streets: [], revealed: [] } } as unknown as Parameters<typeof buildHeritageView>[0]["sim"];
    const v = buildHeritageView({ site: next, sim: s, mul: 1, articles: [] });
    expect(v.repeat).toEqual({ kind: "Замок", factor: 0.5 });
    expect(v.research).toBe("+2,5 % к скорости: Строительство");
    expect(v.insight).toBeNull();
    const lost = { ...done, state: "lost" as const };
    const free = buildHeritageView({ site: next, sim: { ...s, finds: { ...s.finds, foundations: [lost, next] } }, mul: 1, articles: [] });
    expect(free.repeat).toBeNull();
    expect(free.research).toBe("+5 % к скорости: Строительство");
  });
  it("counts the research cap", () => {
    expect(speedGain(0, 1)).toBeCloseTo(5);
    expect(speedGain(9.5, 3)).toBeCloseTo(2.5);
    expect(speedGain(10, 3)).toBe(0);
  });
  it("links the article whose title is the name", () => {
    expect(articleFor("Церковь Покрова", [article("церковь покрова")])).toEqual({ title: "церковь покрова", url: "https://ru.wikipedia.org/wiki/X" });
    expect(articleFor("Церковь Покрова", [article("Другая")])).toBeNull();
    expect(articleFor(undefined, [article("Другая")])).toBeNull();
  });
});
