// Per-tick cost of the sim in the worker: build a town through the real Handler + commands (lib.ts), then play many
// game days and measure handler.tick(now) — the call worker.ts makes every POLL_MS (250 ms).
//
//   npx vitest run perf/bench/sim/tick.test.ts --reporter=verbose
//   SIM_B=1000 SIM_DAYS=60 SIM_TICKS=288 SIM_RUNS=5 npx vitest run perf/bench/sim/tick.test.ts --reporter=verbose
import { it, expect } from "vitest";
import { makeCity, median, pct, ms, bytes, dayHour, table, timeIt } from "./lib";
import { BASE_TICK, POLL_MS, tickMs, advanceTo } from "../../../src/sim/clock";
import { toSnapshot } from "../../../src/sim/handler";
import { snapshotDelta, applyDelta, type Posted } from "../../../src/sim/delta";
import { computeLife } from "../../../src/sim/life";
import { produceStep, dailyEconomy, economyStats } from "../../../src/sim/production";
import { productionScales, dailyStep, immigrationStep, peopleStats, freeHomes, rebalanceJobs } from "../../../src/sim/people";
import { dailyServices, refreshServices, serviceStats } from "../../../src/sim/coverage";
import { jobReport } from "../../../src/sim/jobReport";
import { weatherStep } from "../../../src/sim/weather";
import { researchStep, researchView } from "../../../src/sim/research";
import { settleStores } from "../../../src/sim/storage";
import { settleLevers, callBlock } from "../../../src/sim/leverCmds";
import { recordChronicle } from "../../../src/sim/chronicle";
import { advanceClearings } from "../../../src/sim/growth";
import { eveningStep } from "../../../src/sim/evening";
import { daySummary } from "../../../src/sim/summary";
import { digInfos } from "../../../src/sim/excavation";
import { museumStaff } from "../../../src/sim/museum";
import { govView } from "../../../src/sim/government";
import { fieldProgress } from "../../../src/sim/fields";
import { dayOf } from "../../../src/sim/time";
import type { SimState } from "../../../src/sim/types";

const SIZE = Number(process.env.SIM_B ?? 500);
const DAYS = Number(process.env.SIM_DAYS ?? 40);
const TICKS = Number(process.env.SIM_TICKS ?? 288); // ticks per measuring run (2 game days)
const RUNS = Number(process.env.SIM_RUNS ?? 5);
const WEATHER = process.env.SIM_WEATHER === "1";

// A state whose identity-keyed caches (memo.ts, workersByJob, storeSet, roadNet) hold nothing: a phase timed on it does
// the work a real tick does, not the work an earlier call already cached.
const cold = (s: SimState): SimState => ({ ...s, buildings: { ...s.buildings }, residents: { ...s.residents }, households: { ...s.households }, roads: { ...s.roads } });

