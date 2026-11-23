import { describe, expect, it } from "vitest";
import { finishAll } from "./admin";
import { allocateLabor, BUILDINGS, type BuildingTemplate } from "./buildings";
import { orderDig } from "./digging";
import { centroid } from "./excavation";
import { foundationBuilding, foundationIndex, foundationKindText, FOUNDATION_LOT, FOUNDATION_TAKEN, lotCheck, onReservedGround, OUTLINE_TAKEN } from "./foundationLots";
import { BLOCK_REASON, canPlace, canPlaceIn, canPlaceOnFoundation, emptyGrowth, placeBuilding, placeCtx, placeOnFoundation, reconcile, releaseSites, roadReady, type PlaceCheck } from "./growth";
import { asItWasTemplate, isHeritage, siteTitle } from "./heritage";
import { cellSquare, HERITAGE_TAKEN } from "./heritageGeo";
import { addRoad, distToEdge, emptyRoads, ROAD_KINDS } from "./roads";
import { applyStroke, cancelPlans, planStroke, roadSpans, strokeTemplate, type StrokeItem, type StrokePlan, type StrokeSkip, type StrokeSpan } from "./stroke";
import { allResearched } from "./tech";
import type { Building, FoundFoundation, LotCell, RoadGraph, SimState, Site, ZoneBlock } from "./types";
import { CELL_SIZE, emptyZones, qkey, regenerateCells } from "./zones";
import { L } from "../i18n";

// Building in strokes: foundations along the road first, outlines dug first, lots in the gaps.

