// Cost of the UI's pure view models on one realistic snapshot, and how it grows with the town.
// Run: npx vitest run perf/bench/ui/models.test.ts --reporter=verbose
import { it } from "vitest";
import { applyDelta, snapshotDelta, type Posted } from "../../../src/sim/delta";
import { BUILDINGS } from "../../../src/sim/buildings";
import type { ClientState } from "../../../src/sim/types";
import { buildMenuTools, lifeOf } from "./shared";
import { loadFixture, table, time, withBuildings, type Timing } from "./fixture";
import * as topbar from "../../../src/ui/topbarModel";
import * as townhall from "../../../src/ui/townhallModel";
import * as market from "../../../src/ui/marketModel";
import * as museum from "../../../src/ui/museumModel";
import * as heritage from "../../../src/ui/heritageModel";
import * as finds from "../../../src/ui/findsModel";
import * as notebook from "../../../src/ui/notebookLogic";
import * as places from "../../../src/ui/placesModel";
import * as tech from "../../../src/ui/techModel";
import * as weather from "../../../src/ui/weatherModel";
import * as warning from "../../../src/ui/warningModel";
import * as inspector from "../../../src/ui/inspectorModel";
import * as follow from "../../../src/ui/followModel";
import * as resource from "../../../src/ui/resourceModel";
import * as coords from "../../../src/ui/coordsModel";
import * as research from "../../../src/ui/researchStatusModel";
import * as jobs from "../../../src/ui/jobsModel";
import * as badge from "../../../src/map/badgeModel";

it("pure view models: cost of one call on a real snapshot", async () => {
  const f = await loadFixture();
  const st = f.state;
  const b = Object.values(st.buildings);
  const activeHouse = b.find((x) => x.state === "active" && x.zone === "res")!;
  const workplace = b.find((x) => x.state === "active" && BUILDINGS[x.template]?.jobs)!;
  const clearing = st.clearings[0];
  const life = lifeOf(st.people.pop);
  const levers = st.levers;
  const stations: [string, () => unknown][] = [
    ["topbar.warnings", () => topbar.warnings({ food: st.stock.food, eco: st.economy, builders: st.people.builders, queue: 12, logs: st.stock.logs, building: 3, needs: st.people.needs })],
    ["topbar.roadQueue (80 edges)", () => topbar.roadQueue(st.roads)],
    ["topbar.foodNet", () => topbar.foodNet(st.economy)],
    ["topbar.perDay+deltaDir+tons", () => [topbar.perDay(21, "kg"), topbar.deltaDir(-3), topbar.tons(1600)]],
    ["topbar.dayPhase+pad", () => [topbar.dayPhase(9), topbar.pad(7)]],
    ["weather.weatherChip", () => weather.weatherChip(st.weather, 1, st.economy)],
    ["weather.effectLines", () => weather.effectLines(st.weather, st.economy)],
    ["weather.workFactorText (1 building)", () => weather.workFactorText(workplace.template, st.weather)],
    ["warning.freshWarnings", () => warning.freshWarnings(new Set(["famine"]), topbar.warnings({ food: 0, eco: st.economy, builders: 0, queue: 3, logs: 0, building: 2, needs: st.people.needs }))],
    ["warning.governmentWarning", () => warning.governmentWarning(st.gov, st.govView)],
    ["townhall.effectChips", () => townhall.effectChips(st.govView?.effect ?? {})],
    ["townhall.chartOf (77 rows)", () => townhall.chartOf(st.history, "pop", 260, 120)],
    ["townhall.rowAt", () => townhall.rowAt(st.history, 0.5, 260)],
    ["market.marketView", () => market.marketView(st.progress, levers.trade, st.economy.trade, st.economy.traders)],
    ["museum.museumView", () => museum.museumView({ finds: st.finds, buildings: st.buildings, articles: st.articles, museumStaff: st.museumStaff ?? {} })],
    ["heritage.buildHeritageView", () => heritage.buildHeritageView({ site: st.finds.foundations[0], sim: st, mul: st.heritageMul, articles: st.articles })],
    ["heritage.buildOutlineView", () => heritage.buildOutlineView(st.finds.foundations[0], st)],
    ["finds.findsView", () => finds.findsView({ finds: st.finds, buildings: st.buildings, articles: st.articles })],
    ["notebook.findsToEntries", () => notebook.findsToEntries(st.finds, st.digs.map((d) => d.id))],
    ["notebook.newestFirst (chronicle 111)", () => notebook.newestFirst(st.chronicle)],
    ["notebook.formatDate", () => notebook.formatDate(st.chronicle[0].at)],
    ["places.placesView", () => places.placesView(st)],
    ["tech.buildTechView", () => tech.buildTechView({ progress: st.progress, research: st.research, pop: st.people.pop, seen: null })],
    ["tech.eraProgress", () => tech.eraProgress(st.people.pop, st.progress)],
    ["tech.modifierLines+opensOf", () => tech.modifierLines(undefined)],
    ["inspector.buildingStatus", () => inspector.buildingStatus(activeHouse, null, false)],
    ["inspector.clearingView", () => inspector.clearingView(clearing)],
    ["inspector.OUTPUT lookup", () => inspector.OUTPUT.food],
    ["jobs.jobNotes", () => jobs.jobNotes(st.people.jobs)],
    ["research.researchStatusView", () => research.researchStatusView("Земледелие", 0.42, ["Кузнечное дело"])],
    ["follow.residentPlace (life of 222)", () => follow.residentPlace(life.trips, life.rests, 7, 600)],
    ["follow.followStatus", () => follow.followStatus(null, { walk: null, place: null })],
    ["resource.signedDaily + coords", () => [resource.signedDaily(-3, "кг"), coords.formatCoordinates(59.12, 37.9)]],
    ["buildMenu.toolInfo × every tool", () => buildMenuTools()],
    ["buildMenu.toolLabel × every tool", () => buildMenuTools().length],
    ["badge.badgeFor × 481 buildings (1/s)", () => { let n = 0; for (const x of b) if (badge.badgeFor(x, null, levers)) n++; return n; }],
    ["Object.values(buildings) (481)", () => Object.values(st.buildings)],
    ["Object.values(roads.edges) (80)", () => Object.values(st.roads.edges)],
    ["JSON.stringify(snapshot) 700 KB", () => JSON.stringify(st).length],
  ];
  const rows: Timing[] = stations.map(([name, fn]) => time(name, fn, { samples: 9 }));
  table(rows);
  console.log(
    "\nms per call. The snapshot carries",
    b.length,
    "buildings,", st.people.pop, "residents,", Object.keys(st.roads.edges).length, "road edges,", st.finds.foundations.length,
    "foundations,", st.finds.streets.length, "old streets,", st.finds.features.length, "features,", st.chronicle.length, "chronicle entries,", st.history.length, "history rows;",
    JSON.stringify(st).length, "bytes as JSON",
  );
}, 300000);

