import { it } from "vitest";
import { BUILDINGS } from "../sim/buildings";
import { calendar } from "../sim/clock";
import { canPlace } from "../sim/growth";
import { Handler, type Storage } from "../sim/handler";
import { isFinishedHouse } from "../sim/people";
import type { Cmd, FromWorker } from "../sim/protocol";
import { segmentCost, type TerrainProfile } from "../sim/roads";
import { dayOf } from "../sim/time";
import type { ClientState, Site, ZoneCell } from "../sim/types";

// Pacing harness (PLAN-pace.md P0): plays a fixed build order through the real Handler on a flat synthetic
// site, driving it with a fake wall clock, and reports the real time (at speed 1x) of each pacing milestone.

declare const process: { stdout: { write(s: string): void }; stderr: { write(s: string): void } }; // no @types/node in the project

const T0 = 1_800_000_000_000; // fake wall clock at founding
const CAP_DAYS = 400;
const STEP_MS = 2500; // fake wall time per h.tick(): ten worker intervals, about one tick at 1x
const NONE: Site = { forest: 0, water: 0, rock: 0 };
const mem: Storage = { get: async () => null, put: async () => {}, clear: async () => {} };

const hm = (ms: number) => `${Math.floor(ms / 3_600_000)}:${String(Math.floor(ms / 60_000) % 60).padStart(2, "0")}`;