type Pt = [number, number];
const rect = (x: number, y: number, w: number, h: number): Pt[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const area = (r: Pt[]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
const fnd = (id: string, ring: Pt[], extra: Partial<FoundFoundation> = {}): FoundFoundation => ({ id, ring, area: area(ring), digId: 1, at: 0, ...extra });

// A built road along y = 40 from x = -200 to 200: metres along it are x + 200, side 1 is y > 40.
const builtRoad = (): RoadGraph => {
  const r = addRoad(emptyRoads(), [[-200, 40], [200, 40]], "dirt", 1, [10]);
  if (!r.ok) throw new Error(r.reason);
  for (const e of Object.values(r.graph.edges)) e.done = e.labor;
  return r.graph;
};

const mk = (foundations: FoundFoundation[] = [], techs = allResearched().techs): SimState => {
  const roads = builtRoad();
  const cells = regenerateCells(roads, [], {}).map((c) => ({ ...c, block: c.block === "pending" ? null : c.block }));
  return {
    realTime: 0,
    gameMinutes: 1000,
    roads,
    zones: { ...emptyZones(), cells },
    ...emptyGrowth(1),
    progress: { ...allResearched(), techs },
    articles: [],
    finds: { foundations, pois: [], streets: [], revealed: [{ digId: 1, x: 0, y: 40, r: 150 }], features: [], fates: {} },
  } as SimState;
};

const edgeOf = (s: SimState) => Number(Object.keys(s.roads.edges)[0]);
const span = (s: SimState, x0: number, x1: number, side: 1 | -1 = 1): StrokeSpan => ({ edge: edgeOf(s), side, from: x0 + 200, to: x1 + 200 });
const xs = (plan: ReturnType<typeof planStroke>) => plan.items.map((it) => Math.round(it.building.lot.cx));

describe("a stroke", () => {
  it("lays only the templates zones grew", () => {
    expect(strokeTemplate("izba")?.id).toBe("izba");
    expect(strokeTemplate("smithy")?.id).toBe("smithy");
    expect(strokeTemplate("well")).toBeNull();
    expect(strokeTemplate("nope")).toBeNull();
  });

  it("fills the road with lots side by side, in the direction it was drawn", () => {
    const s = mk();
    const fwd = planStroke(s, BUILDINGS.izba, [span(s, -100, -20)]);
    expect(fwd.items.length).toBe(5); // 80 m, 16 m a house
    expect(fwd.items.every((it) => it.kind === "lot" && it.building.template === "izba")).toBe(true);
    const at = xs(fwd);
    expect(at).toEqual([...at].sort((p, q) => p - q));
    const back = planStroke(s, BUILDINGS.izba, [span(s, -20, -100)]);
    expect(xs(back)).toEqual([...xs(back)].sort((p, q) => q - p));
  });

  it("places what it planned: houses on their lots, kept while their road stands", () => {
    const s = mk();
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -100, -20), span(s, -100, -20, -1)]);
    const r = applyStroke(s, plan.items);
    expect(r.placed).toBe(plan.items.length);
    const built = Object.values(r.sim.buildings);
    expect(built.length).toBe(10);
    expect(built.every((b) => b.zone === "res" && b.state === "planned")).toBe(true);
    // ids follow the stroke: the build queue takes them in that order
    expect(built.map((b) => b.id)).toEqual(built.map((_, i) => i + 1));
    expect(reconcile(r.sim.buildings, r.sim.roads)).toBe(r.sim.buildings);
    // the ground is taken: a second stroke over it plans nothing
    expect(planStroke(r.sim, BUILDINGS.izba, [span(s, -100, -20)]).items).toEqual([]);
  });

  it("takes the foundations along it first, at their full ring, and keeps the lots off them", () => {
    const s = mk([fnd("old", rect(-4, 46, 12, 12)), fnd("far", rect(-4, 120, 12, 12)), fnd("other", rect(-4, 22, 12, 12))]);
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -40, 40)]);
    const old = plan.items.find((it) => it.key === "f:old")!;
    expect(old).toMatchObject({ kind: "foundation", foundationId: "old" });
    expect(old.building.footprint.length).toBeGreaterThanOrEqual(4);
    expect(plan.items.some((it) => it.key === "f:far" || it.key === "f:other")).toBe(false); // out of reach / other side
    const at = xs(plan);
    expect(at).toEqual([...at].sort((p, q) => p - q)); // the foundation sits in stroke order among the lots
    const r = applyStroke(s, plan.items);
    expect(r.placed).toBe(plan.items.length);
    for (const it of plan.items.filter((x) => x.kind === "lot"))
      if (it.kind === "lot") expect(canPlace(r.sim, BUILDINGS.izba, it.edge, it.side, it.i, { forest: 0, water: 0, rock: 0 }).ok).toBe(false);
  });

  it("with only foundations wanted leaves the gaps empty", () => {
    const s = mk([fnd("old", rect(-4, 46, 12, 12))]);
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -40, 40)], true);
    expect(plan.items.map((it) => it.key)).toEqual(["f:old"]);
  });

  it("leaves foundations of another purpose, notable sites and those too large, each with its reason", () => {
    const s = mk(
      [
        fnd("shop", rect(-60, 46, 10, 10), { cls: "shop" }),
        fnd("church", rect(-20, 46, 12, 16), { cls: "place_of_worship", name: "Церковь Покрова" }),
        fnd("big", rect(20, 46, 20, 20)),
      ],
      [],
    );
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -80, 80)], true);
    expect(plan.items).toEqual([]);
    const why = Object.fromEntries(plan.skipped.map((k) => [k.foundationId, k.reason]));
    expect(why.shop).toMatch(/^Прежде здесь/);
    expect(why.church).toBe("Церковь Покрова: восстанавливается из карточки места");
    expect(why.big).toMatch(/^Фундамент велик для этого \(400 м²\)/);
  });

  it("brings a foundation of the same class back as it was", () => {
    const s = mk([fnd("shop", rect(-4, 46, 10, 10), { cls: "shop" })]);
    const plan = planStroke(s, BUILDINGS.tavern, [span(s, -40, 40)], true);
    expect(plan.items[0].building).toMatchObject({ template: "shop", asItWas: true });
  });

  it("digs an outline first and builds on it once dug", () => {
    const s = mk([fnd("h", rect(-4, 46, 10, 10), { ghost: true })]);
    const plan = planStroke(s, BUILDINGS.izba, [span(s, -40, 40)]);
    const dig = plan.items.find((it) => it.key === "f:h")!;
    expect(dig).toMatchObject({ kind: "dig", building: { template: "izba", foundationId: "h" } });
    const r = applyStroke(s, plan.items);
    const site = Object.values(r.sim.buildings).find((b) => b.template === "excavation")!;
    expect(site).toMatchObject({ foundationId: "h", then: "izba" });
    // no lot was laid over the outline
    expect(Object.values(r.sim.buildings).filter((b) => b.template === "izba" && !b.foundationId).every((b) => Math.abs(b.lot.cx - 1) >= 8)).toBe(true);
    const done = finishAll(r.sim);
    expect(Object.values(done.buildings).some((b) => b.template === "izba" && b.foundationId === "h")).toBe(true);
  });

  it("along a road not built yet, lays sites that wait for it", () => {
    const s = mk([fnd("old", rect(-4, 46, 12, 12))]);
    const e = s.roads.edges[edgeOf(s)];
    const raw = { ...s, roads: { ...s.roads, edges: { ...s.roads.edges, [e.id]: { ...e, done: 0 } } } };
    const plan = planStroke(raw, BUILDINGS.izba, [span(s, -40, 40)]);
    expect(plan.items.length).toBeGreaterThan(1);
    expect(plan.items.every((it) => it.building.awaitsRoad === true)).toBe(true); // the lots and the foundation alike
    const laid = applyStroke(raw, plan.items).sim;
    const sites = Object.values(laid.buildings);
    expect(sites.every((b) => b.awaitsRoad)).toBe(true);
    expect([...allocateLabor(laid.buildings, 100, 6)]).toEqual([]); // nobody works on them
    expect(releaseSites(laid.buildings, laid.roads)).toBe(laid.buildings);
    const open = releaseSites(laid.buildings, s.roads); // the road is built
    expect(Object.values(open).some((b) => b.awaitsRoad)).toBe(false);
    expect([...allocateLabor(open, 100, 6)].length).toBeGreaterThan(0);
    // along a built road a site does not wait
    expect(Object.values(applyStroke(s, planStroke(s, BUILDINGS.izba, [span(s, -40, 40)]).items).sim.buildings).some((b) => b.awaitsRoad)).toBe(false);
  });

  it("a road with houses takes the edges it added, not the pieces of one it split", () => {
    const s = mk();
    const cross: [number, number][] = [[0, -60], [0, 120]];
    const r = addRoad(s.roads, cross, "dirt", 1, [10]);
    if (!r.ok) throw new Error(r.reason);
    const fresh = r.added;
    expect(fresh.length).toBe(2); // the crossing road, cut at the old one
    for (const id of fresh) {
      const e = r.graph.edges[id];
      expect(Math.abs(r.graph.nodes[e.a].x) + Math.abs(r.graph.nodes[e.b].x)).toBeLessThan(1e-6);
    }
    expect(roadSpans(r.graph, fresh)).toHaveLength(4); // both sides of each
  });

  it("is undone while nobody has started on it: a restoration no longer under way, started ones kept", () => {
    const s = mk([fnd("shop", rect(-4, 46, 10, 10), { cls: "shop" })]);
    const r = applyStroke(s, planStroke(s, BUILDINGS.shop, [span(s, -60, 40)]).items);
    const ids = Object.keys(r.sim.buildings).map(Number);
    expect(r.sim.finds.foundations[0].state).toBe("restoring");
    const started = ids[0];
    const sim = { ...r.sim, buildings: { ...r.sim.buildings, [started]: { ...r.sim.buildings[started], state: "building" as const, done: 1, paid: true } } };
    const back = cancelPlans(sim, ids);
    expect(back.removed).toBe(ids.length - 1);
    expect(Object.keys(back.sim.buildings).map(Number)).toEqual([started]);
    expect(back.sim.finds.foundations[0].state).toBe(r.sim.buildings[started].foundationId ? "restoring" : undefined);
    expect(cancelPlans(back.sim, ids).removed).toBe(0);
  });
});


