import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { advanceBuildings, canPlace, emptyGrowth, placeBuilding, reconcile, spawnBuildings } from "./growth";
import { BUILDINGS } from "./buildings";
import { computeCoverage, computeLandValue } from "./coverage";
import { distinctTyped, earlierOfKind, heritageDomain, isHeritage, nextInsight, restoreCost, restoreWeightOf, scarcity, siteDomain, workTemplate } from "./heritage";
import { orientedBox, restoreBlocker, ringDoor, simplifyRing } from "./heritageGeo";
import { Handler, toSnapshot, type Storage } from "./handler";
import { parseSave } from "./save";
import { loseSite, restoreSite } from "./restore";
import { addRoad, emptyRoads } from "./roads";
import { covers } from "./services";
import { allResearched, initialProgress } from "./tech";
import { lotFront } from "./people";
import type { Building, City, FoundFoundation, ProgressState, RoadGraph, SaveV4, SimState } from "./types";
import { emptyZones, regenerateCells } from "./zones";
import type { FromWorker } from "./protocol";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;

const found = (id: string, cls: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, cls, name: `Объект ${id}`, ...extra });

// A road along y = 40, built.
const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  const g = r.graph;
  for (const e of Object.values(g.edges)) e.done = e.labor;
  return g;
};

const mk = (foundations: FoundFoundation[], progress: ProgressState = allResearched()): SimState => ({
  realTime: NOW,
  gameMinutes: 1000,
  roads: builtRoad(),
  zones: emptyZones(),
  ...emptyGrowth(1),
  progress,
  finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 0, r: 15 }] },
}) as SimState;

const church = found("a", "place_of_worship", rect(0, 0, 20, 30));
const order = (s: SimState, id: string, mode: "monument" | "working") => {
  const r = restoreSite(s, id, mode);
  if (!r.ok) throw new Error(r.reason);
  return r.sim;
};

describe("kind table", () => {
  it("maps working templates", () => {
    expect(workTemplate("place_of_worship")).toBe("chapel");
    expect(workTemplate("college")).toBe("school");
    expect(workTemplate("hospital")).toBe("healer");
    expect(workTemplate("marketplace")).toBe("market");
    expect(workTemplate("castle")).toBeNull();
    expect(heritageDomain("hospital")).toBe("care");
  });
  it("drops the trimmed kinds: no template, no longer typed unless already restoring or restored", () => {
    for (const k of ["pharmacy", "doctors", "mall", "car_repair", "bank", "department_store", "wholesale", "halt", "bus_station"]) {
      expect(workTemplate(k), k).toBeNull();
      expect(heritageDomain(k), k).toBeNull();
      expect(isHeritage({ cls: k }), k).toBe(false);
      expect(isHeritage({ cls: k, state: "lost" }), k).toBe(false);
      expect(isHeritage({ cls: k, state: "restoring" }), k).toBe(true);
      expect(isHeritage({ cls: k, state: "restored" }), k).toBe(true);
      expect(siteDomain(k), k).not.toBeNull();
    }
    expect(isHeritage({ cls: "castle" })).toBe(true);
    expect(restoreSite(mk([found("p", "pharmacy", rect(0, 0, 20, 30))]), "p", "monument")).toMatchObject({ ok: false });
  });
});

describe("geometry", () => {
  it("simplifies a big ring to at most 64 points, counter-clockwise", () => {
    const n = 300;
    const ring: Pt[] = Array.from({ length: n }, (_, i) => [50 * Math.cos((-i / n) * 2 * Math.PI), 50 * Math.sin((-i / n) * 2 * Math.PI)]); // clockwise
    const s = simplifyRing(ring);
    expect(s.length).toBeLessThanOrEqual(64);
    expect(area(s)).toBeGreaterThan(0.95 * area(ring));
    expect(s.reduce((a, p, i) => a + p[0] * s[(i + 1) % s.length][1] - s[(i + 1) % s.length][0] * p[1], 0)).toBeGreaterThan(0);
    expect(simplifyRing(rect(0, 0, 4, 4)).length).toBe(4);
  });
  it("finds the oriented box of a turned rectangle", () => {
    const a = Math.PI / 6;
    const c = (u: number, v: number): Pt => [100 + u * Math.cos(a) - v * Math.sin(a), 50 + u * Math.sin(a) + v * Math.cos(a)];
    const box = orientedBox([c(-15, -5), c(15, -5), c(15, 5), c(-15, 5)]);
    expect(box.cx).toBeCloseTo(100);
    expect(box.cy).toBeCloseTo(50);
    expect(box.w * box.d).toBeCloseTo(300);
    expect(Math.max(box.w, box.d)).toBeCloseTo(30);
  });
  it("puts the door on the ring side nearest to the road", () => {
    const d = ringDoor(rect(0, 0, 20, 30), builtRoad())!;
    expect(d.door[1]).toBeCloseTo(30);
    expect(d.dist).toBeCloseTo(10);
  });
});