it("tick cost of the worker sim", async () => {
  const city = await makeCity({ buildings: SIZE, growDays: DAYS, settlersPerDay: 2, weather: WEATHER });
  const counts = city.counts();
  console.log(`town: ${counts.buildings} buildings (${counts.houses} houses, ${counts.workplaces} workplaces), ${counts.residents} residents, ${counts.households} households, ${counts.edges} road edges, ${counts.cells} lot cells`);
  console.log(`tick = ${BASE_TICK} game minutes; at 1x one tick falls due every ${tickMs(0, { speed: 1, offline: false })} ms wall, worker polls every ${POLL_MS} ms (worker.ts:59)`);

  city.tick(60); // warm-up: JIT, caches, a settled day
  const warm = city.counts();

  // ----- every tick of many game days, classified by what the tick does -----
  const all: number[] = [];
  const work: number[] = [];
  const evening: number[] = [];
  const night: number[] = [];
  const at22: number[] = [];
  const atMidnight: number[] = [];
  const msgMark = city.msgs.length;
  for (let r = 0; r < RUNS; r++) {
    for (let i = 0; i < TICKS; i++) {
      const g0 = city.sim().gameMinutes;
      const h = dayHour(g0).hour;
      const t = performance.now();
      city.tick(1);
      const dt = performance.now() - t;
      const crossedMidnight = dayOf(city.sim().gameMinutes) !== dayOf(g0);
      const hourNow = Math.floor((city.sim().gameMinutes + 360) / 60) % 24;
      const crossed22 = !crossedMidnight && h < 22 && hourNow >= 22;
      all.push(dt);
      if (crossedMidnight) atMidnight.push(dt);
      else if (crossed22) at22.push(dt);
      else if (h >= 7 && h < 19) work.push(dt);
      else if (h >= 19 && h < 22) evening.push(dt);
      else night.push(dt);
    }
  }
  const windowMsgs = city.msgs.slice(msgMark);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const nTicks = RUNS * TICKS;
  const nSnap = windowMsgs.filter((m) => m.t === "snapshot").length;
  const nLife = windowMsgs.filter((m) => m.t === "life").length;
  console.log("\n## handler.tick(now): ms per tick (one tick per call, 1x)\n");
  console.log(
    table(
      ["tick class", "n", "median", "p95", "max"],
      [
        ["all ticks", all.length, ms(median(all)), ms(pct(all, 0.95)), ms(Math.max(...all))],
        ["work hours 07-19 (roads, crews, production)", work.length, ms(median(work)), ms(pct(work, 0.95)), ms(Math.max(...work))],
        ["evening 19-22 (evening crafts)", evening.length, ms(median(evening)), ms(pct(evening, 0.95)), ms(Math.max(...evening))],
        ["night 22-07 (no work)", night.length, ms(median(night)), ms(pct(night, 0.95)), ms(Math.max(...night))],
        ["tick crossing 22:00 (+ daySummary)", at22.length, ms(median(at22)), ms(pct(at22, 0.95)), ms(Math.max(...at22))],
        ["tick crossing 00:00 (+ daily chain)", atMidnight.length, ms(median(atMidnight)), ms(pct(atMidnight, 0.95)), ms(Math.max(...atMidnight))],
      ],
    ),
  );
  const dayMean = mean(all);
  console.log(`\nper game day: 144 ticks, mean ${ms(dayMean)} ms/tick → ${ms(dayMean * 144)} ms of sim work per game day (median ${ms(median(all))} ms/tick)`);
  console.log(`messages in the measured window: ${nSnap} snapshots (${(nSnap / nTicks).toFixed(2)} per tick), ${nLife} life (${((nLife * 144) / nTicks).toFixed(1)} per game day)`);
  console.log(`after measurement: ${JSON.stringify(city.counts())} (warm ${JSON.stringify(warm)})`);

  // ----- phase attribution: the exported domain entry points, timed on a cold copy of the real state -----
  const s = city.sim();
  const REPS = 9;
  const t = (fn: () => unknown) => median(timeIt(fn, REPS));
  const rows: (string | number)[][] = [];
  const put = (name: string, fn: () => unknown, note = "") => rows.push([name, ms(t(fn)), note]);
  put("produceStep (production.ts:195)", () => produceStep(cold(s), BASE_TICK / 60, productionScales(cold(s))), "work-hours tick");
  put("  of which productionScales → artel (people.ts:314)", () => productionScales(cold(s)), "also called by produceStep");
  put("eveningStep (evening.ts)", () => eveningStep(cold(s), BASE_TICK / 60), "evening tick");
  put("immigrationStep (people.ts:807)", () => immigrationStep(cold(s), BASE_TICK), "every tick");
  put("settleStores (storage.ts:262)", () => settleStores(cold(s)), "every tick");
  put("settleLevers (leverCmds.ts:196)", () => settleLevers(cold(s)), "every tick");
  put("recordChronicle (chronicle.ts:30)", () => recordChronicle(cold(s), cold(s)), "every tick");
  put("advanceClearings (growth.ts:316)", () => advanceClearings(cold(s), new Map()), "every tick");
  put("weatherStep (weather.ts)", () => weatherStep(cold(s), BASE_TICK), "every tick");
  put("researchStep (research.ts)", () => researchStep(cold(s), BASE_TICK), "every tick");
  put("refreshServices (coverage.ts:145)", () => refreshServices(cold(s)), "a road/workplace opens");
  put("rebalanceJobs (people.ts:629)", () => rebalanceJobs(cold(s)), "a road/workplace opens, and daily");
  put("dailyEconomy — midnight (production.ts:397)", () => dailyEconomy(cold(s)), "1 tick in 144");
  put("dailyStep people — midnight (people.ts:635)", () => dailyStep(cold(s)), "1 tick in 144");
  put("dailyServices — midnight (coverage.ts:180)", () => dailyServices(cold(s)), "1 tick in 144");
  put("daySummary — 22:00 (summary.ts:31)", () => daySummary(cold(s)), "1 tick in 144");
  put("computeLife — new game day (life.ts:64)", () => computeLife(cold(s), dayOf(s.gameMinutes)), "posted on a new day / new family");
  put("toSnapshot (handler.ts:50)", () => toSnapshot(cold(s)), "every published tick");
  console.log("\n## phase cost on the same city (median of 9, cold caches), ms\n");
  console.log(table(["phase", "ms", "when"], rows));

  const tickTokers = ["immigrationStep (people.ts:807)", "settleStores (storage.ts:262)", "settleLevers (leverCmds.ts:196)", "recordChronicle (chronicle.ts:30)", "advanceClearings (growth.ts:316)", "weatherStep (weather.ts)", "researchStep (research.ts)"];
  const sumEvery = rows.filter((r) => tickTokers.includes(String(r[0]))).reduce((a, r) => a + Number(r[1]), 0);
  const dailyNames = ["dailyEconomy — midnight (production.ts:397)", "dailyStep people — midnight (people.ts:635)"];
  const sumDaily = rows.filter((r) => dailyNames.includes(String(r[0]))).reduce((a, r) => a + Number(r[1]), 0);
  console.log(`\nsum of the every-tick phases: ${ms(sumEvery)} ms (cold); the midnight chain alone: ${ms(sumDaily)} ms..${ms(sumDaily + Number(rows.find((r) => String(r[0]).startsWith("dailyServices"))![1]))} ms, i.e. ${ms((sumDaily + Number(rows.find((r) => String(r[0]).startsWith("dailyServices"))![1])) / 144)} ms/tick amortised`);
  console.log(`observed: work-hour tick ${ms(median(work))} ms, night tick ${ms(median(night))} ms, midnight tick ${ms(median(atMidnight))} ms → the daily chain costs ${ms(median(atMidnight) - median(night))} ms in that tick`);

  // ----- what toSnapshot itself spends: its pieces, on the live state -----
  const live = city.sim();
  const snapPieces: (string | number)[][] = [];
  const piece = (name: string, fn: () => unknown) => snapPieces.push([name, ms(median(timeIt(fn, REPS)))]);
  piece("peopleStats (people.ts:376)", () => peopleStats(live));
  piece("economyStats (production.ts:609)", () => economyStats(live));
  piece("serviceStats (coverage.ts:224)", () => serviceStats(live));
  piece("jobReport (jobReport.ts:8)", () => jobReport(live));
  piece("digInfos (excavation.ts:93)", () => digInfos(live));
  piece("callBlock → freeHomes (leverCmds.ts:159)", () => callBlock(live));
  piece("freeHomes ×2 (people.ts:209)", () => freeHomes(live.buildings, live.households, live.incoming));
  piece("researchView (research.ts:150)", () => researchView(live));
  piece("fieldProgress (fields.ts:256)", () => fieldProgress(live));
  piece("museumStaff (museum.ts:176)", () => museumStaff(live));
  piece("govView (government.ts:357)", () => govView(live));
  console.log("\n## toSnapshot's pieces (median of 9), ms\n");
  console.log(table(["piece", "ms"], snapPieces));

  // ----- how much of a tick is the step (clock.ts:step) and how much is the posting: handler.tick and a shadow
  // advanceTo() replayed off the same state sequence, tick by tick -----
  let shadow: SimState = city.sim();
  const handlerMs: number[] = [];
  const stepMs: number[] = [];
  const handlerMidnight: number[] = [];
  const stepMidnight: number[] = [];
  for (let i = 0; i < 300; i++) {
    const before = city.sim();
    const h = dayHour(before.gameMinutes).hour;
    const tA = performance.now();
    city.tick(1);
    handlerMs.push(performance.now() - tA);
    // the same tick, computed again from the shadow's copy of the same state (pure: it returns a new state)
    const tB = performance.now();
    shadow = advanceTo(shadow, city.now, { speed: 1, offline: false });
    stepMs.push(performance.now() - tB);
    const crossed = dayOf(shadow.gameMinutes) !== dayOf(before.gameMinutes);
    if (crossed) {
      handlerMidnight.push(handlerMs[handlerMs.length - 1]);
      stepMidnight.push(stepMs[stepMs.length - 1]);
    }
    void h;
  }
  console.log("\n## the tick split: sim step vs posting (300 ticks, medians)\n");
  console.log(
    table(
      ["part", "median ms", "share of the tick"],
      [
        ["handler.tick(now) — everything (handler.ts:530)", ms(median(handlerMs)), "100 %"],
        ["advanceTo → clock.step (the rules)", ms(median(stepMs)), `${((median(stepMs) / median(handlerMs)) * 100).toFixed(0)} %`],
        ["the rest: toSnapshot + snapshotDelta + life + persist", ms(median(handlerMs) - median(stepMs)), `${(((median(handlerMs) - median(stepMs)) / median(handlerMs)) * 100).toFixed(0)} %`],
        ["midnight tick, everything", ms(median(handlerMidnight)), ""],
        ["midnight tick, the rules alone", ms(median(stepMidnight)), ""],
      ],
    ),
  );

  // ----- snapshots on the wire, replayed exactly as handler.postSnapshot (handler.ts:309-312) does them -----
  const posted: Posted = { snap: toSnapshot(city.sim()), text: {} };
  const snapMs: number[] = [];
  const deltaBytes: number[] = [];
  for (let i = 0; i < 60; i++) {
    city.tick(1);
    const t0 = performance.now();
    const snap = toSnapshot(city.sim());
    const d = snapshotDelta(posted, snap);
    snapMs.push(performance.now() - t0);
    deltaBytes.push(JSON.stringify({ t: "snapshot", sim: d }).length);
    if (d.zones) deltaBytes[i] += JSON.stringify(d.zones).length; // posted with the message when zones.rev moved
  }
  const cloneSaveSamples = timeIt(() => structuredClone(city.h["save"]), 3); // what an IndexedDB put costs the browser
  const cloneSaveMs = cloneSaveSamples.length > 0 ? median(cloneSaveSamples) : NaN;
  const full = toSnapshot(city.sim());
  const fullBytes = JSON.stringify({ t: "loaded", save: { version: 4, city: { name: "Bench" }, sim: full } }).length;
  const cloneMs = median(timeIt(() => structuredClone({ t: "snapshot", sim: snapshotDelta({ snap: full, text: {} }, full) }), 9));
  const clientMs = median(timeIt(() => applyDelta(full, { gameMinutes: 1, realTime: 1 }), 9));
  console.log("\n## snapshot on the wire\n");
  console.log(
    table(
      ["item", "value"],
      [
        ["snapshot messages per game day", "144 — one per tick that advances the clock (handler.ts:530-545)"],
        ["snapshot interval at 1x", `${tickMs(0, { speed: 1, offline: false })} ms wall (tickMs, clock.ts:57)`],
        ["snapshot interval at 4x (day / night)", `${tickMs(12 * 60, { speed: 4, offline: false })} / ${tickMs(23 * 60, { speed: 4, offline: false })} ms (night boost 4, clock.ts:37)`],
        ["full snapshot (the \"loaded\" message)", bytes(fullBytes)],
        ["a tick's delta message: median", bytes(median(deltaBytes))],
        ["a tick's delta message: max", bytes(Math.max(...deltaBytes))],
        ["toSnapshot + snapshotDelta per tick (handler.ts:309-312)", `${ms(median(snapMs))} ms`],
        ["structuredClone of a one-tick message", `${ms(cloneMs)} ms`],
        ["applyDelta on the client (delta.ts:78)", `${ms(clientMs)} ms`],
      ],
    ),
  );
  console.log(`the snapshot path is ${((median(snapMs) / median(all)) * 100).toFixed(0)} % of a median tick`);

  // delta.ts:19 DERIVED — the 14 parts that are rebuilt for every snapshot and compared by JSON text (delta.ts:68)
  const DERIVED = ["digs", "people", "economy", "services", "houseMood", "houseGoods", "houseResidents", "research", "fieldProgress", "heritageMul", "callBlock", "inflow", "museumStaff", "govView"] as const;
  const textMs = median(timeIt(() => { for (const k of DERIVED) JSON.stringify((full as unknown as Record<string, unknown>)[k]); }, 9));
  let derivedBytes = 0;
  for (const k of DERIVED) derivedBytes += JSON.stringify((full as unknown as Record<string, unknown>)[k]).length;
  console.log(`delta.ts: the JSON text of the ${DERIVED.length} derived parts is ${bytes(derivedBytes)}, and stringifying them costs ${ms(textMs)} ms per published tick`);

  // ----- a command's fixed cost: every command posts a snapshot and writes the whole save (handler.ts:486) -----
  const cheap: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now();
    await city.send({ type: "setJobPriority", group: "build", priority: (i % 3) as 1 | 2 | 3 });
    cheap.push(performance.now() - t0);
  }
  const stroke: number[] = [];
  const edges = Object.keys(city.sim().roads.edges).map(Number).slice(-6);
  for (const id of edges.slice(0, 4)) {
    const e = city.sim().roads.edges[id];
    const t0 = performance.now();
    await city.send({ type: "placeStroke", template: "izba", spans: [{ edge: id, side: 1, from: 0, to: e.length }] });
    stroke.push(performance.now() - t0);
  }
  console.log(
    table(
      ["player action (a command)", "median ms"],
      [
        ["setJobPriority — the fixed cost (snapshot + persist, handler.ts:429-490)", ms(median(cheap))],
        ["placeStroke on one road edge", ms(median(stroke))],
        ["… the same with a real IndexedDB put (+ structuredClone of the save)", `+${ms(cloneSaveMs)} ms`],
      ],
    ),
  );



  expect(median(all)).toBeGreaterThan(0);
  expect(nSnap).toBeGreaterThan(0);
  expect(median(atMidnight)).toBeGreaterThan(median(night));
}, 900_000);