// ---------- the planner as it was before the placement context, kept as the yardstick ----------
// planStroke now prepares the town once (sim/growth.ts placeCtx/canPlaceIn) instead of rebuilding a cell map and the
// buildings' occupancy hash for every candidate. It must plan exactly what it planned before: the same items in the
// same order and the same skipped foundations, on towns that tell the two paths apart. The copies below are
// sim/stroke.ts planStroke and sim/growth.ts canPlace as they were, with only the imports and names changed.

const refBucketOf = (v: number) => Math.floor(v / 32);
const refBucketKey = (bx: number, by: number) => bx * 65536 + by;

const refInLot = (b: Building, x: number, y: number, margin: number): boolean => {
  const { cx, cy, angle, w, d } = b.lot;
  const dx = x - cx;
  const dy = y - cy;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return Math.abs(dx * c + dy * s) <= (CELL_SIZE * w) / 2 + margin && Math.abs(-dx * s + dy * c) <= (CELL_SIZE * d) / 2 + margin;
};

const refOccupancy = (buildings: Record<number, Building>): ((x: number, y: number) => boolean) => {
  const h = new Map<number, Building[]>();
  for (const b of Object.values(buildings)) {
    const k = refBucketKey(refBucketOf(b.lot.cx), refBucketOf(b.lot.cy));
    const list = h.get(k);
    if (list) list.push(b);
    else h.set(k, [b]);
  }
  return (x, y) => {
    const bx = refBucketOf(x);
    const by = refBucketOf(y);
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++) if ((h.get(refBucketKey(bx + ox, by + oy)) ?? []).some((b) => refInLot(b, x, y, 1))) return true;
    return false;
  };
};

