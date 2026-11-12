import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { attractionOf } from "./attraction";
import { BUILDINGS, scaledJobs } from "./buildings";
import { orderDig } from "./digging";
import { recordFinds } from "./excavation";
import { canPlaceOnFoundation, emptyGrowth, placeOnFoundation } from "./growth";
import { catalogue, FIND, foundIds, realName, returnFind, useFind } from "./items";
import { arrangeExhibitions, exhibitionEffects, halls, hallsOf, MUSEUM, museumDaily, museumStaff, quality, setExhibition, themes } from "./museum";
import { researchSpeed } from "./research";
import { addRoad, emptyRoads } from "./roads";
import { allResearched, fieldYieldMul } from "./tech";
import type { FoundFeature, FoundFoundation, FoundPlace, RoadGraph, SimState } from "./types";
import { emptyZones } from "./zones";
import { placesView } from "../ui/placesModel";
import { findsView } from "../ui/findsModel";
import { museumView } from "../ui/museumModel";

// Finds and the museum (docs/PLAN-restoration.md section 6).

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
const fnd = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ...extra });
const poi = (id: string, name: string, kind: string, x: number, y: number): FoundPlace => ({ id, name, kind, digId: 1, at: 0, x, y });
const feat = (id: string, kind: FoundFeature["kind"], x: number, y: number, extra: Partial<FoundFeature> = {}): FoundFeature => ({ id, kind, x, y, digId: 1, ...extra });

const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-300, 40], [300, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const street: FoundPlace = { id: "st", name: "Садовая", kind: "street", digId: 1, at: 0, lines: [[[-250, 40], [250, 40]]] };
const mk = (foundations: FoundFoundation[], pois: FoundPlace[] = [], features: FoundFeature[] = [], extra: Partial<SimState> = {}): SimState =>
  ({
    realTime: 0,
    gameMinutes: 1000,
    roads: builtRoad(),
    zones: emptyZones(),
    ...emptyGrowth(1),
    progress: allResearched(),
    articles: [],
    finds: { foundations, pois, streets: [street], revealed: [{ digId: 1, x: 0, y: 40, r: 200 }], features, fates: {} },
    ...extra,
  }) as SimState;

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error((r as unknown as { reason: string }).reason);
  return r as Extract<T, { ok: true }>;
};
const put = (s: SimState, id: string, template: string): SimState => {
  const c = canPlaceOnFoundation(s, BUILDINGS[template], id);
  if (!c.ok) throw new Error(c.reason);
  return placeOnFoundation(s, BUILDINGS[template], id);
};

