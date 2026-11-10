import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { canPlace, canPlaceOnFoundation, emptyGrowth, placeBuilding, placeOnFoundation, reconcile, spawnBuildings } from "./growth";
import { BUILDINGS, floorsOf } from "./buildings";
import { computeCoverage, computeLandValue } from "./coverage";
import { asItWasTemplate, distinctTyped, earlierOfKind, heritageDomain, isHeritage, nextInsight, restoreWeightOf, scarcity, siteDomain, workTemplate } from "./heritage";
import { isAsItWas } from "./foundationLots";
import { simplifyRing } from "./heritageGeo";
import { Handler, type Storage } from "./handler";
import { parseSave } from "./save";
import { loseSite } from "./restore";
import { addRoad, emptyRoads } from "./roads";
import { covers } from "./services";
import { allResearched, initialProgress } from "./tech";
import type { Building, City, FoundFoundation, ProgressState, RoadGraph, SaveV4, SimState } from "./types";
import { emptyZones, regenerateCells } from "./zones";
import type { FromWorker } from "./protocol";

// Restoring "as it was" (docs/PLAN-restoration.md section 2): ordinary construction of the purpose that matches a
// foundation's known old kind, with its consequences kept in sim/restore.ts.

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;

const found = (id: string, cls: string | undefined, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ...(cls ? { cls, name: `Объект ${id}` } : {}), ...extra });

// A road along y = 40, built.
const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  const g = r.graph;
  for (const e of Object.values(g.edges)) e.done = e.labor;
  return g;
};

const mk = (foundations: FoundFoundation[], progress: ProgressState = allResearched()): SimState =>
  ({
    realTime: NOW,
    gameMinutes: 1000,
    roads: builtRoad(),
    zones: emptyZones(),
    ...emptyGrowth(1),
    progress,
    finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 0, r: 15 }] },
  }) as SimState;

const church = found("a", "place_of_worship", rect(0, 0, 20, 30), { height: 11 });
const place = (s: SimState, id: string, template: string): SimState => {
  const ok = canPlaceOnFoundation(s, BUILDINGS[template], id);
  if (!ok.ok) throw new Error(ok.reason);
  return placeOnFoundation(s, BUILDINGS[template], id);
};
const asItWas = (s: SimState, id: string): SimState => place(s, id, asItWasTemplate(s.finds.foundations.find((f) => f.id === id)!.cls)!);
const lastBuilding = (s: SimState): Building => s.buildings[s.nextBuildingId - 1];

describe("kind table", () => {
  it("maps the purposes of the old kinds", () => {
    expect(workTemplate("place_of_worship")).toBe("chapel");
    expect(workTemplate("college")).toBe("school");
    expect(workTemplate("hospital")).toBe("healer");
    expect(workTemplate("marketplace")).toBe("market");
    expect(asItWasTemplate("place_of_worship")).toBe("chapel");
    expect(asItWasTemplate("castle")).toBe("restored"); // a kind with no working purpose comes back as a monument
    expect(asItWasTemplate(undefined)).toBeNull();
    expect(heritageDomain("hospital")).toBe("care");
  });
  it("drops the trimmed kinds: no longer typed unless already restoring or restored", () => {
    for (const k of ["pharmacy", "doctors", "mall", "car_repair", "bank", "department_store", "wholesale", "halt", "bus_station"]) {
      expect(heritageDomain(k), k).toBeNull();
      expect(isHeritage({ cls: k }), k).toBe(false);
      expect(isHeritage({ cls: k, state: "restoring" }), k).toBe(true);
      expect(siteDomain(k), k).not.toBeNull();
    }
    expect(isHeritage({ cls: "castle" })).toBe(true);
  });
});