type PlacementTown = Pick<SimState, "roads" | "zones" | "buildings"> & { finds?: SimState["finds"] };

const refPct = (share: number): number => Math.round(share * 100);

const refCanPlace = (s: PlacementTown, t: BuildingTemplate, edge: number, side: 1 | -1, i: number, site: Site, planned = false): PlaceCheck => {
  const no = (reason: string): PlaceCheck => ({ ok: false, reason });
  if (t.foundationOnly) return no(L(`${t.name} ставится только на старый фундамент`, `A ${t.name.toLowerCase()} stands only on an old foundation`));
  if (t.onePerTown && Object.values(s.buildings).some((b) => b.template === t.id)) return no(t.onePerTown);
  const e = s.roads.edges[edge];
  if (!e) return no(L("Нет такой дороги", "No such road"));
  if (e.done < e.labor && !planned) return no(L("Дорога ещё не построена", "The road is not built yet"));
  const byKey = new Map<string, LotCell>();
  for (const c of s.zones.cells) if (c.edge === edge && c.side === side) byKey.set(c.key, c);
  const occ = refOccupancy(s.buildings);
  const old = s.finds?.foundations ?? [];
  const cells: LotCell[] = [];
  for (let a = 0; a < t.w; a++)
    for (let d = 0; d < t.d; d++) {
      const c = byKey.get(`${edge}:${side}:${i + a}:${d}`);
      if (!c) return no(L("Не хватает места вдоль дороги", "Not enough room along the road"));
      if (c.block) return no(BLOCK_REASON[c.block] ?? L("Место занято", "The spot is taken"));
      if (occ(c.cx, c.cy)) return no(L("Место занято зданием", "The spot is taken by a building"));
      const under = onReservedGround(old, cellSquare(c));
      if (under) return no(isHeritage(under) ? HERITAGE_TAKEN : under.ghost ? OUTLINE_TAKEN : FOUNDATION_TAKEN);
      cells.push(c);
    }
  const need = t.needs;
  if (need?.forest !== undefined && site.forest < need.forest) return no(L(`Рядом мало леса (нужно от ${refPct(need.forest)} %)`, `Too little forest nearby (${refPct(need.forest)}% needed)`));
  if (need?.water !== undefined && site.water < need.water) return no(L(`Рядом нет воды (нужно от ${refPct(need.water)} %)`, `No water nearby (${refPct(need.water)}% needed)`));
  if (t.dryLand)
    for (const c of cells) {
      const land = s.zones.terrain[qkey(c.cx, c.cy)]?.land;
      if (land === "water" || land === "wetland") return no(L(`${t.name} нельзя ставить на воде и болоте`, `${t.name} can’t be placed on water or marsh`));
    }
  return { ok: true };
};

interface RefFrame extends StrokeSpan {
  index: number;
  ax: number;
  ay: number;
  ux: number;
  uy: number;
  lo: number;
  hi: number;
  dir: 1 | -1;
}

const refAlong = (f: RefFrame, x: number, y: number) => (x - f.ax) * f.ux + (y - f.ay) * f.uy;
const refAcross = (f: RefFrame, x: number, y: number) => -(x - f.ax) * f.uy + (y - f.ay) * f.ux;