it("pacing harness", async () => {
  let st!: ClientState;
  const results = new Map<number, { ok: boolean; reason?: string }>();
  const post = (m: FromWorker) => {
    if (m.t === "loaded" && m.save) st = m.save.sim;
    else if (m.t === "snapshot") st = { ...st, ...m.sim, zones: m.zones ?? st.zones, chronicle: m.chronicle ?? st.chronicle };
    else if (m.t === "cmdResult") results.set(m.id, m);
    else if (m.t === "error") throw new Error(m.message);
  };
  // Flat meadow: no network, no slopes, no water.
  const h = new Handler(mem, post, async () => ({ land: "meadow", slope: 0 }));
  await h.handle({ t: "found", city: { name: "Тест", lat: 59.12, lng: 37.9, foundedAt: T0 }, now: T0 });

  let now = T0;
  let seq = 0;
  const log: string[] = [];
  const stamp = () => `${hm(now - T0)} d${dayOf(st.gameMinutes) + 1}`;
  const send = async (what: string, cmd: Cmd) => {
    const id = ++seq;
    await h.handle({ t: "cmd", id, cmd });
    await h.idle(); // terrain of new cells is sampled
    const r = results.get(id)!;
    log.push(`${stamp()}  ${r.ok ? "ok  " : "FAIL"}  ${what}${r.ok ? "" : ` (${r.reason})`}`);
    return r.ok;
  };

  // ----- the same pieces the UI uses -----
  const flat = (len: number): TerrainProfile => {
    const n = Math.max(1, Math.round(len / 10)); // PROFILE_STEP
    return { length: len, land: Array<"meadow">(n).fill("meadow"), elev: Array<number>(n + 1).fill(0) };
  };
  let roadEnd = 0;
  const extendRoad = (to: number) => {
    const pts: [number, number][] = [];
    for (let x = roadEnd; x < to; x += 50) pts.push([x, 0]);
    pts.push([to, 0]);
    const labor = pts.slice(1).map((p, i) => segmentCost(flat(p[0] - pts[i][0]), "path").labor);
    roadEnd = to;
    return send(`path to ${to} m`, { type: "addRoad", kind: "path", pts, snapTol: 6, labor });
  };
  const paint = (what: string, zone: "res" | "craft", keep: (c: ZoneCell) => boolean) => {
    const keys = st.zones.cells.filter(keep).map((c) => c.key);
    return send(`${what} (${keys.length} cells)`, { type: "paintZones", keys, zone });
  };
  // First lot of `template` at or east of x on the given side of the road (side 1 = north), if one can be built now.
  const lotFor = (template: string, side: 1 | -1, x: number, site: Site = NONE) => {
    const t = BUILDINGS[template];
    const starts = st.zones.cells.filter((c) => c.depth === 0 && c.side === side && c.cx >= x).sort((a, b) => a.cx - b.cx);
    return starts.find((c) => canPlace(st, t, c.edge, c.side, c.i, site).ok);
  };
  const place = (template: string, side: 1 | -1, x: number, site: Site = NONE) => {
    const c = lotFor(template, side, x, site);
    if (c) return send(`${template} at x=${Math.round(c.cx)}`, { type: "placeBuilding", template, edge: c.edge, side: c.side, i: c.i, site });
    log.push(`${stamp()}  FAIL  ${template}: no lot east of x=${x}`);
    return Promise.resolve(false);
  };
  const roadBuilt = (x: number) => Object.values(st.roads.edges).every((e) => e.done >= e.labor || Math.min(st.roads.nodes[e.a].x, st.roads.nodes[e.b].x) > x);
  const houses = () => Object.values(st.buildings).filter(isFinishedHouse).length;
  const ready = (n: number) => houses() >= n && roadBuilt(200);
  // Out of lots: residential demand has asked for a house for a whole game day and none has appeared.
  let resCount = 0;
  let resSince = 0;
  const outOfLots = () => {
    const n = Object.values(st.buildings).filter((b) => b.zone === "res").length;
    if (n !== resCount || st.people.demand.res < 1) {
      resCount = n;
      resSince = st.gameMinutes;
    }
    return st.gameMinutes - resSince >= 1440;
  };

  // Fields of 2 ha (100 x 200 m, 4 m apart) north of the road, in slots 0, +1, -1, +2, ... east and west of the first one.
  const FIELD_SLOTS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
  const fieldBox = (k: number): [number, number][] => {
    const x0 = 60 + 104 * FIELD_SLOTS[k];
    return [[x0, 40], [x0 + 100, 40], [x0 + 100, 240], [x0, 240]];
  };
  const gumnos: number[] = []; // x of the farmsteads that stand
  let fields = 0;
  // The first field and its gumno as soon as there is built road for the gumno; then 2 ha more per 2 finished houses,
  // with a new gumno when the field lies beyond the reach of every one placed.
  const tillMore = async () => {
    while (fields < Math.min(FIELD_SLOTS.length, 1 + Math.floor(houses() / 2))) {
      const cx = 110 + 104 * FIELD_SLOTS[fields];
      const near = gumnos.some((gx) => Math.hypot(gx - cx, 150) < 330);
      const gx = Math.max(30, cx - 60);
      if (!near && !lotFor("gumno", -1, gx)) return; // wait for built road to put the farmstead on
      const k = fields++;
      if (!near && (await place("gumno", -1, gx))) gumnos.push(gx);
      await send(`field ${k + 1} (2 ha)`, { type: "addField", pts: fieldBox(k) });
    }
  };

  // ----- build order: short list of steps, each fired once when its trigger holds -----
  const steps: { when: () => boolean; run: () => Promise<unknown> }[] = [
    { when: () => true, run: () => extendRoad(200) },
    { when: () => true, run: () => paint("residential zone 0-120 m", "res", (c) => c.cx <= 120 && c.zone === "none") },
    { when: () => roadBuilt(200), run: () => place("woodcutter", -1, 130, { forest: 0.6, water: 0, rock: 0 }) },
    { when: () => ready(1), run: () => place("sawpit", -1, 140) },
    { when: () => ready(2), run: () => place("well", -1, 170) },
    { when: () => ready(3), run: () => paint("craft zone 130-170 m", "craft", (c) => c.side === 1 && c.cx >= 130 && c.cx <= 170 && !c.block) },
    { when: () => ready(3), run: () => place("dig", -1, 190) },
    // 0.5 ha south of the road, forest 0.8 as measured on a real site (the synthetic land itself is meadow).
    { when: () => roadBuilt(200), run: () => send("clearing 0.5 ha", { type: "addClearing", pts: [[20, -150], [70, -150], [70, -50], [20, -50]], forest: 0.8 }) },
  ];
  const done = new Set<number>();

  // ----- milestones -----
  const marks: { label: string; hit: () => boolean; at?: { ms: number; day: number; pop: number } }[] = [
    { label: "First house finished", hit: () => houses() >= 1 },
    { label: "Sawpit finished", hit: () => Object.values(st.buildings).some((b) => b.template === "sawpit" && b.state === "active") },
    { label: "Gumno finished", hit: () => Object.values(st.buildings).some((b) => b.template === "gumno" && b.state === "active") },
    { label: "5 houses finished", hit: () => houses() >= 5 },
    { label: "10 houses finished", hit: () => houses() >= 10 },
    { label: "Population 25", hit: () => st.people.pop >= 25 },
    { label: "Population 50", hit: () => st.people.pop >= 50 },
    { label: "Population 100", hit: () => st.people.pop >= 100 },
    { label: "First clearing finished", hit: () => st.chronicle.some((e) => e.kind === "clearing") },
    { label: "First harvest", hit: () => st.chronicle.some((e) => e.kind === "harvest") },
  ];

  const started = Date.now();
  while (dayOf(st.gameMinutes) < CAP_DAYS && marks.some((m) => !m.at)) {
    for (let i = 0; i < steps.length; i++) {
      if (!done.has(i) && steps[i].when()) {
        done.add(i);
        await steps[i].run();
      }
    }
    await tillMore();
    // The zone ran out of lots: lengthen the road and zone the new stretch.
    if (done.size === steps.length && outOfLots()) {
      const from = roadEnd;
      await extendRoad(roadEnd + 50);
      await paint(`residential zone ${from}-${roadEnd} m`, "res", (c) => c.cx > from - 8 && c.zone === "none" && !c.block);
    }
    for (let k = 0; k < 6; k++) {
      now += STEP_MS;
      h.tick(now);
      for (const m of marks) if (!m.at && m.hit()) m.at = { ms: now - T0, day: dayOf(st.gameMinutes) + 1, pop: st.people.pop };
    }
  }

  const rows = marks.map((m) => `| ${m.label} | ${m.at ? hm(m.at.ms) : "—"} | ${m.at ? m.at.day : "—"} | ${m.at ? m.at.pop : "—"} |`);
  const cal = calendar(st.gameMinutes);
  const out = [
    "| Milestone | Real time (h:mm) | Game day | Population |",
    "|---|---|---|---|",
    ...rows,
    "",
    `End: game day ${dayOf(st.gameMinutes) + 1} (year ${cal.year}), ${houses()} houses finished, population ${st.people.pop}, road ${roadEnd} m.`,
    "",
    "Build log:",
    ...log.map((l) => `- ${l}`),
    "",
  ];
  process.stdout.write(out.join("\n") + "\n");
  process.stderr.write(`(${((Date.now() - started) / 1000).toFixed(1)} s wall time)\n`);
});
