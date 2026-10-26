import type { RoadEdge, RoadGraph, RoadKind } from "../sim/types";

export type RoadState = "built" | "active" | "waiting" | "cut";

export interface RoadChain {
  id: number; // id of the first edge, for pointers/debugging
  kind: RoadKind;
  state: RoadState;
  nodes: number[]; // ordered along the chain; a loop repeats its first node at the end
}

// Joins consecutive edges of the same kind and state into one polyline, so the renderer draws a smooth
// bend instead of a row of separate straight features. A node where the road branches or changes kind
// ends the chain: that is where the graph splits edges anyway.
export function roadChains(g: RoadGraph, stateOf: (e: RoadEdge) => RoadState): RoadChain[] {
  const keyOf = (e: RoadEdge) => `${e.kind}|${stateOf(e)}`;
  const adj = new Map<string, Map<number, number[]>>();
  for (const e of Object.values(g.edges)) {
    const k = keyOf(e);
    let m = adj.get(k);
    if (!m) {
      m = new Map();
      adj.set(k, m);
    }
    for (const n of [e.a, e.b]) {
      const list = m.get(n);
      if (list) list.push(e.id);
      else m.set(n, [e.id]);
    }
  }

  const used = new Set<number>();
  // Walks away from `start` through nodes where exactly one other edge of the same key is unused.
  const walk = (start: number, from: number, k: string): number[] => {
    const res: number[] = [];
    const m = adj.get(k);
    let node = start;
    let prev = from;
    for (;;) {
      const options = (m?.get(node) ?? []).filter((id) => id !== prev && !used.has(id));
      if (options.length !== 1) break;
      const id = options[0];
      used.add(id);
      const e = g.edges[id];
      node = e.a === node ? e.b : e.a;
      prev = id;
      res.push(node);
    }
    return res;
  };

  const out: RoadChain[] = [];
  for (const e of Object.values(g.edges)) {
    if (used.has(e.id)) continue;
    const k = keyOf(e);
    used.add(e.id);
    const left = walk(e.a, e.id, k);
    const right = walk(e.b, e.id, k);
    out.push({ id: e.id, kind: e.kind, state: stateOf(e), nodes: [...left.reverse(), e.a, e.b, ...right] });
  }
  return out;
}