describe("the catalogue", () => {
  it("one find per real feature: a sign or the typical object of a named place, a street sign, seeds, parts, rails, a bucket, a page", () => {
    const post = fnd("post", rect(0, 46, 10, 10), { cls: "shop", name: "Почта" });
    const s = mk(
      [post],
      [poi("p1", "Почта «Бабушкино»", "post", 5, 50), poi("p2", "Лавка Петрова", "shop", 100, 50)],
      [feat("g", "seeds", 20, 80), feat("i", "parts", 30, 80), feat("r", "rails", 40, 80), feat("w", "bucket", 50, 80), feat("n", "number", 5, 50, { name: "12" }), feat("far", "sign", 600, 40, { name: "Школа", cls: "school" })],
      { articles: [{ id: "ru:1", title: "Почта", extract: "", url: "", lang: "ru", lat: 0, lng: 0, at: 0 }] },
    );
    const items = catalogue(s);
    const by = (id: string) => items.find((i) => i.id === id)!;
    expect(by("obj:p1")).toMatchObject({ kind: "object", name: "Почтовый штемпель отделения «Почта «Бабушкино»»", place: "post", theme: "place:post", source: "OSM" });
    expect(by("sign:p2")).toMatchObject({ kind: "sign", name: "Вывеска «Лавка Петрова»", theme: "street:Садовая" });
    expect(by("street:st")).toMatchObject({ kind: "street", street: "st", theme: "street:Садовая" });
    expect(by("feat:g")).toMatchObject({ kind: "seeds", theme: "gardens", usable: true });
    expect(by("feat:i")).toMatchObject({ kind: "parts", theme: "crafts", usable: true });
    expect(by("feat:r")).toMatchObject({ kind: "rails", theme: "railway", usable: true });
    expect(by("feat:w")).toMatchObject({ kind: "bucket", usable: false });
    expect(by("obj:far")).toMatchObject({ kind: "object", name: "Школьный колокольчик «Школа»" });
    expect(by("page:ru:1")).toMatchObject({ kind: "page", place: "post", source: "Wikipedia" });
    expect(items.some((i) => i.id.includes(":n"))).toBe(false); // house numbers are counted per street, not kept
    expect(catalogue(s)).toBe(items); // memoised
  });
  it("a find is found once a dug foundation lies within reach, or its own foundation is dug; finds lead beyond the survey", () => {
    const ghost = fnd("h", rect(0, 46, 10, 10), { ghost: true });
    const s0 = mk([ghost], [], [feat("near", "seeds", 40, 60), feat("far", "seeds", 500, 60), feat("beyond", "sign", 30, 300, { name: "Школа", cls: "school" })]);
    expect(foundIds(s0).size).toBe(0); // an outline finds nothing
    const s1 = finishAll(ok(orderDig(s0, "h")).sim);
    const found = foundIds(s1);
    expect(found.has("feat:near")).toBe(true);
    expect(found.has("feat:far")).toBe(false);
    expect(found.has("street:st")).toBe(true); // the street runs within reach
    const ev = s1.events.map((e) => e.text);
    expect(ev.some((t) => t.startsWith("Находки:"))).toBe(true);
    expect(FIND.reach).toBe(60);
    // the school's bell, found: it lies beyond the revealed disc
    const s2 = finishAll(ok(orderDig({ ...s1, finds: { ...s1.finds, foundations: [...s1.finds.foundations, fnd("h2", rect(25, 250, 10, 10), { ghost: true })], revealed: [{ digId: 1, x: 0, y: 40, r: 230 }] } }, "h2")).sim);
    expect(s2.events.some((e) => e.text === "Школьный колокольчик «Школа» указывает на место за раскопом")).toBe(true);
  });
});

describe("fates", () => {
  const shop = fnd("s", rect(0, 46, 10, 10), { cls: "pharmacy", name: "Аптека" });
  const withSign = () => mk([shop], [poi("p", "Аптека №1", "shop", 5, 50)]);
  it("a sign returns to its place once a building stands on its foundation; a typical one as it was then counts in full", () => {
    let s = withSign();
    expect(returnFind(s, "sign:p")).toEqual({ ok: false, reason: "Сначала поставьте здание на её фундамент" });
    s = finishAll(put(s, "s", "healer"));
    const weight = s.buildings[1].restoreWeight!;
    const care = s.progress.restored.care!;
    expect(realName(s, s.buildings[1])).toBe("Аптека"); // as it was: its name already
    const r = ok(returnFind(s, "sign:p")).sim;
    expect(r.finds.fates["sign:p"]).toBe("returned");
    expect(r.buildings[1].restoreWeight).toBeCloseTo(weight * 4, 2);
    expect(r.progress.restored.care).toBeCloseTo(care - weight + weight * 4, 2);
    expect(returnFind(r, "sign:p")).toEqual({ ok: false, reason: "С этой находкой уже решено" });
  });
  it("another purpose gets the real name back with its sign", () => {
    const s = finishAll(put(withSign(), "s", "barn"));
    expect(realName(s, s.buildings[1])).toBeNull();
    const r = ok(returnFind(s, "sign:p")).sim;
    expect(realName(r, r.buildings[1])).toBe("Аптека");
  });
  it("seeds raise the yield, parts feed craft research, rails become tools and are gone", () => {
    const s = finishAll(put(mk([fnd("h", rect(0, 46, 10, 10))], [], [feat("g", "seeds", 10, 60), feat("i", "parts", 15, 60), feat("r", "rails", 20, 60)]), "h", "barn"));
    const y0 = fieldYieldMul(s.progress);
    const a = ok(useFind(s, "feat:g")).sim;
    expect(fieldYieldMul(a.progress)).toBeCloseTo(y0 + 0.02, 9);
    const b = ok(useFind(a, "feat:i")).sim;
    expect(b.progress.restored.craft ?? 0).toBeCloseTo((a.progress.restored.craft ?? 0) + FIND.partsWeight, 9);
    const c = ok(useFind(b, "feat:r")).sim;
    expect(c.stock.tools).toBe(b.stock.tools + FIND.railTools);
    expect(useFind(c, "street:st")).toEqual({ ok: false, reason: "Эту находку не пустить в дело" });
    expect(useFind(c, "feat:nope")).toEqual({ ok: false, reason: "Нет такой находки" });
    expect(findsView(c).find((g) => g.theme === "railway")!.rows[0]).toMatchObject({ fate: "used", usable: false });
  });
});