describe("cost", () => {
  it("follows the area", () => {
    expect(restoreCost(600)).toEqual({ labor: 340, logs: 30, planks: 15, stone: 20 });
    expect(restoreCost(1)).toMatchObject({ labor: 60, logs: 2, planks: 0.5, stone: 1 });
    expect(restoreCost(1e6)).toMatchObject({ labor: 1200, logs: 120, planks: 60, stone: 80 });
  });
});

describe("restoreSite refusals", () => {
  const s = mk([church, found("c", "castle", rect(0, -50, 20, 20)), { ...found("p", "school", rect(60, 0, 10, 10)), cls: undefined }]);
  it("refuses what is not a typed foundation", () => {
    expect(restoreSite(s, "nope", "monument")).toMatchObject({ ok: false, reason: "Это не значимая постройка" });
    expect(restoreSite(s, "p", "monument")).toMatchObject({ ok: false });
    expect(restoreSite(s, "a", "x")).toMatchObject({ ok: false });
  });
  it("refuses a second order and a lost site", () => {
    const o = order(s, "a", "monument");
    expect(restoreSite(o, "a", "monument")).toMatchObject({ ok: false, reason: "Уже восстанавливается" });
    const done = finishAll(o);
    expect(restoreSite(done, "a", "working")).toMatchObject({ ok: false, reason: "Уже восстановлена" });
    const lost = loseSite({ ...done, buildings: {} }, Object.values(done.buildings)[0]);
    expect(restoreSite(lost, "a", "monument")).toMatchObject({ ok: false, reason: "Постройка утрачена, восстановить нельзя" });
  });
  it("allows working only for a mapped, unlocked kind", () => {
    expect(restoreSite(s, "c", "working")).toMatchObject({ ok: false });
    const locked = mk([church], initialProgress());
    expect(restoreSite(locked, "a", "working")).toMatchObject({ ok: false });
    expect(restoreSite(locked, "a", "monument").ok).toBe(true);
    expect((restoreBlocker(locked, "a", "working") ?? "").startsWith("Назначение закрыто")).toBe(true);
  });
  it("needs a road within 30 m and no building on the ring", () => {
    const far = mk([found("f", "castle", rect(0, -100, 20, 20))]);
    expect(restoreSite(far, "f", "monument")).toMatchObject({ ok: false, reason: "Нужна дорога" });
    const noRoad = { ...mk([church]), roads: emptyRoads() };
    expect(restoreSite(noRoad, "a", "monument")).toMatchObject({ ok: false, reason: "Нужна дорога" });
    const blocked = mk([church]);
    const b = { ...(order(blocked, "a", "monument").buildings[1]) };
    const withHouse: SimState = { ...blocked, buildings: { 7: { ...b, id: 7, siteId: undefined, footprint: rect(5, 5, 6, 6) } } };
    expect(restoreSite(withHouse, "a", "monument")).toMatchObject({ ok: false, reason: "Место занято зданием" });
  });
});

