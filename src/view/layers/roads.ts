import { computed, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { cutOffEdges, ROAD_KINDS, workableEdges } from "../../sim/roads";
import type { RoadEdge, RoadGraph, Stock } from "../../sim/types";
import { frame, roads, stock } from "../../simClient";
import type { ModelItem } from "../../map/modelLayer";
import { roadChains, type RoadChain, type RoadState } from "../../map/roadChains";
import { roadJunctions } from "../../map/roadJunctions";

// Roads for every renderer: chains of the graph by kind and state, the model items of the built ones (ribbons and the
// aprons where roads meet) and every chain as a line in lng/lat for the 2D drawing.

// State of every edge of the graph. Edges short of stone are not workable: they show as waiting. The stock is only
// watched while some edge owes stone.
const stockOf = (g: RoadGraph) => (Object.values(g.edges).some((e) => e.stone) ? stock.value : null);
const stateOf = (g: RoadGraph, st: Stock | null): ((e: RoadEdge) => RoadState) => {
  const active = new Set(workableEdges(g, st ?? undefined));
  const cut = cutOffEdges(g);
  return (e) => (e.done >= e.labor ? "built" : active.has(e.id) ? "active" : cut.has(e.id) ? "cut" : "waiting");
};

// Chains of the road graph by kind and state.
const chains = computed<RoadChain[] | null>(() => {
  const g = roads.value;
  return g ? roadChains(g, stateOf(g, stockOf(g))) : null;
});

// What the model layer draws of the roads: every built chain, then the aprons where roads meet (roadJunctions.ts). The
// aprons come last in the list, and the road mesh keeps that order (modelLayer.ts, one mesh drawn without depth writes),
// so an apron covers the ends of the ribbons it joins and the shoulder lines that would cross it. The same list comes
// back while no built chain changed.
let lastItems: ModelItem[] = [];
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
  if (!list || !g) return lastItems;
  const built = list.filter((ch) => ch.state === "built");
  const state = stateOf(g, stockOf(g));
  const junctions = roadJunctions(g, (e) => state(e) === "built");
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
  if (itemSig(out) !== itemSig(lastItems)) lastItems = out;
  return lastItems;
});

// Every chain as a line: `kind`, `w` (real width, m) and `state` (built, active, waiting, cut).
export const roadLines: ReadonlySignal<FeatureCollection> = computed(() => {
  const f = frame.value;
  const g = roads.value;
  const list = chains.value;
  if (!f || !g || !list) return { type: "FeatureCollection", features: [] };
  const features: Feature[] = list.map((ch) => ({
    type: "Feature",
    properties: { id: ch.id, kind: ch.kind, w: ROAD_KINDS[ch.kind].width, state: ch.state },
    geometry: { type: "LineString", coordinates: ch.nodes.map((id) => f.toLngLat(g.nodes[id].x, g.nodes[id].y)) },
  }));
  return { type: "FeatureCollection", features };
});