describe("as it was", () => {
  it("is ordinary construction: the matching purpose on the ring, every old floor, the site being restored", () => {
    const s = asItWas(mk([church], initialProgress()), "a"); // no technology: "as it was" lifts the limits
    const b = lastBuilding(s);
    expect(b).toMatchObject({ template: "chapel", foundationId: "a", asItWas: true, level: floorsOf(11), floors: 3, state: "planned" });
    expect(b.footprint).toHaveLength(4);
    expect(b.scale).toBe(Math.round((600 / 84) * 100) / 100);
    expect(b.labor).toBe(Math.round(BUILDINGS.chapel.labor * b.scale! * 3)); // the cost of the floor area
    expect(s.finds.foundations[0].state).toBe("restoring");
  });
  it("any other purpose is allowed, without the restoration", () => {
    const s = place(mk([church]), "a", "barn");
    expect(lastBuilding(s).asItWas).toBeUndefined();
    expect(s.finds.foundations[0].state).toBeUndefined();
    const done = finishAll(s);
    expect(done.progress.restored.care).toBeUndefined();
    expect(done.finds.foundations[0].state).toBeUndefined();
  });
  it("another purpose keeps the size limits of the technology", () => {
    const s = mk([church], initialProgress());
    expect(canPlaceOnFoundation(s, BUILDINGS.chapel, "a").ok).toBe(true); // as it was: no limit (the handler checks the tech lock)
    expect(canPlaceOnFoundation(s, BUILDINGS.restored, "a")).toEqual({ ok: false, reason: "Фундамент велик для этого (600 м²): нужна «Работа с камнем»" });
    const h = place(mk([church]), "a", "restored");
    expect(lastBuilding(h).asItWas).toBeUndefined(); // a monument is not what a church was
  });
  it("needs a road within 30 m and no building on the ring", () => {
    const far = found("f", "castle", rect(0, 100, 20, 20));
    expect(canPlaceOnFoundation(mk([far]), BUILDINGS.restored, "f")).toMatchObject({ ok: false, reason: "Нужна построенная дорога рядом" });
    const s = asItWas(mk([church]), "a");
    expect(canPlaceOnFoundation(s, BUILDINGS.chapel, "a")).toMatchObject({ ok: false, reason: "Место занято зданием" });
  });
  it("a lost site can take a building again, but never as it was", () => {
    const lost = { ...church, state: "lost" as const };
    expect(isAsItWas(BUILDINGS.chapel, lost)).toBe(false);
    const s = place(mk([lost]), "a", "chapel");
    expect(lastBuilding(s).asItWas).toBeUndefined();
    expect(s.finds.foundations[0].state).toBe("lost");
  });
});

describe("completion", () => {
  it("restores the site, adds the full weight and grants an insight", () => {
    const s = finishAll(asItWas(mk([church], { ...initialProgress(), techs: ["faith"] }), "a"));
    expect(s.finds.foundations[0].state).toBe("restored");
    expect(s.progress.restored.care).toBe(restoreWeightOf(scarcity(s.finds)));
    expect(s.buildings[1].restoreWeight).toBe(s.progress.restored.care);
    expect(s.progress.insights).toEqual(["herbal"]); // «Свод» is used up: its tech is researched
    expect(s.chronicle.some((c) => c.kind === "heritage:a")).toBe(true);
    expect(s.events.some((e) => e.text.startsWith("Восстановлено: Объект a"))).toBe(true);
  });
  it("scales the weight of a restoration in a sparse village", () => {
    const sparse = { ...mk([church]), finds: { ...mk([church]).finds, revealed: [{ digId: 1, x: 0, y: 0, r: 400 }] } };
    expect(distinctTyped(sparse.finds.foundations)).toBe(1);
    expect(scarcity(sparse.finds)).toBe(3);
    const s = finishAll(asItWas(sparse, "a"));
    expect(s.progress.restored.care).toBe(3);
  });
  it("halves each further restoration of a kind and grants an insight only for the first", () => {
    const b = found("b", "place_of_worship", rect(100, 0, 20, 30));
    let s = finishAll(asItWas(mk([church, b], initialProgress()), "a"));
    const first = s.progress.restored.care!;
    expect(earlierOfKind(s, "place_of_worship", "b")).toBe(1);
    s = finishAll(asItWas(s, "b"));
    expect(s.progress.restored.care).toBeCloseTo(first * 1.5, 5);
    expect(s.progress.insights).toHaveLength(1);
    expect(nextInsight(s.progress, "care")).not.toBeNull();
  });
});