describe("the building", () => {
  it("is a monument on the real ring, priced by area", () => {
    const s = order(mk([church]), "a", "monument");
    const b = s.buildings[1];
    expect(b).toMatchObject({ template: "restored", zone: "placed", state: "planned", siteId: "a", restoreMode: "monument", height: 8, paid: false });
    expect(b.footprint.length).toBe(4);
    expect(b.lot.w * 8 * b.lot.d * 8).toBeCloseTo(600, 0);
    expect(b.lot.cx).toBeCloseTo(10);
    expect(b.lot.cy).toBeCloseTo(15);
    expect(b.labor).toBe(340);
    expect(b.materials).toEqual({ logs: 30, planks: 15, stone: 20 });
    expect(lotFront(b)[1]).toBeCloseTo(30);
    expect(s.finds.foundations[0].state).toBe("restoring");
    expect(s.nextBuildingId).toBe(2);
  });
  it("takes the template of the working mode and a clamped height", () => {
    const s = order(mk([found("a", "place_of_worship", rect(0, 0, 20, 30), { height: 60 }), found("h", "hospital", rect(50, 0, 10, 10), { height: 1 })]), "a", "working");
    expect(s.buildings[1]).toMatchObject({ template: "chapel", restoreMode: "working", height: 25 });
    expect(order(s, "h", "working").buildings[2]).toMatchObject({ template: "healer", height: 4 });
  });
  it("is paid by its own materials and gets no old-foundation discount", () => {
    let s = order(mk([church]), "a", "monument");
    s = { ...s, stock: { food: 0, logs: 100, planks: 100, stone: 100, wares: 0 } };
    const b = s.buildings[1];
    expect(b.onRuins).toBeUndefined();
    const done = advanceBuildings({ 1: { ...b, paid: true } }, 1000);
    expect(done[1].state).toBe("active");
  });
});

describe("completion", () => {
  it("restores the site, adds the weight and grants an insight", () => {
    const s = finishAll(order(mk([found("a", "castle", rect(0, 0, 20, 30))], initialProgress()), "a", "monument"));
    expect(s.finds.foundations[0].state).toBe("restored");
    expect(s.buildings[1].restoreWeight).toBe(1); // a dense dig (one typed foundation in 707 m2 -> 1)
    expect(s.progress.restored.build).toBe(1);
    expect(s.progress.insights).toEqual(["carpenter-corner"]);
    expect(s.chronicle.some((c) => c.kind === "heritage:a")).toBe(true);
    const ev = s.events.find((e) => e.kind === "heritage")!;
    expect(ev.text).toBe("Восстановлено: Объект a — идея «Плотницкий угол»");
    expect(ev.pos).toBeDefined();
  });
  it("counts a working building half and skips insights already held or used", () => {
    const base = mk([church]);
    const s = finishAll(order({ ...base, progress: { ...base.progress, techs: base.progress.techs.filter((t) => t !== "healing") } }, "a", "working"));
    expect(s.buildings[1].restoreWeight).toBe(0.5);
    expect(s.progress.restored.care).toBe(0.5);
    expect(s.progress.insights).toEqual(["herbal"]); // vault is used up: its tech is researched
  });
  it("falls back to farm, then craft, when the domain has no insight left", () => {
    const p: ProgressState = { ...allResearched(), techs: [], insights: ["masonry", "carpenter-corner"] };
    expect(nextInsight(p, "build")?.id).toBe("dry-barn");
    expect(nextInsight({ ...p, insights: [...p.insights, "dry-barn", "grafting"] }, "build")?.id).toBe("one-roof");
    expect(nextInsight({ ...p, insights: [...p.insights, "dry-barn", "grafting", "one-roof", "firing"] }, "build")).toBeNull();
    expect(nextInsight(p, "learn")?.id).toBe("primer");
    // a researched tech's insight is not offered
    expect(nextInsight({ techs: ["carpentry"], insights: [] }, "build")?.id).toBe("masonry");
  });
  it("grants through the worker tick without admin help", () => {
    const s0 = order(mk([found("a", "castle", rect(0, 0, 20, 30))]), "a", "monument");
    const s = { ...s0, buildings: { 1: { ...s0.buildings[1], paid: true, done: s0.buildings[1].labor - 0.01, state: "building" as const } } };
    const built = advanceBuildings(s.buildings, 5);
    expect(built[1].state).toBe("active");
  });
});