describe("the museum", () => {
  const big = fnd("m", rect(0, 46, 20, 15)); // 300 m2: three halls
  const town = () => {
    const feats = [feat("g1", "seeds", 10, 70), feat("g2", "seeds", 12, 72), feat("g3", "seeds", 14, 74), feat("i", "parts", 16, 70)];
    return finishAll(put(mk([big], [], feats), "m", "museum"));
  };
  it("stands only on an old foundation and has halls by floor area", () => {
    const s = town();
    const b = s.buildings[1];
    expect(b.template).toBe("museum");
    expect(hallsOf(b)).toBe(3);
    expect(halls(s)).toHaveLength(3);
  });
  // the museum's jobs filled by residents working there
  const staffed = (s: SimState, n: number): SimState => ({ ...s, residents: Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, { id: i + 1, job: 1 }])) as unknown as SimState["residents"] });
  const jobs = (s: SimState) => scaledJobs(BUILDINGS.museum.jobs, s.buildings[1]);
  it("shows one theme a hall; a complete exhibition gives research and attraction", () => {
    let s = town();
    expect(themes(s).map((t) => [t.key, t.shown.length, t.complete])).toEqual([
      ["gardens", 3, true],
      ["crafts", 1, false],
      ["street:Садовая", 1, false],
    ]);
    s = ok(setExhibition(s, 1, 0, "gardens")).sim;
    expect(setExhibition(s, 1, 1, "gardens")).toEqual({ ok: false, reason: "Эта тема уже в другом зале" });
    expect(setExhibition(s, 1, 9, "crafts")).toEqual({ ok: false, reason: "Нет такого зала" });
    expect(setExhibition(s, 1, 1, "nope")).toEqual({ ok: false, reason: "Для этой темы нет находок" });
    s = staffed(ok(setExhibition(s, 1, 1, "crafts")).sim, jobs(s));
    expect(museumStaff(s)).toEqual({ 1: 1 });
    expect(exhibitionEffects(s, museumStaff(s))).toEqual({ exhibits: { farm: MUSEUM.research }, pull: MUSEUM.pull });
    const d = museumDaily(s);
    expect(d.progress.exhibits).toEqual({ farm: MUSEUM.research });
    expect(researchSpeed(d, "farm")).toBeGreaterThan(researchSpeed(s, "farm"));
    const base = { food: 1, mood: 60, unemployment: 0, services: 0.5, pop: 50 };
    expect(attractionOf({ ...base, museum: d.progress.museumPull }).score).toBeGreaterThan(attractionOf(base).score);
    // a seed put to use leaves the exhibition: the theme is still complete with what is left, if enough
    const used = museumDaily(ok(useFind(d, "feat:g1")).sim);
    expect(used.progress.exhibits).toBeUndefined(); // two seeds left: fewer than MUSEUM.min
    expect(ok(setExhibition(d, 1, 0, null)).sim.buildings[1].exhibits).toEqual([null, "crafts", null]);
  });
  it("works by the share of its staff; an exhibition short of a few finds gives a part", () => {
    let s = ok(setExhibition(town(), 1, 0, "gardens")).sim;
    expect(exhibitionEffects(s, museumStaff(s)).pull).toBe(0); // nobody at work
    const n = jobs(s);
    s = staffed(s, Math.ceil(n / 2));
    expect(exhibitionEffects(s, museumStaff(s)).exhibits.farm).toBeCloseTo(MUSEUM.research * museumStaff(s)[1], 1);
    expect(quality({ shown: [{}, {}, {}] as never, showable: 4, complete: false })).toBe(Math.round(MUSEUM.partial * 0.75 * 100) / 100);
    expect(quality({ shown: [{}, {}] as never, showable: 4, complete: false })).toBe(0);
  });
  it("the window: halls, themes by group, a showcase with the empty places, what it gives", () => {
    const far = finishAll(put(mk([big], [], [feat("g1", "seeds", 10, 70), feat("g2", "seeds", 12, 72), feat("g3", "seeds", 14, 74), feat("g4", "seeds", 150, 60), feat("i", "parts", 16, 70)]), "m", "museum"));
    let s = staffed(ok(setExhibition(far, 1, 0, "gardens")).sim, jobs(far));
    const v = museumView({ ...s, museumStaff: museumStaff(s) });
    expect(v.museums[0].halls.map((h) => h.theme)).toEqual(["gardens", null, null]);
    const g = v.themes.find((t) => t.key === "gardens")!;
    expect([g.group, g.shown, g.showable, g.unfound, g.complete]).toEqual(["hall", 3, 4, 1, false]);
    expect(g.items.map((i) => i.state)).toEqual(["shown", "shown", "shown", "unfound"]);
    expect(g.items[3].name).toBeNull();
    expect(g.items[0]).toMatchObject({ canUse: true, breaks: true }); // two left: under the minimum
    expect(v.themes.find((t) => t.key === "crafts")!.group).toBe("few");
    expect(v.effects.research).toEqual([{ domain: "farm", name: expect.any(String), pct: expect.any(Number) }]);
    expect(v.effects.pullPct).toBeGreaterThan(0);
    s = ok(setExhibition(s, 1, 0, null)).sim;
    expect(museumView({ ...s, museumStaff: museumStaff(s) }).themes.find((t) => t.key === "gardens")!.group).toBe("partial");
  });
  it("arranges the themes worth most into the halls", () => {
    const s = ok(arrangeExhibitions(town())).sim;
    expect(s.buildings[1].exhibits).toEqual(["gardens", "crafts", "street:Садовая"]);
  });
});

