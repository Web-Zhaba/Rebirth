// A realistic town for the UI benchmarks: raised through the real Handler (as src/pace/pace.run.ts does) on a flat
// synthetic site, then played so the snapshot carries real roads, residents, fields, finds and history.
// Nothing here touches src/; the harness only drives the public Handler API.
import { applyDelta } from "../../../src/sim/delta";
import { Handler, type Storage } from "../../../src/sim/handler";
import type { Cmd, FromWorker } from "../../../src/sim/protocol";
import { segmentCost, type TerrainProfile } from "../../../src/sim/roads";
import type { StrokeSpan } from "../../../src/sim/stroke";
import { emptyWeather } from "../../../src/sim/weather";
import type { ClientState, City, Site } from "../../../src/sim/types";
import { DIG } from "../../../src/sim/excavation";
import { canPlace } from "../../../src/sim/growth";
import { BUILDINGS } from "../../../src/sim/buildings";

export const T0 = 1_800_000_000_000;
export const STEP_MS = 2500; // fake wall time per tick, i.e. one game tick at 1× (10 game minutes × 250 ms) // fake wall time per h.tick(): about one worker interval at 1x
const mem: Storage = { get: async () => null, put: async () => {}, clear: async () => {} };
const NONE: Site = { forest: 0, water: 0, rock: 0 };

export interface Town {
  /** The town as the last snapshot left it (a getter: it moves on with the ticks). */
  readonly st: ClientState;
  city: City;
  h: Handler;
  now: number;
  /** Replays `n` worker ticks and returns the snapshot messages the worker would have posted. */
  ticks: (n: number, stepMs?: number) => unknown[];
  failures: string[];
  notes: string[];
  count: () => { buildings: number; active: number; pop: number; edges: number; fields: number; residents: number; digs: number };
}

const flat = (len: number): TerrainProfile => {
  const n = Math.max(1, Math.round(len / 10));
  return { length: len, land: Array<"meadow">(n).fill("meadow"), elev: Array<number>(n + 1).fill(0) };
};