describe("scarcity", () => {
  const typed = (n: number) => Array.from({ length: n }, (_, i) => found(`t${i}`, "castle", rect(i * 400, 0, 10, 10)));
  it("is 1 with nothing revealed", () => {
    expect(scarcity({ foundations: typed(3), revealed: [] })).toBe(1);
  });
  it("is 3 in a sparse village and 1 in a dense one", () => {
    expect(scarcity({ foundations: typed(1), revealed: [{ x: 0, y: 0, r: 500 }] })).toBe(3); // ~1.3 per km2
    expect(scarcity({ foundations: [], revealed: [{ x: 0, y: 0, r: 100 }] })).toBe(3);
    expect(scarcity({ foundations: typed(10), revealed: [{ x: 0, y: 0, r: 100 }] })).toBe(1); // ~318 per km2
  });
  it("is in between at a middling density and counts overlapping discs once", () => {
    const one = scarcity({ foundations: typed(1), revealed: [{ x: 0, y: 0, r: 120 }] }); // 22 per km2
    expect(one).toBe(1);
    const half = scarcity({ foundations: typed(1), revealed: [{ x: 0, y: 0, r: 190 }] }); // ~8.8 per km2 -> 2.3
    expect(half).toBeGreaterThan(2);
    expect(half).toBeLessThan(3);
    const twice = scarcity({ foundations: typed(1), revealed: [{ x: 0, y: 0, r: 190 }, { x: 0, y: 0, r: 190 }] });
    expect(twice).toBe(half);
  });
  it("scales the weight of a restoration in a sparse village", () => {
    const sparse = mk([found("a", "castle", rect(0, 0, 20, 30))]);
    const s = finishAll(order({ ...sparse, finds: { ...sparse.finds, revealed: [{ digId: 1, x: 0, y: 0, r: 500 }] } }, "a", "monument"));
    expect(s.progress.restored.build).toBe(3);
    expect(toSnapshot(s).heritageMul).toBe(3);
  });
});

describe("diminishing returns", () => {
  const two = (clsB = "castle") => mk([found("a", "castle", rect(0, 0, 20, 30)), found("b", clsB, rect(60, 0, 20, 30))], initialProgress());
  it("halves each further restoration of a kind and grants an insight only for the first", () => {
    const s = finishAll(order(order(two(), "a", "monument"), "b", "monument"));
    expect(s.buildings[1].restoreWeight).toBe(1);
    expect(s.buildings[2].restoreWeight).toBe(0.5);
    expect(s.progress.restored.build).toBe(1.5);
    expect(s.progress.insights).toEqual(["carpenter-corner"]);
  });
  it("keeps the working share on top of the repeat factor", () => {
    expect(restoreWeightOf("working", 2, 2)).toBe(0.25);
    expect(restoreWeightOf("monument", 1, 3)).toBe(0.13);
    expect(restoreWeightOf("monument", 3)).toBe(3);
  });
  it("does not reduce a different kind of the same domain, which brings its own insight", () => {
    const s = finishAll(order(order(two("monument"), "a", "monument"), "b", "monument"));
    expect(s.buildings[2].restoreWeight).toBe(1);
    expect(s.progress.insights.length).toBe(2);
  });
  it("counts ordered ones as earlier but not lost ones", () => {
    const s = order(order(two(), "a", "monument"), "b", "monument");
    expect(earlierOfKind(s, "castle", "b", s.buildings[2].id)).toBe(1);
    expect(earlierOfKind(s, "castle", "a", s.buildings[1].id)).toBe(0);
    const lost = loseSite({ ...s, buildings: { 2: s.buildings[2] } }, s.buildings[1]);
    expect(earlierOfKind(lost, "castle", "b", s.buildings[2].id)).toBe(0);
    expect(finishAll(lost).buildings[2].restoreWeight).toBe(1);
  });
});

describe("scarcity of kinds", () => {
  it("counts several of one kind within 300 m once, far ones and other kinds apart", () => {
    const f = (id: string, cls: string, x: number) => found(id, cls, rect(x, 0, 10, 10));
    expect(distinctTyped([f("a", "castle", 0), f("b", "castle", 100), f("c", "castle", 250)])).toBe(1);
    expect(distinctTyped([f("a", "castle", 0), f("b", "castle", 500)])).toBe(2);
    expect(distinctTyped([f("a", "castle", 0), f("b", "school", 10)])).toBe(2);
    expect(distinctTyped([f("a", "castle", 0), f("b", "pharmacy", 10), f("c", "bank", 20)])).toBe(1); // trimmed kinds do not count
  });
  it("is the same for a cluster as for one site", () => {
    const disc = [{ x: 0, y: 0, r: 190 }];
    const one = [found("a", "castle", rect(0, 0, 10, 10))];
    const cluster = [...one, found("b", "castle", rect(50, 0, 10, 10)), found("c", "castle", rect(90, 0, 10, 10))];
    expect(scarcity({ foundations: cluster, revealed: disc })).toBe(scarcity({ foundations: one, revealed: disc }));
  });
});

