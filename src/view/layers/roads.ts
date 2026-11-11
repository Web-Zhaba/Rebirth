import { computed, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { cutOffEdges, ROAD_KINDS, stoneOwed, workableEdges } from "../../sim/roads";
import type { RoadEdge, RoadGraph, Stock } from "../../sim/types";
import { frame, roads, stock } from "../../simClient";
import type { ModelItem } from "../../map/modelItems";
import { roadChains, type RoadChain, type RoadState } from "../../map/roadChains";
import { roadJunctions } from "../../map/roadJunctions";

// Roads for every renderer: chains of the graph by kind and state, the model items of the built ones (3D ribbons and the
// aprons where roads meet), and the chains still under construction as lines in lng/lat for the 2D drawing. Built roads
// are drawn in 3D only.

// State of every edge of the graph. Edges short of stone are not workable: they show as waiting. The stock is only
// watched while some edge owes stone.
// A built edge being rebuilt is "built" (it serves as it is); its rebuilding shows as `active` or not.
const stockOf = (g: RoadGraph) => (Object.values(g.edges).some((e) => stoneOwed(e) > 0) ? stock.value : null);
const stateOf = (g: RoadGraph, st: Stock | null): { of: (e: RoadEdge) => RoadState; active: Set<number> } => {
  const active = new Set(workableEdges(g, st ?? undefined));
  const cut = cutOffEdges(g);
  return { of: (e) => (e.done >= e.labor ? "built" : active.has(e.id) ? "active" : cut.has(e.id) ? "cut" : "waiting"), active };
};

// The state of every edge, once per change of the graph (or of the stock, while some edge owes stone).
const edgeState = computed(() => {
  const g = roads.value;
  return g ? stateOf(g, stockOf(g)) : null;
});

// Chains of the road graph by kind and state.
const chains = computed<RoadChain[] | null>(() => {
  const g = roads.value;
  const state = edgeState.value;
  return g && state ? roadChains(g, state.of) : null;
});

// What the model layer draws of the roads: every built chain, then the aprons where roads meet (roadJunctions.ts). The
// aprons come last in the list, and the road mesh keeps that order (engine/scene/townMesh.ts, one mesh drawn without depth writes),
// so an apron covers the ends of the ribbons it joins and the shoulder lines that would cross it. The same list comes
// back while no built chain changed.
let lastItems: ModelItem[] = [];
let lastSig = "";
const itemSig = (l: readonly ModelItem[]) =>
  l
    .map(
      (i) =>
        `${i.kind}:${i.ring.map((p) => p.join(",")).join(";")}${i.ends ? `${i.ends[0] ? 1 : 0}${i.ends[1] ? 1 : 0}` : ""}${i.junction ? `@${i.junction.arms.map((a) => `${a.kind},${a.hw},${a.dir[0]},${a.dir[1]},${a.len}`).join(";")}` : ""}`,
    )
    .join("|");
export const roadItems: ReadonlySignal<ModelItem[]> = computed(() => {
  const list = chains.value;
  const g = roads.value;
  const state = edgeState.value;
  if (!list || !g || !state) return lastItems;
  const built = list.filter((ch) => ch.state === "built");
  const junctions = roadJunctions(g, (e) => state.of(e) === "built");
  const nodes = new Set(junctions.map((j) => j.node));
  const out: ModelItem[] = built.map((ch) => ({
    id: `road${ch.id}`,
    ring: ch.nodes.map((id): [number, number] => [g.nodes[id].x, g.nodes[id].y]),
    height: 0,
    kind: ch.kind,
    progress: 1,
    style: "road",
    ends: [nodes.has(ch.nodes[0]), nodes.has(ch.nodes[ch.nodes.length - 1])],
  }));
  for (const j of junctions)
    out.push({ id: `junction${j.node}`, ring: [j.p], height: 0, kind: j.arms[0].kind, progress: 1, style: "junction", junction: j });
  const sig = itemSig(out);
  if (sig !== lastSig) {
    lastSig = sig;
    lastItems = out;
  }
  return lastItems;
});

// Chains under construction (active, waiting, cut) as lines: `kind`, `w` (real width, m) and `state`. Built chains are
// 3D only, so they are left out; a built edge being rebuilt adds its new kind as a line over it, as construction does.
// The same collection comes back while no line changed: work on a road moves its progress every tick, not its line.
const NO_LINES: FeatureCollection = { type: "FeatureCollection", features: [] };
let lines = NO_LINES;
let linesSig = "[]";
export const roadLines: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  const g = roads.value;
  const list = chains.value;
  const state = edgeState.value;
  if (!f || !g || !list || !state) return NO_LINES;
  const features: Feature[] = list
    .filter((ch) => ch.state !== "built")
    .map((ch) => ({
      type: "Feature",
      properties: { id: ch.id, kind: ch.kind, w: ROAD_KINDS[ch.kind].width, state: ch.state },
      geometry: { type: "LineString", coordinates: ch.nodes.map((id) => f.toLngLat(g.nodes[id].x, g.nodes[id].y)) },
    }));
  for (const e of Object.values(g.edges)) {
    if (!e.upgrade || e.done < e.labor) continue;
    const [a, b] = [g.nodes[e.a], g.nodes[e.b]];
    features.push({
      type: "Feature",
      properties: { id: e.id, kind: e.upgrade.kind, w: ROAD_KINDS[e.upgrade.kind].width, state: state.active.has(e.id) ? "active" : "waiting" },
      geometry: { type: "LineString", coordinates: [f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y)] },
    });
  }
  const sig = JSON.stringify(features);
  if (sig !== linesSig) {
    linesSig = sig;
    lines = { type: "FeatureCollection", features };
  }
  return lines;
});