describe("records and counters", () => {
  it("the dig records features once each and rejects broken ones", () => {
    const s = mk([]);
    const r1 = ok(recordFinds(s, { digId: 1, foundations: [], pois: [], streets: [], features: [{ id: "a", kind: "seeds", x: 1, y: 2 }] })).sim;
    expect(r1.finds.features).toEqual([{ id: "a", kind: "seeds", x: 1, y: 2, digId: 1 }]);
    expect(recordFinds(r1, { digId: 1, foundations: [], pois: [], streets: [], features: [{ id: "a", kind: "seeds", x: 1, y: 2 }] })).toEqual({ ok: true, sim: r1 });
    expect(recordFinds(s, { digId: 1, foundations: [], pois: [], streets: [], features: [{ id: "b", kind: "gold" as "seeds", x: 1, y: 2 }] }).ok).toBe(false);
  });
  it("a street counts its house numbers found in dug houses and its household", () => {
    const a = fnd("a", rect(0, 46, 10, 10));
    const b = fnd("b", rect(40, 46, 10, 10), { ghost: true });
    const s = mk([a, b], [], [feat("n1", "number", 5, 50, { name: "1" }), feat("n2", "number", 45, 50, { name: "3" })]);
    const row = placesView(s).streets.find((t) => t.id === "st")!;
    expect(row.numbers).toEqual({ found: 1, total: 2 });
    expect(row.household).toEqual({ found: 1, total: 2 });
  });
});