describe("demolition", () => {
  it("loses the site and takes the weight back; insights stay", () => {
    const s = finishAll(order(mk([found("a", "castle", rect(0, 0, 20, 30))], initialProgress()), "a", "monument"));
    const gone = s.buildings[1];
    const rest = { ...s, buildings: {} };
    const out = loseSite(rest, gone);
    expect(out.finds.foundations[0].state).toBe("lost");
    expect(out.progress.restored.build).toBeUndefined();
    expect(out.progress.insights).toEqual(["carpenter-corner"]);
    expect(out.chronicle.some((c) => c.kind === "heritage-lost:a")).toBe(true);
  });
  it("also loses a site still being restored", () => {
    const s = order(mk([church]), "a", "monument");
    const out = loseSite({ ...s, buildings: {} }, s.buildings[1]);
    expect(out.finds.foundations[0].state).toBe("lost");
    expect(out.progress.restored.care).toBeUndefined();
  });
});

describe("worker", () => {
  it("orders, refuses twice and loses the site on demolish", async () => {
    const sim = mk([church]);
    let stored: SaveV4 | undefined = { version: 4, city, sim } as SaveV4;
    const storage: Storage = { get: async () => stored, put: async (s) => void (stored = s), clear: async () => void (stored = undefined) };
    const out: FromWorker[] = [];
    const h = new Handler(storage, (m) => out.push(m));
    await h.handle({ t: "load", legacy: null, now: NOW });
    const send = async (id: number, cmd: Parameters<Handler["handle"]>[0] extends infer M ? (M extends { t: "cmd"; cmd: infer C } ? C : never) : never) => {
      out.length = 0;
      await h.handle({ t: "cmd", id, cmd });
      return out.find((m) => m.t === "cmdResult") as Extract<FromWorker, { t: "cmdResult" }>;
    };
    expect(await send(1, { type: "restoreSite", siteId: "a", mode: "monument" })).toMatchObject({ ok: true });
    expect(await send(2, { type: "restoreSite", siteId: "a", mode: "monument" })).toMatchObject({ ok: false, reason: "Уже восстанавливается" });
    const id = Number(Object.keys(stored!.sim.buildings)[0]);
    expect(await send(3, { type: "demolish", id })).toMatchObject({ ok: true });
    expect(stored!.sim.finds.foundations[0].state).toBe("lost");
  });
});

describe("building over a typed foundation", () => {
  const withCells = (s: SimState): SimState => {
    const cells = regenerateCells(s.roads, [], [], {});
    return { ...s, zones: { ...s.zones, cells: cells.map((c) => ({ ...c, block: null })) } };
  };
  it("refuses a placed building and growth skips the cells; lost sites are free again", () => {
    const base = withCells(mk([found("r", "castle", rect(-40, 44, 40, 40))]));
    const t = BUILDINGS.well;
    const starts = base.zones.cells.filter((c) => c.depth === 0);
    const over = starts.find((c) => Math.abs(c.cx + 20) < 4 && c.cy > 40 && c.cy < 60)!;
    const verdict = canPlace(base, t, over.edge, over.side, over.i, { forest: 0, water: 0, rock: 0 });
    expect(verdict).toEqual({ ok: false, reason: "Здесь старая постройка: восстановите её или стройте рядом" });
    const lost: SimState = { ...base, finds: { ...base.finds, foundations: base.finds.foundations.map((f) => ({ ...f, state: "lost" as const })) } };
    expect(canPlace(lost, t, over.edge, over.side, over.i, { forest: 0, water: 0, rock: 0 }).ok).toBe(true);
    const far = starts.find((c) => c.cx > 100 && c.cy > 40)!;
    expect(canPlace(base, t, far.edge, far.side, far.i, { forest: 0, water: 0, rock: 0 }).ok).toBe(true);
    expect(placeBuilding(lost, t, over.edge, over.side, over.i, { forest: 0, water: 0, rock: 0 }).buildings[1]).toBeDefined();
  });
  it("keeps zone growth off the foundation", () => {
    let s = withCells(mk([found("r", "castle", rect(-200, 0, 400, 400))]));
    s = { ...s, zones: { ...s.zones, cells: s.zones.cells.map((c) => ({ ...c, zone: "res" as const })) }, lastSpawn: { res: -1000, craft: -1000, trade: -1000 } };
    const grown = spawnBuildings({ ...s, residents: {}, households: {} });
    expect(Object.keys(grown.buildings).length).toBe(0);
  });
});