function refFrames(s: Pick<SimState, "roads">, spans: readonly StrokeSpan[]): RefFrame[] {
  const out: RefFrame[] = [];
  spans.forEach((sp, index) => {
    const e = s.roads.edges[sp.edge];
    const a = e && s.roads.nodes[e.a];
    const b = e && s.roads.nodes[e.b];
    if (!a || !b) return;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return;
    const lo = Math.max(0, Math.min(sp.from, sp.to));
    const hi = Math.min(len, Math.max(sp.from, sp.to));
    if (hi <= lo) return;
    out.push({ ...sp, index, ax: a.x, ay: a.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, lo, hi, dir: sp.to >= sp.from ? 1 : -1 });
  });
  return out;
}

function refPurposeOn(f: FoundFoundation, t: BuildingTemplate): BuildingTemplate | string {
  if (isHeritage(f) && f.state !== "lost") return L(`${siteTitle(f)}: восстанавливается из карточки места`, `${siteTitle(f)}: restored from the site's card`);
  const was = f.state === "lost" ? null : asItWasTemplate(f.cls);
  if (!was) return t;
  const w = BUILDINGS[was];
  return w && w.zone === t.zone ? w : foundationKindText(f, t);
}

function refAlongFoundations(s: PlacementTown, fr: readonly RefFrame[]): { f: FoundFoundation; order: [number, number] }[] {
  const taken = new Set<string>();
  for (const b of Object.values(s.buildings)) if (b.foundationId) taken.add(b.foundationId);
  const idx = foundationIndex(s.finds!.foundations);
  const seen = new Set<string>();
  const out: { f: FoundFoundation; order: [number, number] }[] = [];
  for (const sp of fr) {
    const e = s.roads.edges[sp.edge];
    const reach = FOUNDATION_LOT.roadReach + ROAD_KINDS[e.kind].width / 2;
    const ends = [sp.lo, sp.hi].map((t): [number, number] => [sp.ax + sp.ux * t, sp.ay + sp.uy * t]);
    const x0 = Math.min(ends[0][0], ends[1][0]) - reach;
    const y0 = Math.min(ends[0][1], ends[1][1]) - reach;
    const x1 = Math.max(ends[0][0], ends[1][0]) + reach;
    const y1 = Math.max(ends[0][1], ends[1][1]) + reach;
    for (const { f } of idx.near(x0, y0, x1, y1)) {
      if (seen.has(f.id) || taken.has(f.id) || f.area < FOUNDATION_LOT.minArea) continue;
      const [cx, cy] = centroid(f.ring);
      const at = refAlong(sp, cx, cy);
      if (at < sp.lo || at > sp.hi || Math.sign(refAcross(sp, cx, cy)) !== sp.side) continue;
      if (!f.ring.some(([x, y]) => distToEdge(s.roads, e, x, y) <= reach)) continue;
      seen.add(f.id);
      out.push({ f, order: [sp.index, sp.dir * at] });
    }
  }
  return out.sort((p, q) => p.order[0] - q.order[0] || p.order[1] - q.order[1]);
}

const REF_SITE: Site = { forest: 0, water: 0, rock: 0 };

