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
  ({ ...emptyGrowth(1), roads, zones: emptyZones(), progress, finds: { foundations: [f], pois: [], streets: [], revealed: [] } }) as unknown as Pick<SimState, "finds" | "buildings" | "roads" | "progress">;
const article = (title: string): StoredArticle => ({ id: "ru:1", title, extract: "", url: "https://ru.wikipedia.org/wiki/X", lang: "ru", lat: 0, lng: 0, at: 0 });

describe("heritage view", () => {
  it("describes the site and its two modes", () => {
    const f = site({ height: 12 });
    const v = buildHeritageView({ site: f, sim: sim(f, { ...initialProgress(), techs: ["faith"] }), mul: 2, articles: [] });
    expect(v).toMatchObject({ title: "Церковь Покрова", kind: "Культовое здание", domain: "care", domainName: "Вера и здоровье", area: 600, height: 12, state: null, canOrder: true });
    expect(v.cost).toEqual({ labor: 340, logs: 30, planks: 15, stone: 20 });
    const [mon, work] = v.options;
    expect(mon).toMatchObject({ mode: "monument", label: "Памятник", available: true, research: "+10 % к скорости: Вера и здоровье" });
    expect(work).toMatchObject({ mode: "working", label: "В деле", available: true, research: "+5 % к скорости: Вера и здоровье" });
    expect(work.effects).toContain("Работает как «Храм»");
    expect(mon.effects[0]).toBe("Без рабочих мест");
    expect(mon.insight).toBe("«Травник»: «Врачевание» изучается быстрее на 30 %"); // «Свод» is used up: its tech is researched
  });
  it("closes the working mode with the reason", () => {
    const f = site();
    const v = buildHeritageView({ site: f, sim: sim(f), mul: 1, articles: [] });
    expect(v.options[1].available).toBe(false);
    expect(v.options[1].why).toContain("Назначение закрыто");
    expect(v.options[0].available).toBe(true);
    const castle = site({ cls: "castle" });
    const c = buildHeritageView({ site: castle, sim: sim(castle, allResearched()), mul: 1, articles: [] });
    expect(c.options[1]).toMatchObject({ available: false, why: "Эту постройку можно только сохранить как памятник" });
  });
  it("names a missing road and a settled state", () => {
    const f = site();
    const far = buildHeritageView({ site: f, sim: sim(f, initialProgress(), emptyRoads()), mul: 1, articles: [] });
    expect(far.canOrder).toBe(false);
    expect(far.note).toBe("Нужна дорога");
    const done = site({ state: "restored" });
    const d = buildHeritageView({ site: done, sim: sim(done), mul: 1, articles: [] });
    expect(d).toMatchObject({ state: "restored", stateText: "Восстановлена", canOrder: false, note: "Уже восстановлена" });
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
    const s = { ...sim(done, allResearched()), finds: { foundations: [done, next], pois: [], streets: [], revealed: [] } } as unknown as Pick<SimState, "finds" | "buildings" | "roads" | "progress">;
    const v = buildHeritageView({ site: next, sim: s, mul: 1, articles: [] });
    expect(v.repeat).toEqual({ kind: "Замок", factor: 0.5 });
    expect(v.options[0].research).toBe("+2,5 % к скорости: Строительство");
    expect(v.options[0].insight).toBeNull();
    const lost = { ...done, state: "lost" as const };
    const free = buildHeritageView({ site: next, sim: { ...s, finds: { ...s.finds, foundations: [lost, next] } }, mul: 1, articles: [] });
    expect(free.repeat).toBeNull();
    expect(free.options[0].research).toBe("+5 % к скорости: Строительство");
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