it("how each model grows with the town", async () => {
  const f = await loadFixture();
  const sizes = [120, 240, 480, 960, 1920];
  const pick: [string, (st: ClientState) => unknown][] = [
    ["topbar.roadQueue", (st) => topbar.roadQueue(st.roads)],
    ["finds.findsView", (st) => finds.findsView({ finds: st.finds, buildings: st.buildings, articles: st.articles })],
    ["museum.museumView", (st) => museum.museumView({ finds: st.finds, buildings: st.buildings, articles: st.articles, museumStaff: st.museumStaff ?? {} })],
    ["places.placesView", (st) => places.placesView(st)],
    ["Object.values(buildings)", (st) => Object.values(st.buildings)],
    ["count building sites", (st) => Object.values(st.buildings).filter((x) => x.state === "building").length],
    ["tech.buildTechView", (st) => tech.buildTechView({ progress: st.progress, research: st.research, pop: st.people.pop, seen: null })],
  ];
  console.log(`buildings${sizes.map((n) => String(n).padStart(12)).join("")}`);
  for (const [name, fn] of pick) {
    const line: string[] = [];
    for (const n of sizes) {
      const st = withBuildings(f, n);
      line.push(time(name, () => fn(st), { samples: 7 }).median.toFixed(4).padStart(12));
    }
    console.log(`${name}${line.join("")}`);
  }
}, 300000);

it("placesView is quadratic in the old city: streets × features", async () => {
  const f = await loadFixture();
  const base = f.state;
  const line = (streetCount: number, featureCount: number): string => {
    const streets = Array.from({ length: streetCount }, (_, i) => ({
      id: `s${i}`,
      name: `Улица ${i}`,
      lines: [Array.from({ length: 6 }, (_, k) => [k * 40, i * 7] as [number, number])],
    }));
    const features = Array.from({ length: featureCount }, (_, i) => ({ id: `n${i}`, kind: "number" as const, x: i * 3, y: i * 5 }));
    const st = { ...base, finds: { ...base.finds, streets, features, foundations: [] } };
    return time(`streets ${streetCount} × features ${featureCount}`, () => places.placesView(st as ClientState), { samples: 7 }).median.toFixed(3);
  };
  console.log("streets  features   placesView ms");
  for (const [s, f2] of [[10, 20], [20, 40], [40, 80], [80, 160], [160, 320]] as [number, number][]) console.log(`${String(s).padEnd(9)}${String(f2).padEnd(11)}${line(s, f2)}`);
}, 300000);

it("the snapshot pipeline: worker diff and main-thread apply", async () => {
  const f = await loadFixture();
  // Real consecutive states, as the worker walks them tick by tick.
  const states: ClientState[] = [f.state];
  for (const d of f.deltas) {
    const prev = states[states.length - 1];
    const m = d as { sim: Parameters<typeof applyDelta>[1] & { zones?: ClientState["zones"] } };
    states.push({ ...applyDelta(prev, m.sim), zones: (m as unknown as { zones?: ClientState["zones"] }).zones ?? prev.zones });
  }
  let i = 0;
  const posted: Posted = { snap: states[0], text: {} };
  const worker = time("snapshotDelta (worker, per tick)", () => {
    i = (i + 1) % (states.length - 1);
    posted.snap = states[i];
    return snapshotDelta(posted, states[i + 1]);
  }, { samples: 9, reps: 10 });
  const main = time("applyDelta (main thread, per snapshot)", () => {
    i = (i + 1) % (states.length - 1);
    return applyDelta(states[i], (f.deltas[i] as { sim: Parameters<typeof applyDelta>[1] }).sim);
  }, { samples: 9, reps: 20 });
  table([worker, main]);
  const sizes = f.deltas.slice(0, 20).map((d) => JSON.stringify(d).length);
  console.log("\ndelta message sizes, bytes: first", sizes[0], "median", sizes.sort((a, b) => a - b)[10], "max", sizes[sizes.length - 1]);
  const emptyish = f.deltas.filter((d) => JSON.stringify(d).length < 200).length;
  console.log("deltas under 200 bytes:", emptyish, "of", f.deltas.length);

  const { setState, readUiSignals } = await import("./signals");
  const c = await setState(f);
  const read = time("read every UI signal after one snapshot", () => readUiSignals(c), { samples: 9, reps: 20 });
  table([read]);
}, 300000);
