// Save and load cost of the worker sim: the save object's size, the JSON and structured-clone serialisation, and the
// price of a cold load (parseSave + the handler's settle: cells, services, jobs).
//
//   npx vitest run perf/bench/sim/saveload.test.ts --reporter=verbose
//   SIM_B=1000 SIM_DAYS=60 npx vitest run perf/bench/sim/saveload.test.ts --reporter=verbose
import { it, expect } from "vitest";
import { makeCity, mem, median, ms, bytes, table, timeIt, T0 } from "./lib";
import { Handler } from "../../../src/sim/handler";
import { parseSave } from "../../../src/sim/save";
import type { FromWorker } from "../../../src/sim/protocol";
import type { SaveV4 } from "../../../src/sim/types";
import { regenerateCells } from "../../../src/sim/zones";
import { refreshServices } from "../../../src/sim/coverage";
import { rebalanceJobs, syncPeople } from "../../../src/sim/people";
import { reconcile } from "../../../src/sim/growth";
import { toSnapshot } from "../../../src/sim/handler";

const SIZE = Number(process.env.SIM_B ?? 500);
const DAYS = Number(process.env.SIM_DAYS ?? 40);

it("save and load cost", async () => {
  const city = await makeCity({ buildings: SIZE, growDays: DAYS, settlersPerDay: 2 });
  city.tick(30);
  const save = city.h["save"] as SaveV4;
  const c = city.counts();
  console.log(`town: ${c.buildings} buildings, ${c.residents} residents, ${c.households} households, ${c.edges} road edges, ${c.cells} lot cells`);

  const json = JSON.stringify(save);
  const jsonMs = median(timeIt(() => JSON.stringify(save), 5));
  const strBytes = json.length;
  const cloneSave = median(timeIt(() => structuredClone(save), 5));
  const parsed = JSON.parse(json) as unknown;
  const parseJsonMs = median(timeIt(() => JSON.parse(json), 5));
  const parseSaveMs = median(timeIt(() => parseSave(parsed, T0 + 10_000_000), 5));

  // the whole load, as the worker does it: storage.get -> parseSave -> settle -> post the town
  const loadStorage = { ...mem, get: async () => parsed };
  const loadTimes: number[] = [];
  let loadedBytes = 0;
  for (let i = 0; i < 3; i++) {
    const msgs: FromWorker[] = [];
    const h = new Handler(loadStorage, (m) => msgs.push(m), async () => ({ land: "meadow", slope: 0 }), async () => 200);
    const t0 = performance.now();
    await h.handle({ t: "load", legacy: null, now: T0 + 10_000_000 });
    loadTimes.push(performance.now() - t0);
    await h.idle();
    const loaded = msgs.find((m) => m.t === "loaded");
    if (loaded && loaded.t === "loaded" && loaded.save) loadedBytes = JSON.stringify(loaded.save).length;
  }

  // what the payload is made of
  const parts: (string | number)[][] = [];
  const sim = save.sim as unknown as Record<string, unknown>;
  for (const k of Object.keys(sim)) {
    const v = sim[k];
    const size = JSON.stringify(v)?.length ?? 0;
    if (size > 500) parts.push([k, bytes(size), `${((size / strBytes) * 100).toFixed(1)} %`]);
  }
  parts.sort((a, b) => Number(String(b[1]).replace(/[^\d.]/g, "")) - Number(String(a[1]).replace(/[^\d.]/g, "")));

  console.log("\n## save()\n");
  console.log(
    table(
      ["item", "value"],
      [
        ["JSON of the whole SaveV4", bytes(strBytes)],
        ["JSON.stringify", `${ms(jsonMs)} ms`],
        ["structuredClone of the save (what IndexedDB does on put)", `${ms(cloneSave)} ms`],
        ["save object entries: buildings / residents / households / roads.edges / cells", `${c.buildings} / ${c.residents} / ${c.households} / ${c.edges} / ${c.cells}`],
        ["when it happens", "every 10 s of ticking (PERSIST_MS, handler.ts:41) and after every command (handler.ts:484-490, finishCommand)"],
      ],
    ),
  );
  console.log("\n## the save payload by part\n");
  console.log(table(["part", "size", "share"], parts));

  console.log("\n## load()\n");
  console.log(
    table(
      ["item", "value"],
      [
        ["JSON.parse of the raw save", `${ms(parseJsonMs)} ms`],
        ["parseSave (validation + migrations, save.ts:635)", `${ms(parseSaveMs)} ms`],
        ["Handler.handle({t:\"load\"}) end to end (parse + settle + snapshot)", `${ms(median(loadTimes))} ms (${loadTimes.map((x) => x.toFixed(1)).join(" / ")})`],
        ["the \"loaded\" message the main thread receives", bytes(loadedBytes)],
      ],
    ),
  );

  // where the 35 ms of a cold load goes: cells, services, jobs, the snapshot
  const sim0 = (parseSave(parsed, T0 + 10_000_000) as SaveV4).sim;
  const cellsMs = median(timeIt(() => regenerateCells(sim0.roads, sim0.zones.fields, sim0.zones.terrain), 5));
  const buildMs = median(timeIt(() => reconcile(sim0.buildings, sim0.roads), 5));
  const peopleMs = median(timeIt(() => syncPeople(sim0), 5));
  const jobsMs = median(timeIt(() => rebalanceJobs(sim0), 5));
  const covMs = median(timeIt(() => refreshServices(sim0), 5));
  const snapMs = median(timeIt(() => toSnapshot(sim0), 5));
  const clientJson = JSON.stringify({ t: "loaded", save: { version: 4, city: save.city, sim: { ...toSnapshot(sim0), zones: sim0.zones, chronicle: sim0.chronicle, finds: sim0.finds, articles: sim0.articles } } });
  const clientClone = median(timeIt(() => structuredClone({ t: "loaded", save: { version: 4, city: save.city, sim: { ...toSnapshot(sim0), zones: sim0.zones, chronicle: sim0.chronicle, finds: sim0.finds, articles: sim0.articles } } }), 3));
  console.log("\n## where a cold load's time goes (handler.settle, handler.ts:245)\n");
  console.log(
    table(
      ["step", "ms"],
      [
        ["regenerateCells (zones.ts:236) — every lot cell of the town", ms(cellsMs)],
        ["reconcile (growth.ts:355)", ms(buildMs)],
        ["syncPeople (people.ts:848)", ms(peopleMs)],
        ["rebalanceJobs (people.ts:629) — the whole hiring", ms(jobsMs)],
        ["refreshServices (coverage.ts:145) — coverage + land value", ms(covMs)],
        ["toSnapshot (handler.ts:29)", ms(snapMs)],
        ["the \"loaded\" message: JSON", `${bytes(clientJson.length)}`],
        ["the \"loaded\" message: structuredClone", `${ms(clientClone)} ms`],
      ],
    ),
  );

  expect(strBytes).toBeGreaterThan(1000);
  expect(median(loadTimes)).toBeGreaterThan(0);
}, 900_000);