describe("working mode reaches the houses", () => {
  it("covers a house by the door and lets the chapel hire", () => {
    let s = order(mk([found("a", "place_of_worship", rect(0, 0, 20, 30))]), "a", "working");
    s = finishAll(s);
    const chapel = s.buildings[1];
    expect(chapel.template).toBe("chapel");
    const house: Building = { id: 2, template: "izba", zone: "res", lot: { cx: 150, cy: 52, angle: 0, w: 2, d: 3 }, side: 1, footprint: rect(145, 45, 10, 10), height: 5, state: "active", labor: 1, done: 1, created: 0, paid: true, level: 1, streak: 0 };
    const resident = { id: 1, first: "A", last: "B", sex: "m" as const, born: -9e5, household: 1, spouse: null, job: 1, commute: 5, idleDays: 0, literate: false, school: 0 };
    const cov = computeCoverage({ buildings: { 1: chapel, 2: house }, roads: s.roads, residents: { 1: resident } });
    expect(covers(cov[2], "chapel")).toBe(true);
    const none = computeCoverage({ buildings: { 1: { ...chapel, door: undefined, lot: { ...chapel.lot, cx: 0, cy: 3000 } }, 2: house }, roads: s.roads, residents: { 1: resident } });
    expect(covers(none[2], "chapel")).toBe(false);
  });
  it("lets a monument raise the land value of houses within 200 m", () => {
    const s = finishAll(order(mk([found("a", "castle", rect(0, 0, 20, 30))]), "a", "monument"));
    const house = (id: number, cx: number): Building => ({ id, template: "izba", zone: "res", lot: { cx, cy: 52, angle: 0, w: 2, d: 3 }, side: 1, footprint: rect(cx - 5, 45, 10, 10), height: 5, state: "active", labor: 1, done: 1, created: 0, paid: true, level: 1, streak: 0 });
    const near = computeLandValue({ buildings: { ...s.buildings, 2: house(2, 100), 3: house(3, 400) }, households: {} }, {});
    expect(near[2]).toBe(25);
    expect(near[3]).toBe(20);
  });
});

describe("save", () => {
  it("round-trips a restored building and its foundation state", () => {
    const s = finishAll(order(mk([found("a", "place_of_worship", simplifyRing(Array.from({ length: 12 }, (_, i): Pt => [10 + 10 * Math.cos((i / 12) * 6.283), 15 + 15 * Math.sin((i / 12) * 6.283)]))), found("m", "castle", rect(100, 0, 10, 10))]), "a", "working"));
    const save = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    const back = parseSave(save, NOW + 1)!;
    expect(back).not.toBeNull();
    const b = back.sim.buildings[1];
    expect(b).toMatchObject({ siteId: "a", restoreMode: "working", restoreWeight: s.buildings[1].restoreWeight, template: "chapel" });
    expect(b.footprint.length).toBe(12);
    expect(b.door).toEqual(s.buildings[1].door);
    expect(b.materials).toEqual(s.buildings[1].materials);
    expect(b.lot).toEqual(s.buildings[1].lot);
    expect(back.sim.finds.foundations.find((f) => f.id === "a")!.state).toBe("restored");
    expect(back.sim.finds.foundations.find((f) => f.id === "m")!.state).toBeUndefined();
  });
  it("still wants four points from a building without a site and loads old saves", () => {
    const s = order(mk([church]), "a", "monument");
    const save = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    save.sim.buildings[1].footprint = save.sim.buildings[1].footprint.slice(0, 3);
    delete save.sim.buildings[1].siteId;
    expect(Object.keys(parseSave(save, NOW + 1)!.sim.buildings)).toHaveLength(0); // three points and a fractional lot need a site (broken buildings give an empty town)
    const ok = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    ok.sim.buildings[1].footprint = ok.sim.buildings[1].footprint.slice(0, 3);
    expect(Object.keys(parseSave(ok, NOW + 1)!.sim.buildings)).toHaveLength(1);
    ok.sim.buildings[1].footprint = Array.from({ length: 65 }, () => [0, 0]);
    expect(Object.keys(parseSave(ok, NOW + 1)!.sim.buildings)).toHaveLength(0);
  });
  it("keeps a restored building when the roads change", () => {
    const s = order(mk([church]), "a", "monument");
    const kept = reconcile(s.buildings, emptyRoads(), []);
    expect(kept[1]).toBeDefined();
  });
});
