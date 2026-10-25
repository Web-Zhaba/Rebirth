import { it } from "vitest";
import { BUILDINGS } from "../sim/buildings";
import { calendar } from "../sim/clock";
import { canPlace } from "../sim/growth";
import { vacantHouses } from "../sim/people";
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
  const paint = (what: string, zone: "res" | "craft" | "trade", keep: (c: ZoneCell) => boolean) => {
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
  // A sensible player puts the materials workshop at the front of the artel's queue, ahead of the houses already planned.
  const placeFirst = async (template: string, side: 1 | -1, x: number) => {
    if (!(await place(template, side, x))) return false;
    const id = Object.values(st.buildings).find((b) => b.template === template)?.id;
    return id === undefined ? false : send(`priority: ${template}`, { type: "setPriority", key: id });
  };
  const roadBuilt = (x: number) => Object.values(st.roads.edges).every((e) => e.done >= e.labor || Math.min(st.roads.nodes[e.a].x, st.roads.nodes[e.b].x) > x);
  const houses = () => Object.values(st.buildings).filter(isFinishedHouse).length;
  const unlocked = (key: string) => st.goals.unlocks.includes(key);
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
    if (houses() < 4) return; // the first four houses come first (the sowing window reaches into summer)
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
    // a sensible player puts construction first while the town is being raised
    { when: () => true, run: () => send("job priority: construction high", { type: "setJobPriority", group: "build", priority: 3 }) },
    { when: () => true, run: () => extendRoad(200) },
    { when: () => true, run: () => paint("residential zone 0-120 m", "res", (c) => c.cx <= 120 && c.zone === "none") },
    { when: () => ready(3), run: () => place("woodcutter", -1, 130, { forest: 0.6, water: 0, rock: 0 }) },
    // a sensible player waits for the goals: the sawpit comes with the 2nd izba, the craft zone with 20 m3 of logs
    { when: () => unlocked("sawpit") && roadBuilt(200), run: () => placeFirst("sawpit", -1, 140) },
    { when: () => ready(5), run: () => place("well", -1, 170) },
    { when: () => ready(3) && unlocked("zone:craft"), run: () => paint("craft zone 130-170 m", "craft", (c) => c.cx >= 130 && c.cx <= 170 && c.zone === "none" && !c.block) },
    { when: () => ready(5) && unlocked("zone:trade"), run: () => paint("trade zone 120-200 m", "trade", (c) => c.cx > 120 && c.cx <= 200 && c.zone === "none" && !c.block) },
    { when: () => ready(5), run: () => place("dig", -1, 190) },
    // 0.5 ha south of the road, forest 0.8 as measured on a real site (the synthetic land itself is meadow); after the
    // gumno, which must stand before the end of spring to sow.
    { when: () => Object.values(st.buildings).some((b) => b.template === "gumno" && b.state === "active"), run: () => send("clearing 0.5 ha", { type: "addClearing", pts: [[20, -150], [70, -150], [70, -50], [20, -50]], forest: 0.8 }) },
  ];
  const done = new Set<number>();
  let lastJobsDay = -9;
  let lastCallDay = -1;
  let jobsStretches = 0;

  // ----- milestones -----
  const marks: { label: string; hit: () => boolean; at?: { ms: number; day: number; pop: number } }[] = [
    { label: "First house finished", hit: () => houses() >= 1 },
    { label: "Goal: 20 m3 of logs (craft zone opens)", hit: () => st.goals.done.includes("logs20") },
    { label: "Goal: 2 ha sown (fisher, a family)", hit: () => st.goals.done.includes("sow2") },
    { label: "Goal: 2 izbas (sawpit, barn open)", hit: () => st.goals.done.includes("izbas2") },
    { label: "Sawpit finished", hit: () => Object.values(st.buildings).some((b) => b.template === "sawpit" && b.state === "active") },
    { label: "Gumno finished", hit: () => Object.values(st.buildings).some((b) => b.template === "gumno" && b.state === "active") },
    { label: "5 houses finished", hit: () => houses() >= 5 },
    { label: "10 houses finished", hit: () => houses() >= 10 },
    { label: "Population 25", hit: () => st.people.pop >= 25 },
    { label: "Population 50", hit: () => st.people.pop >= 50 },
    { label: "Population 100", hit: () => st.people.pop >= 100 },
    { label: "First planks made (sawpit output)", hit: () => planksMade },
    { label: "First clearing finished", hit: () => st.chronicle.some((e) => e.kind === "clearing") },
    { label: "Harvest begins (first grain reaped)", hit: () => st.events.some((e) => e.kind === "farm" && e.text.startsWith("Началась уборка")) || st.chronicle.some((e) => e.kind === "harvest") },
    { label: "First harvest finished", hit: () => st.chronicle.some((e) => e.kind === "harvest") },
  ];

  // Feed events: each one becomes a notice on the player's screen (toasts show every kind). The player's own orders
  // are left out. Seen once each, stamped with the real time (speed 1x) they appeared.
  const isNotice = (kind: string) => kind !== "order";
  const seen = new Set<string>();
  const feedAt: number[] = [];
  // Quiet stretches: real time with no new notice and no event card waiting for an answer (an open card is
  // something to decide). Each one ends at the next notice.
  const quiet: number[] = [];
  let quietSince = 0;
  let planksMade = false;
  const watch = () => {
    for (const e of st.events) {
      const key = `${e.at}|${e.kind}|${e.text}`;
      if (isNotice(e.kind) && !seen.has(key)) {
        seen.add(key);
        feedAt.push(now - T0);
        quiet.push(now - T0 - quietSince);
        quietSince = now - T0;
      }
    }
    if (st.pending) quietSince = now - T0;
    // planks are made when a sawpit has output (the houses may take them in the same tick, so the stock need not rise)
    const full = (h as unknown as { save: { sim: import("../sim/types").SimState } }).save.sim;
    if (Object.values(full.buildings).some((b) => b.template === "sawpit" && ((full.prod.today[b.id] ?? 0) > 0 || (full.prod.yesterday[b.id] ?? 0) > 0))) planksMade = true;
  };

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
    // Logs run short while sites wait: one more woodcutter per five houses (a sensible player feeds the building sites).
    const cutters = Object.values(st.buildings).filter((b) => b.template === "woodcutter").length;
    if (done.size === steps.length && st.stock.logs < BUILDINGS.izba.materials.logs && cutters > 0 && cutters < 1 + Math.floor(houses() / 5)) {
      await place("woodcutter", -1, 130, { forest: 0.6, water: 0, rock: 0 });
    }
    // A house stands empty and there are wares to pay: call settlers (the wares of the founding cart pay for two calls).
    if (st.stock.wares >= 10 && dayOf(st.gameMinutes) > lastCallDay) {
      const sim = (h as unknown as { save: { sim: import("../sim/types").SimState } }).save.sim;
      const promised = new Set(sim.incoming.map((f) => f.house));
      if (vacantHouses(sim.buildings, sim.households).some((id) => !promised.has(id))) {
        lastCallDay = dayOf(st.gameMinutes);
        await send("call settlers", { type: "callSettlers" });
      }
    }
    // Jobless adults: zone a stretch of new road for workshops, then shops (a sensible player makes jobs for the people).
    if (done.size === steps.length && st.people.unemployed >= 6 && unlocked("zone:craft") && dayOf(st.gameMinutes) >= lastJobsDay + 2) {
      lastJobsDay = dayOf(st.gameMinutes);
      const from = roadEnd;
      const zone = unlocked("zone:trade") && jobsStretches++ % 2 === 1 ? "trade" : "craft";
      await extendRoad(roadEnd + 50);
      await paint(`${zone} zone ${from}-${roadEnd} m`, zone, (c) => c.cx > from - 8 && c.zone === "none" && !c.block);
    }
    for (let k = 0; k < 6; k++) {
      now += STEP_MS;
      h.tick(now);
      watch();
      for (const m of marks) if (!m.at && m.hit()) m.at = { ms: now - T0, day: dayOf(st.gameMinutes) + 1, pop: st.people.pop };
    }
  }

  const rows = marks.map((m) => `| ${m.label} | ${m.at ? hm(m.at.ms) : "—"} | ${m.at ? m.at.day : "—"} | ${m.at ? m.at.pop : "—"} |`);
  const cal = calendar(st.gameMinutes);
  const gaps = quiet.slice(1);
  const span = feedAt.length > 1 ? feedAt[feedAt.length - 1] - feedAt[0] : 0;
  const perMin = (a: number, b: number) => (feedAt.filter((t) => t >= a && t < b).length / ((b - a) / 60_000)).toFixed(2);
  const out = [
    "| Milestone | Real time (h:mm) | Game day | Population |",
    "|---|---|---|---|",
    ...rows,
    "",
    `Notices (every feed event but the player's orders): ${feedAt.length} in ${hm(span)} -> mean gap ${feedAt.length > 1 ? Math.round(span / (feedAt.length - 1) / 1000) : "—"} s; quiet stretches (no notice, no card to answer): ${gaps.length ? Math.round((100 * gaps.filter((g) => g <= 60_000).length) / gaps.length) : "—"} % of gaps <= 60 s, 95th percentile ${gaps.length ? Math.round([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)] / 1000) : "—"} s, longest ${gaps.length ? Math.round(Math.max(...gaps) / 1000) : "—"} s; per minute: 0-30 min ${perMin(0, 1_800_000)}, 30-60 min ${perMin(1_800_000, 3_600_000)}, 1-2 h ${perMin(3_600_000, 7_200_000)}.`,
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
