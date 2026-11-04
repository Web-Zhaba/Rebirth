import { isBridge } from "../sim/roads";
import type { RoadEdge, RoadGraph, RoadKind } from "../sim/types";

export type RoadState = "built" | "active" | "waiting" | "cut";

export interface RoadChain {
  id: number; // id of the first edge, for pointers/debugging
  kind: RoadKind;
  state: RoadState;
  nodes: number[]; // ordered along the chain; a loop repeats its first node at the end
}

// A chain of edges in different states: the least finished one (a bridge stands only once all of it is built).
const RANK: Record<RoadState, number> = { built: 0, cut: 1, waiting: 2, active: 3 };

// Joins consecutive edges of the same kind and state into one polyline, so the renderer draws a smooth
// bend instead of a row of separate straight features. A node where the road branches or changes kind
// ends the chain: that is where the graph splits edges anyway.
// A bridge is one chain from bank to bank whatever the state of its pieces, since its deck is laid between the ends of
// its chain (groundSeat.ts): it carries straight on where another bridge crosses it, and stands only once all built.
export function roadChains(g: RoadGraph, stateOf: (e: RoadEdge) => RoadState): RoadChain[] {
  const keyOf = (e: RoadEdge) => (isBridge(e.kind) ? e.kind : `${e.kind}|${stateOf(e)}`);
  const dirOf = (id: number, from: number): [number, number] => {
    const e = g.edges[id];
    const p = g.nodes[from];
    const q = g.nodes[e.a === from ? e.b : e.a];
    const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return [(q.x - p.x) / l, (q.y - p.y) / l];
  };
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
      const all = m?.get(node) ?? [];
      const options = all.filter((id) => id !== prev && !used.has(id));
      let id = options[0];
      if (options.length !== 1) {
        // a bridge crossing another of its kind (four arms) goes on along the arm straight ahead
        if (options.length === 0 || !isBridge(g.edges[prev].kind) || all.length !== 4) break;
        const [ix, iy] = dirOf(prev, node);
        const straight = (o: number) => {
          const [ox, oy] = dirOf(o, node);
          return ix * ox + iy * oy; // -1: straight on
        };
        id = options.reduce((p, q) => (straight(q) < straight(p) ? q : p));
        if (straight(id) > -0.7) break;
      }
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
    const nodes = [...left.reverse(), e.a, e.b, ...right];
    let state = stateOf(e);
    if (isBridge(e.kind)) {
      for (let i = 0; i + 1 < nodes.length; i++) {
        const id = (adj.get(k)?.get(nodes[i]) ?? []).find((x) => {
          const o = g.edges[x];
          return (o.a === nodes[i] && o.b === nodes[i + 1]) || (o.b === nodes[i] && o.a === nodes[i + 1]);
        });
        if (id !== undefined && RANK[stateOf(g.edges[id])] > RANK[state]) state = stateOf(g.edges[id]);
      }
    }
    out.push({ id: e.id, kind: e.kind, state, nodes });
  }
  return out;
}