// The plan as the old path made it, ready for a deep comparison with planStroke's.
function refPlanStroke(s: SimState, t: BuildingTemplate, spans: readonly StrokeSpan[], onlyFoundations = false): StrokePlan {
  const fr = refFrames(s, spans);
  const items: (StrokeItem & { order: [number, number] })[] = [];
  const skipped: StrokeSkip[] = [];
  let cur = s;
  const newest = (): Building => cur.buildings[cur.nextBuildingId - 1];
  for (const { f, order } of refAlongFoundations(s, fr)) {
    const use = refPurposeOn(f, t);
    const at = centroid(f.ring);
    if (typeof use === "string") {
      skipped.push({ foundationId: f.id, reason: use, at });
      continue;
    }
    const key = `f:${f.id}`;
    if (f.ghost) {
      const { ghost: _g, ...dug } = f;
      const r = lotCheck(cur, dug, use, true);
      const dig = r.ok ? orderDig(cur, f.id) : null;
      if (!r.ok || !dig || !dig.ok) {
        skipped.push({ foundationId: f.id, reason: !r.ok ? r.reason : dig && !dig.ok ? dig.reason : "", at });
        continue;
      }
      const building = foundationBuilding(use, dug, r.door, 0, cur.gameMinutes, cur.progress);
      if (!roadReady(cur.roads, building)) building.awaitsRoad = true;
      cur = dig.sim;
      items.push({ kind: "dig", key, building, foundationId: f.id, order });
      continue;
    }
    const ok = canPlaceOnFoundation(cur, use, f.id, true);
    if (!ok.ok) {
      skipped.push({ foundationId: f.id, reason: ok.reason, at });
      continue;
    }
    cur = placeOnFoundation(cur, use, f.id, true);
    items.push({ kind: "foundation", key, building: { ...newest(), id: 0 }, foundationId: f.id, order });
  }
  if (!onlyFoundations)
    for (const sp of fr) {
      const row = new Map<number, number>();
      for (const c of cur.zones.cells) {
        if (c.edge !== sp.edge || c.side !== sp.side || c.depth !== 0) continue;
        const t0 = refAlong(sp, c.cx, c.cy);
        if (t0 >= sp.lo && t0 <= sp.hi) row.set(c.i, t0);
      }
      const ids = [...row.keys()].sort((p, q) => (p - q) * sp.dir);
      const used = new Set<number>();
      for (const i of ids) {
        if (used.has(i)) continue;
        const start = sp.dir === 1 ? i : i - t.w + 1;
        let inside = true;
        for (let a = 0; a < t.w && inside; a++) inside = row.has(start + a) && !used.has(start + a);
        if (!inside || !refCanPlace(cur, t, sp.edge, sp.side, start, REF_SITE, true).ok) continue;
        cur = placeBuilding(cur, t, sp.edge, sp.side, start);
        for (let a = 0; a < t.w; a++) used.add(start + a);
        const mid = (row.get(start)! + row.get(start + t.w - 1)!) / 2;
        items.push({ kind: "lot", key: `lot:${sp.edge}:${sp.side}:${start}`, building: { ...newest(), id: 0 }, edge: sp.edge, side: sp.side, i: start, order: [sp.index, sp.dir * mid] });
      }
    }
  return { items: items.sort((p, q) => p.order[0] - q.order[0] || p.order[1] - q.order[1]).map(({ order: _o, ...it }) => it as StrokeItem), skipped };
}

// ---------- the same plan from both paths ----------