/** A deterministic pseudo-random source: the same town on every run, so the numbers can be compared. */
export function rng(seed = 12345): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function buildTown(opts: { road?: number; days?: number; housePasses?: number; seed?: number } = {}): Promise<Town> {
  const roadLength = opts.road ?? 4000;
  const days = opts.days ?? 300;
  const passes = opts.housePasses ?? 3;
  const rand = rng(opts.seed ?? 12345);
  let st!: ClientState;
  const results = new Map<number, { ok: boolean; reason?: string }>();
  const collected: unknown[] = [];
  const post = (m: FromWorker) => {
    if (m.t === "loaded" && m.save) st = m.save.sim;
    else if (m.t === "snapshot") {
      st = { ...applyDelta(st, m.sim), zones: m.zones ?? st.zones, chronicle: m.chronicle ?? st.chronicle, finds: m.finds ?? st.finds, articles: m.articles ?? st.articles };
      collected.push(m);
    } else if (m.t === "cmdResult") results.set(m.id, m);
    else if (m.t === "error") throw new Error(m.message);
  };
  let now = T0;
  const h = new Handler(mem, post, async () => ({ land: "meadow", slope: 0 }), async () => 200);
  await h.handle({ t: "found", city: { name: "Тест", lat: 59.12, lng: 37.9, foundedAt: T0 }, now });
  h["save"]!.sim.weather = emptyWeather();
  let seq = 0;
  const city = h["save"]!.city;
  const failures: string[] = [];
  const notes: string[] = [];
  const send = async (cmd: Cmd): Promise<boolean> => {
    const id = ++seq;
    await h.handle({ t: "cmd", id, cmd });
    await h.idle();
    const r = results.get(id);
    if (!r?.ok) failures.push(`${cmd.type}${cmd.type === "placeBuilding" ? `:${(cmd as unknown as { template?: string }).template}` : ""}: ${r?.reason ?? "no result"}`);
    return r?.ok ?? false;
  };
  const admin = (op: Record<string, unknown>) => send({ type: "admin", op } as unknown as Cmd);
  // The first lot of `template` the rules accept, as the player's own placement does (sim/growth.ts canPlace).
  const placeOne = async (template: string): Promise<boolean> => {
    const t = BUILDINGS[template];
    const site: Site = { forest: 0.6, water: 0.3, rock: 0.5 };
    const cells = st.zones.cells.filter((c) => c.depth === 0).sort((a, b) => a.cx - b.cx);
    for (const c of cells) {
      if (!canPlace(st, t, c.edge, c.side, c.i, site).ok) continue;
      return send({ type: "placeBuilding", template, edge: c.edge, side: c.side, i: c.i, site } as unknown as Cmd);
    }
    return false;
  };

  // One straight road east, 50 m segments: the ground every building stands on.
  const pts: [number, number][] = [[0, 0]];
  for (let x = 50; x <= roadLength; x += 50) pts.push([x, 0]);
  const labor = pts.slice(1).map((p, i) => segmentCost(flat(p[0] - pts[i][0]), "path").labor);
  await send({ type: "addRoad", kind: "path", pts, snapTol: 6, labor });
  // The admin free mode finishes whatever is started: the same town without playing the build out.
  await admin({ k: "free", on: true });

  let spans: StrokeSpan[] = [];
  const spansOf = (): StrokeSpan[] => {
    const out: StrokeSpan[] = [];
    for (const e of Object.values(st.roads.edges)) {
      const a = st.roads.nodes[e.a];
      const b = st.roads.nodes[e.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      out.push({ edge: e.id, side: 1, from: 0, to: len });
      out.push({ edge: e.id, side: -1, from: 0, to: len });
    }
    return out;
  };
  // The town's buildings first, on the ground they need: the rows of houses fill every front lot left.
  await admin({ k: "unlock" });
  for (const t of ["townhall", "gumno", DIG.template, "well", "woodcutter"]) notes.push(`${t}: ${(await placeOne(t)) ? "placed" : "no lot"}`);
  // Rows of houses along the whole road: one stroke plans every free lot it finds, so a few calls raise a whole town.
  for (let pass = 0; pass < passes; pass++) {
    spans = spansOf();
    for (const t of ["izba", "izba5"]) await send({ type: "placeStroke", template: t, spans, drop: [] });
  }
  for (const t of ["weaver", "smithy", "carpentry", "shop", "tavern"]) {
    spans = spansOf();
    await send({ type: "placeStroke", template: t, spans, drop: [] });
  }
  await admin({ k: "finish" });

  // The old city under the town, read from the tile data by the client in the real game and sent here as finds.
  const dig = Object.values(st.buildings).find((b) => b.template === DIG.template && b.state === "active") ?? Object.values(st.buildings).find((b) => b.template === DIG.template);
  if (dig) {
    const cx = dig.lot.cx;
    const cy = dig.lot.cy;
    const foundations = Array.from({ length: 120 }, (_, i) => {
      const x = cx - 200 + rand() * 400;
      const y = cy - 200 + rand() * 400;
      const w = 8 + rand() * 14;
      const h = 6 + rand() * 10;
      return { id: `f${i}`, ring: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] as [number, number][], area: Math.round(w * h), height: 3 + Math.round(rand() * 15) };
    });
    const pois = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: `Место ${i}`, cls: i % 3 === 0 ? "temple" : i % 3 === 1 ? "manor" : "shop", x: cx - 300 + rand() * 600, y: cy - 300 + rand() * 600 }));
    const streets = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      name: `Улица ${i}`,
      lines: [Array.from({ length: 6 }, (_, k) => [cx - 300 + k * 60, cy - 250 + i * 8 + rand() * 4] as [number, number])],
    }));
    const features = Array.from({ length: 80 }, (_, i) => ({
      id: `fe${i}`,
      kind: (["seeds", "parts", "rails", "bucket", "number", "sign"] as const)[i % 6],
      x: cx - 300 + rand() * 600,
      y: cy - 300 + rand() * 600,
      name: `Находка ${i}`,
    }));
    const ok = await send({ type: "recordFinds", digId: dig.id, foundations, pois, streets, features } as unknown as Cmd);
    notes.push(`recordFinds into dig ${dig.id} (${dig.state}): ${ok ? "ok" : "failed"}`);
  }
  await admin({ k: "finish" });
  // A government of the town: the head, the orders and the daily records (the town hall window reads them).


  // A field north of the road and a clearing south of it: the land layer has something to draw.
  await send({ type: "addField", pts: [[60, 40], [160, 40], [160, 240], [60, 240]] } as unknown as Cmd);
  await send({ type: "addField", pts: [[300, 40], [400, 40], [400, 240], [300, 240]] } as unknown as Cmd);
  await send({ type: "addClearing", pts: [[80, -150], [130, -150], [130, -50], [80, -50]], forest: 0.8 } as unknown as Cmd);

  // Play: families move in, the fields are sown, the chronicle and the history fill.
  const ticks = (n: number, stepMs = STEP_MS) => {
    collected.length = 0;
    for (let k = 0; k < n; k++) {
      now += stepMs;
      h.tick(now);
    }
    return collected.slice();
  };
  for (let d = 0; d < days; d++) {
    ticks(144); // 144 ticks of 10 game minutes = one game day at 1x
    if (d % 10 === 0) await admin({ k: "stock" }); // a fed town grows; without the grants the stores run out
  }

  // The government, once the hall has stood for a while: a form and a head (the town hall window reads them).
  const form = await send({ type: "setGovForm", form: "monarchy" } as unknown as Cmd);
  notes.push(`setGovForm: ${form ? "ok" : "failed"}`);
  const people = st.govView?.choice?.people ?? [];
  if (form && people.length) {
    const head = await send({ type: "chooseHead", id: people[0].id } as unknown as Cmd);
    notes.push(`chooseHead: ${head ? "ok" : "failed"}`);
    ticks(2);
  }

  const count = () => {
    const list = Object.values(st.buildings);
    let residents = 0;
    for (const hh of Object.values(h["save"]!.sim.households)) residents += hh.members.length;
    return {
      buildings: list.length,
      active: list.filter((b) => b.state === "active").length,
      pop: st.people.pop,
      edges: Object.keys(st.roads.edges).length,
      fields: st.zones.fields.length,
      residents,
      digs: st.digs.length,
    };
  };
  return {
    get st() {
      return st;
    },
    city,
    h,
    get now() {
      return now;
    },
    ticks,
    count,
    failures,
    notes,
  };

  function firstLot() {
    const cells = st.zones.cells.filter((c) => c.depth === 0).sort((a, b) => a.cx - b.cx);
    const c = cells[Math.floor(cells.length * 0.3)];
    return { edge: c?.edge ?? 0, side: (c?.side ?? 1) as 1 | -1, i: c?.i ?? 0, site: NONE };
  }
}