describe("loss", () => {
  it("loses the site and takes the weight back; insights stay", () => {
    const s = finishAll(asItWas(mk([church], initialProgress()), "a"));
    const out = loseSite({ ...s, buildings: {} }, s.buildings[1]);
    expect(out.finds.foundations[0].state).toBe("lost");
    expect(out.progress.restored.care).toBeUndefined();
    expect(out.progress.insights).toEqual(s.progress.insights);
    expect(out.chronicle.some((c) => c.kind === "heritage-lost:a")).toBe(true);
  });
  it("also loses a site still being restored; another purpose loses nothing", () => {
    const s = asItWas(mk([church]), "a");
    expect(loseSite({ ...s, buildings: {} }, s.buildings[1]).finds.foundations[0].state).toBe("lost");
    const barn = place(mk([church]), "a", "barn");
    expect(loseSite({ ...barn, buildings: {} }, barn.buildings[1]).finds.foundations[0].state).toBeUndefined();
  });
  it("the worker places as it was and loses the site on demolish", async () => {
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
    expect(await send(1, { type: "placeOnFoundation", template: "chapel", foundationId: "a" })).toMatchObject({ ok: true });
    expect(stored!.sim.finds.foundations[0].state).toBe("restoring");
    expect(await send(2, { type: "placeOnFoundation", template: "chapel", foundationId: "a" })).toMatchObject({ ok: false, reason: "Место занято зданием" });
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
  it("a regular lot avoids it; lost sites are free again", () => {
    const base = withCells(mk([found("r", "castle", rect(-40, 44, 40, 40))]));
    const t = BUILDINGS.well;
    const starts = base.zones.cells.filter((c) => c.depth === 0);
    const over = starts.find((c) => Math.abs(c.cx + 20) < 4 && c.cy > 40 && c.cy < 60)!;
    const verdict = canPlace(base, t, over.edge, over.side, over.i, { forest: 0, water: 0, rock: 0 });
    expect(verdict).toEqual({ ok: false, reason: "Здесь старая постройка: наведите на неё, чтобы восстановить или строить на ней" });
    const lost: SimState = { ...base, finds: { ...base.finds, foundations: base.finds.foundations.map((f) => ({ ...f, state: "lost" as const })) } };
    expect(placeBuilding(lost, t, over.edge, over.side, over.i, { forest: 0, water: 0, rock: 0 }).buildings[1]).toBeDefined();
  });
  it("keeps zone growth off a notable foundation", () => {
    let s = withCells(mk([found("r", "castle", rect(-200, 0, 400, 400))]));
    s = { ...s, zones: { ...s.zones, cells: s.zones.cells.map((c) => ({ ...c, zone: "res" as const })) }, lastSpawn: { res: -1000, craft: -1000, trade: -1000 } };
    const grown = spawnBuildings({ ...s, residents: {}, households: {} });
    expect(Object.keys(grown.buildings).length).toBe(0);
  });
});

describe("purposes reach the houses", () => {
  it("a temple as it was covers a house by the door", () => {
    const s = finishAll(asItWas(mk([church]), "a"));
    const chapel = s.buildings[1];
    const house: Building = { id: 2, template: "izba", zone: "res", lot: { cx: 150, cy: 52, angle: 0, w: 2, d: 3 }, side: 1, footprint: rect(145, 45, 10, 10), height: 5, state: "active", labor: 1, done: 1, created: 0, paid: true, level: 1, streak: 0 };
    const resident = { id: 1, first: "A", last: "B", sex: "m" as const, born: -9e5, household: 1, spouse: null, job: 1, commute: 5, idleDays: 0, literate: false, school: 0 };
    const cov = computeCoverage({ buildings: { 1: chapel, 2: house }, roads: s.roads, residents: { 1: resident } });
    expect(covers(cov[2], "chapel")).toBe(true);
  });
  it("a monument raises the land value of houses within 200 m", () => {
    const s = finishAll(place(mk([found("a", undefined, rect(0, 0, 20, 30))]), "a", "restored")); // any foundation may be kept as a monument
    const house = (id: number, cx: number): Building => ({ id, template: "izba", zone: "res", lot: { cx, cy: 52, angle: 0, w: 2, d: 3 }, side: 1, footprint: rect(cx - 5, 45, 10, 10), height: 5, state: "active", labor: 1, done: 1, created: 0, paid: true, level: 1, streak: 0 });
    const near = computeLandValue({ buildings: { ...s.buildings, 2: house(2, 100), 3: house(3, 400) }, households: {} }, {});
    expect(near[2]).toBe(25);
    expect(near[3]).toBe(20);
  });
  it("a monument stands only on an old foundation", () => {
    const s = (() => {
      const base = mk([]);
      const cells = regenerateCells(base.roads, [], [], {});
      return { ...base, zones: { ...base.zones, cells: cells.map((c) => ({ ...c, block: null })) } };
    })();
    const c = s.zones.cells.find((x) => x.depth === 0)!;
    expect(canPlace(s, BUILDINGS.restored, c.edge, c.side, c.i, { forest: 0, water: 0, rock: 0 })).toEqual({ ok: false, reason: "Памятник ставится только на старый фундамент" });
  });
});

describe("save", () => {
  it("round-trips a building as it was and its foundation state", () => {
    const ring = simplifyRing(Array.from({ length: 12 }, (_, i): Pt => [10 + 10 * Math.cos((i / 12) * 6.283), 15 + 15 * Math.sin((i / 12) * 6.283)]));
    const s = finishAll(asItWas(mk([found("a", "place_of_worship", ring), found("m", "castle", rect(100, 0, 10, 10))]), "a"));
    const back = parseSave(JSON.parse(JSON.stringify({ version: 4, city, sim: s })), NOW + 1)!;
    const b = back.sim.buildings[1];
    expect(b).toMatchObject({ foundationId: "a", asItWas: true, restoreWeight: s.buildings[1].restoreWeight, template: "chapel", scale: s.buildings[1].scale, floors: 1, level: 1 });
    expect(b.footprint.length).toBe(12);
    expect(b.door).toEqual(s.buildings[1].door);
    expect(b.materials).toEqual(s.buildings[1].materials);
    expect(back.sim.finds.foundations.find((f) => f.id === "a")!.state).toBe("restored");
    expect(back.sim.finds.foundations.find((f) => f.id === "m")!.state).toBeUndefined();
  });
  it("migrates a restoration ordered apart (siteId, restoreMode) to a building as it was", () => {
    const s = finishAll(asItWas(mk([church]), "a"));
    const save = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    const raw = save.sim.buildings[1];
    raw.siteId = raw.foundationId;
    raw.restoreMode = "working";
    for (const k of ["foundationId", "asItWas", "scale", "floors"]) delete raw[k];
    raw.level = 1;
    const b = parseSave(save, NOW + 1)!.sim.buildings[1];
    expect(b).toMatchObject({ foundationId: "a", asItWas: true, restoreWeight: s.buildings[1].restoreWeight, scale: Math.round((600 / 84) * 100) / 100, floors: 1, level: 1 });
    expect(b).not.toHaveProperty("siteId");
    expect(b).not.toHaveProperty("restoreMode");
  });
  it("wants four points from a building off a foundation", () => {
    const s = asItWas(mk([church]), "a");
    const save = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    save.sim.buildings[1].footprint = save.sim.buildings[1].footprint.slice(0, 3);
    delete save.sim.buildings[1].foundationId;
    expect(Object.keys(parseSave(save, NOW + 1)!.sim.buildings)).toHaveLength(0); // broken buildings give an empty town
    const ok = JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
    ok.sim.buildings[1].footprint = ok.sim.buildings[1].footprint.slice(0, 3);
    expect(Object.keys(parseSave(ok, NOW + 1)!.sim.buildings)).toHaveLength(1);
  });
  it("keeps a building on a foundation when the roads change", () => {
    const s = asItWas(mk([church]), "a");
    expect(reconcile(s.buildings, emptyRoads(), [])[1]).toBeDefined();
  });
});