describe("a stroke plans what it planned before the placement context", () => {
  // A full comparison: the items in their order with the buildings they would build, and every skipped foundation.
  const samePlan = (s: SimState, template: keyof typeof BUILDINGS, spans: readonly StrokeSpan[], onlyFoundations = false) => {
    const t = BUILDINGS[template];
    const now = planStroke(s, t, spans, onlyFoundations);
    const before = refPlanStroke(s, t, spans, onlyFoundations);
    expect(now).toEqual(before);
    return now;
  };

  // Blocks the depth-0 cells `when` names, as a road, a field or unsurveyed land does.
  const blockCells = (s: SimState, when: (c: { i: number; side: 1 | -1; depth: number }) => ZoneBlock | null): SimState => ({
    ...s,
    zones: {
      ...s.zones,
      cells: s.zones.cells.map((c) => {
        const block = c.depth === 0 ? when(c) : null;
        return block ? { ...c, block } : c;
      }),
    },
  });

  it("fills the road side by side, both sides, both directions, and a row of taller buildings", () => {
    const s = mk();
    const fwd = samePlan(s, "izba", [span(s, -100, 60)]);
    expect(fwd.items.length).toBe(10);
    const both = samePlan(s, "izba", [span(s, -100, 60), span(s, -100, 60, -1)]);
    expect(both.items.length).toBe(20);
    const back = samePlan(s, "izba", [span(s, 60, -100)]);
    expect(back.items.length).toBe(fwd.items.length); // the same lots, laid the other way round
    // a workshop is deeper than a house: a different set of candidates, the same plan from both paths
    expect(samePlan(s, "smithy", [span(s, -100, 60)]).items.length).toBeGreaterThan(0);
    // spans over the same cells in one plan: the lots of the second must see the buildings of the first, or they
    // would be laid twice (the plan is what the player sees and the worker then places)
    expect(samePlan(s, "izba", [span(s, -100, 60), span(s, -100, 60)]).items).toHaveLength(10);
    expect(samePlan(s, "izba", [span(s, -100, 20), span(s, -40, 60)]).items).toHaveLength(10);
    expect(samePlan(s, "izba", [span(s, -100, 60), span(s, 60, -100)]).items).toHaveLength(10); // the same row backwards
    // two rows one after the other in one plan: the second sees the first one's buildings
    const row = planStroke(s, BUILDINGS.izba, [span(s, -100, 60)]);
    const next = applyStroke(s, row.items).sim;
    expect(samePlan(next, "izba", [span(s, -100, 60)]).items).toEqual([]);
    expect(samePlan(next, "izba", [span(s, -100, 60, -1)]).items.length).toBeGreaterThan(5);
  });

  it("keeps off the cells blocked by a road, a field or unsurveyed land", () => {
    const s = blockCells(mk(), (c) => (c.side !== 1 ? null : c.i === 3 || c.i === 4 ? "road" : c.i === 20 ? "field" : c.i === 30 ? "pending" : c.i === 31 ? "water" : null));
    const plan = samePlan(s, "izba", [span(s, -100, 60)]);
    expect(plan.items.length).toBe(8);
    expect(plan.items.length).toBeLessThan(10); // two lots fewer than the free side
    expect(samePlan(s, "izba", [span(s, -100, 60, -1)]).items.length).toBe(10); // the other side is clear
  });

  it("lays sites that wait for a road not built yet", () => {
    const s = mk();
    const e = s.roads.edges[edgeOf(s)];
    const raw = { ...s, roads: { ...s.roads, edges: { ...s.roads.edges, [e.id]: { ...e, done: 0 } } } };
    const plan = samePlan(raw, "izba", [span(raw, -100, 60)]);
    expect(plan.items.length).toBe(10);
    expect(plan.items.every((it) => it.building.awaitsRoad === true)).toBe(true);
  });

  it("stops where the road's cells end, at both ends", () => {
    const s = mk(); // its cells run the whole road, x = -200..200, 8 m apart
    expect(samePlan(s, "izba", [span(s, 150, 199)]).items.length).toBe(3); // the last lots that still fit
    expect(samePlan(s, "izba", [span(s, -199, -160)]).items.length).toBe(2); // and the first
    expect(samePlan(s, "izba", [span(s, 190, 240)]).items).toEqual([]); // one cell left: no room for a lot at all
    expect(samePlan(s, "smithy", [span(s, 150, 199)]).items.length).toBeGreaterThan(0); // deeper lots, still compared
  });

  it("takes the foundations along it first: an outline to dig, a dug one, a notable one, a small one", () => {
    const founds = [
      fnd("old", rect(-4, 46, 12, 12)),
      fnd("ghost", rect(-40, 46, 10, 10), { ghost: true }),
      fnd("church", rect(-70, 46, 12, 16), { cls: "place_of_worship", name: "Церковь Покрова" }),
      fnd("shop", rect(40, 46, 10, 10), { cls: "shop" }),
      fnd("shed", rect(56, 46, 4, 4)),
      fnd("big", rect(10, 46, 20, 20)),
    ];
    const s = mk(founds);
    const plan = samePlan(s, "izba", [span(s, -100, 60)]);
    const keys = plan.items.map((it) => it.key);
    expect(keys).toContain("f:old");
    expect(keys).toContain("f:ghost");
    expect(plan.skipped.map((k) => k.foundationId).sort()).toEqual(["church", "shop"]);
    // with the roof trusses known, the 400 m² foundation fits a house like any other; before them it is too large
    const early = mk(founds, []);
    const limited = samePlan(early, "izba", [span(early, -100, 60)]);
    expect(limited.items.some((it) => it.key === "f:big")).toBe(false);
    expect(limited.skipped.find((k) => k.foundationId === "big")!.reason).toMatch(/^Фундамент велик для этого \(400 м²\)/);
    expect(plan.items.some((it) => it.kind === "dig")).toBe(true);
    expect(plan.items.some((it) => it.kind === "foundation")).toBe(true);
    // a tavern stroke takes a shop as it was, and leaves the house-shaped ones to their own kinds
    const tavern = samePlan(s, "tavern", [span(s, -100, 60)]);
    expect(tavern.items.find((it) => it.key === "f:shop")?.building.template).toBe("shop");
    // foundations only: the gaps stay empty, the same foundations in the same order
    const only = samePlan(s, "izba", [span(s, -100, 60)], true);
    expect(only.items.map((it) => it.key)).toEqual(plan.items.filter((it) => it.key.startsWith("f:")).map((it) => it.key));
  });

  it("crosses a junction: two roads, four spans, the lots of one keeping off the other", () => {
    const s = mk();
    const cross = addRoad(s.roads, [[0, -60], [0, 120]], "dirt", 1, [10]);
    if (!cross.ok) throw new Error(cross.reason);
    const roads = cross.graph;
    for (const e of Object.values(roads.edges)) e.done = e.labor;
    const cells = regenerateCells(roads, [], {}).map((c) => ({ ...c, block: c.block === "pending" ? null : c.block }));
    const town = { ...s, roads, zones: { ...s.zones, cells } } as SimState;
    const spans = roadSpans(roads, Object.keys(roads.edges).map(Number));
    const plan = samePlan(town, "izba", spans);
    expect(plan.items.length).toBeGreaterThan(20);
    expect(new Set(plan.items.map((it) => it.key.split(":")[1])).size).toBeGreaterThan(1); // both roads
    // and along one edge at a time, in both directions
    for (const id of Object.keys(roads.edges).map(Number)) {
      const len = Math.hypot(roads.nodes[roads.edges[id].b].x - roads.nodes[roads.edges[id].a].x, roads.nodes[roads.edges[id].b].y - roads.nodes[roads.edges[id].a].y);
      samePlan(town, "izba", [
        { edge: id, side: 1, from: 0, to: len },
        { edge: id, side: -1, from: len, to: 0 },
      ]);
    }
  });

  it("checks every candidate as canPlace did: the same verdicts and the same reasons", () => {
    // The lot loop is the hot path; its verdicts must be the old ones for every cell of the row, not only the ones a
    // stroke keeps. A blocked cell, a taken one, an outline and the end of the cells each answer with their own reason.
    const s = blockCells(mk([fnd("old", rect(-4, 46, 12, 12)), fnd("ghost", rect(40, 46, 10, 10), { ghost: true })]), (c) => (c.i === 12 ? "road" : null));
    const edge = edgeOf(s);
    const asPlacementTown = s as unknown as Parameters<typeof canPlace>[0];
    const ctxTown = s as unknown as Parameters<typeof canPlaceIn>[1];
    let checked = 0;
    for (const side of [1, -1] as const)
      for (let i = -2; i < 120; i++) {
        for (const planned of [true, false]) {
          const now = canPlace(asPlacementTown, BUILDINGS.izba, edge, side, i, { forest: 0, water: 0, rock: 0 }, planned);
          expect(now).toEqual(refCanPlace(s, BUILDINGS.izba, edge, side, i, { forest: 0, water: 0, rock: 0 }, planned));
          // the prepared town answers the same as the one built for a single call
          expect(canPlaceIn(placeCtx(s), ctxTown, BUILDINGS.izba, edge, side, i, { forest: 0, water: 0, rock: 0 }, planned)).toEqual(now);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(400);
    // the reasons themselves, not only the verdicts
    const blocked = s.zones.cells.find((c) => c.depth === 0 && c.block === "road")!; // the cell i = 12 of the row
    expect(canPlace(asPlacementTown, BUILDINGS.izba, blocked.edge, blocked.side, blocked.i, { forest: 0, water: 0, rock: 0 }, true)).toEqual({ ok: false, reason: "Здесь дорога" });
    const onOld = s.zones.cells.find((c) => c.depth === 0 && c.cy > 40 && c.cx > -5 && c.cx < 9)!; // over the old ring
    expect(canPlace(asPlacementTown, BUILDINGS.izba, onOld.edge, onOld.side, onOld.i, { forest: 0, water: 0, rock: 0 }, true)).toEqual({
      ok: false,
      reason: "Здесь старый фундамент: наведите на него, чтобы строить прямо на нём",
    });
    const lastCell = s.zones.cells.filter((c) => c.depth === 0 && c.edge === edge && c.side === 1).reduce((a, c) => (c.i > a.i ? c : a));
    expect(canPlace(asPlacementTown, BUILDINGS.izba, edge, 1, lastCell.i, { forest: 0, water: 0, rock: 0 }, true)).toEqual({ ok: false, reason: "Не хватает места вдоль дороги" });
    // everything is taken by then, so the needs are told apart on a free row of the other side
    expect(canPlace(asPlacementTown, BUILDINGS.izba, edge, 1, 22, { forest: 0, water: 0, rock: 0 }, true)).toEqual({ ok: true });
  });
});
