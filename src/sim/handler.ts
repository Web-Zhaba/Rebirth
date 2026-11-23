import { houseGoods, refreshServices, serviceStats } from "./coverage";
import { finishAll, grantStock, nextEra, reveal, unlockAll } from "./admin";
import { advanceTo, tickFraction, tickMs, type Pace, type Speed } from "./clock";
import { BUILDINGS } from "./buildings";
import { overTerrain } from "./clearing";
import { scarcity } from "./heritage";
import { applyStroke, planStroke, roadSpans } from "./stroke";
import { museumStaff } from "./museum";
import { researchView } from "./research";
import { govView, seatActive } from "./government";
import { callBlock, setFormCmd } from "./leverCmds";
import { jobReport } from "./jobReport";
import { digInfos } from "./excavation";
import { computeLife } from "./life";
import { snapshotDelta, type Posted } from "./delta";
import { emptyGrowth, reconcile, seedOf } from "./growth";
import { freeHomes, peopleStats, queryBuilding, queryResident, rebalanceJobs, syncPeople } from "./people";
import { inflowPerDay } from "./attraction";
import type { Cmd, FromWorker, ToWorker } from "./protocol";
import { economyStats, productionInfo } from "./production";
import { SERVICES, isService } from "./services";
import { emptyRoads, kindsChanged } from "./roads";
import { migrateLegacy, parseCity, parseSave } from "./save";
import { dayOf } from "./time";
import { startWeather, type WeatherState } from "./weather";
import { fieldProgress } from "./fields";
import type { BuildingQuery, ChronicleEntry, ClientSave, Finds, RoadHouses, SaveV4, SimSnapshot, SimState, StoredArticle, TerrainInfo } from "./types";
import { emptyZones, pendingKeys, qpoint, regenerateCells } from "./zones";
import { applyCmd, finite, rezone } from "./commands";
import { makeFrame, type Frame } from "../world/frame";
import { L } from "../i18n";

export interface Storage {
  get(): Promise<unknown>;
  put(save: SaveV4): Promise<void>;
  clear(): Promise<void>;
  // Stores a pre-migration save once per version, never overwriting an earlier copy.
  keepOld?(raw: unknown, version: number): Promise<void>;
}

const PERSIST_MS = 10_000; // wall ms between saves while ticking
const WEATHER_SITE_WAIT_MS = 3000;
const MAX_GAP_MS = 70_000; // a longer gap between ticks (a sleeping device) is dropped: time away is never played back
const HIDDEN_SLOW_MS = 5 * 60_000; // a tab hidden this long runs at the slower hidden-tab rate

// Errors go to the console of the main thread, which cannot see the worker's stack: send it along.
const errorText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));

// What the main thread sees: aggregates instead of individual residents.
export function toSnapshot(sim: SimState): SimSnapshot {
  const { zones: _z, chronicle: _c, residents: _r, households: _h, nextPersonId: _p, nextHouseholdId: _n, prod: _pr, finds: _f, articles: _a, ...rest } = sim;
  const houseMood: Record<number, number> = {}; // the mean of the families of a house
  const houseResidents: Record<number, number> = {};
  const families: Record<number, number> = {};
  for (const h of Object.values(sim.households)) {
    if (h.home === null) continue;
    const n = (families[h.home] ?? 0) + 1;
    families[h.home] = n;
    houseMood[h.home] = ((houseMood[h.home] ?? 0) * (n - 1) + h.mood) / n;
    houseResidents[h.home] = (houseResidents[h.home] ?? 0) + h.members.length;
  }
  for (const id in houseMood) houseMood[id] = Math.round(houseMood[id]);
  const houseGoodsShare = Object.fromEntries(houseGoods(sim.households));
  const ps = peopleStats(sim);
  const free = freeHomes(sim.buildings, sim.households, sim.incoming).length;
  const underway = Object.values(sim.buildings).filter((b) => b.zone === "res" && b.state !== "active").length;
  return { ...rest, people: { ...ps, housing: { tents: ps.tents, free, underway }, jobs: jobReport(sim) }, economy: economyStats(sim), services: serviceStats(sim), houseMood, houseGoods: houseGoodsShare, houseResidents, digs: digInfos(sim), callBlock: callBlock(sim), inflow: inflowNow(sim), research: researchView(sim), heritageMul: scarcity(sim.finds), fieldProgress: fieldProgress(sim), museumStaff: museumStaff(sim), govView: govView(sim) };
}

// The inflow the town draws right now: its free homes and the families a day they bring (attraction.ts).
function inflowNow(sim: SimState): SimSnapshot["inflow"] {
  const free = freeHomes(sim.buildings, sim.households, sim.incoming).length;
  return { free, perDay: inflowPerDay(sim.attraction, free) };
}

// Who lives or works in a building, with production details for producers.
function inspect(sim: SimState, id: number): BuildingQuery | null {
  const q = queryBuilding(sim, id);
  if (q?.kind === "workplace") {
    const b = sim.buildings[id];
    const production = productionInfo(sim, b);
    if (production) q.production = production;
    if (isService(b.template)) {
      const stats = serviceStats(sim);
      const staffed = BUILDINGS[b.template].jobs === 0 || q.workers.length > 0;
      q.service = { id: b.template, reach: SERVICES[b.template].reach, covered: stats.covered[b.template], houses: stats.houses, pupils: stats.pupils, seats: stats.seats, working: b.state === "active" && staffed };
    }
  }
  return q;
}

const toClientSave = (save: SaveV4, snap: SimSnapshot): ClientSave => ({ version: 4, city: save.city, sim: { ...snap, zones: save.sim.zones, chronicle: save.sim.chronicle, finds: save.sim.finds, articles: save.sim.articles } });
const ENRICH_BATCH = 32;
const ENRICH_RETRY_MS = 30_000;

// Looks up land type and slope at a local point. Injected so tests need no network.
export type TerrainSampler = (frame: Frame, x: number, y: number) => Promise<TerrainInfo>;

// Ground elevation in meters at a point. Injected so tests need no network; none means 0 m.
export type ElevationSampler = (lng: number, lat: number) => Promise<number>;

export class Handler {
  private save: SaveV4 | null = null;
  private posted: Posted | null = null; // the snapshot the main thread already has; snapshot messages carry what differs
  private postedRev = -1; // zones rev the main thread already has
  private postedChronicle: ChronicleEntry[] | null = null; // the chronicle array the main thread already has
  private postedFinds: Finds | null = null;
  private postedArticles: StoredArticle[] | null = null;
  private busy = false; // loading, founding or resetting: other messages wait in `queue`
  private queue: ToWorker[] = [];
  private allowFound = true; // the worker only opens a session after acquiring the save lock
  private writes = Promise.resolve();
  private saveFailed = false;
  private enriching: Promise<void> | null = null;
  private failed = new Set<string>(); // qkeys that could not be sampled; retried later
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // What the main thread's visual life was drawn from: the game day, the families on their way, the residents (their
  // jobs, homes and classes) and the levers (work hours, toloka); a change in any of them draws it anew.
  private lifeFrom: { day: number } & Pick<SimState, "incoming" | "residents" | "levers"> | null = null;
  private speed: Speed = 1; // session setting
  private pausedFraction = 0; // how much of the tick in progress had run when the game was paused
  private free = false; // admin: whatever is started finishes at once; session setting
  private hiddenAt: number | null = null; // wall time the tab was hidden
  private persistedAt = 0; // wall time of the last save by tick()

  constructor(
    private storage: Storage,
    private post: (msg: FromWorker) => void,
    private sampler?: TerrainSampler,
    private elevation?: ElevationSampler,
  ) {}

  // The weather of a town: its site (elevation sampled once; 0 m when that fails) and the spin-up before `t`.
  private async weatherFor(city: SaveV4["city"], t: number, sampled?: number): Promise<WeatherState> {
    let elev = finite(sampled) ? sampled : 0;
    if (!finite(sampled) && this.elevation) {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const fallback = new Promise<number>((resolve) => {
          timeout = setTimeout(() => resolve(0), WEATHER_SITE_WAIT_MS);
        });
        const e = await Promise.race([this.elevation(city.lng, city.lat), fallback]);
        if (finite(e)) elev = e;
      } catch {
        // Use the default elevation when the terrain cannot be read.
      } finally {
        clearTimeout(timeout);
      }
    }
    return startWeather({ lat: city.lat, lng: city.lng, elev, seed: seedOf(city.foundedAt), phase: city.lat < 0 ? 0.5 : 0 }, t);
  }

  // Resolves when no terrain enrichment is running (for tests).
  async idle(): Promise<void> {
    while (this.enriching) await this.enriching;
  }

  async handle(msg: ToWorker): Promise<void> {
    if (this.busy) {
      this.queue.push(msg); // applied, in order, when the load ends
      return;
    }
    try {
      switch (msg.t) {
        case "load":
          this.busy = true;
          try {
            await this.load(msg.legacy, msg.now);
          } finally {
            await this.release();
          }
          return;
        case "found": {
          const city = parseCity(msg.city);
          if (this.save || !this.allowFound || !city || !finite(msg.now) || msg.now <= 0) {
            this.post({ t: "foundFailed" });
            return;
          }
          this.busy = true;
          const save: SaveV4 = {
            version: 4,
            city,
            sim: { realTime: msg.now, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt)) },
          };
          try {
            save.sim.weather = await this.weatherFor(city, 0, msg.elevation);
            this.setSave(save);
            await this.persist(save);
            this.postLoaded(save, false);
          } finally {
            await this.release();
          }
          return;
        }
        case "query": {
          const q = msg.q;
          const data = !this.save || !q ? null : q.type === "building" ? inspect(this.save.sim, q.id) : queryResident(this.save.sim, q.id);
          this.post({ t: "queryResult", id: msg.id, data });
          return;
        }
        case "cmd":
          return await this.command(msg.id, msg.cmd);
        case "flush":
          if (this.save) await this.persist(this.save);
          return;
        case "speed":
          if (!validSpeed(msg.speed) || !finite(msg.now)) return;
          this.tick(msg.now); // up to now at the old speed; a pause then owes nothing, an unpause starts from now
          this.changeSpeed(msg.speed, msg.now);
          this.postSnapshot(); // carries the new wall-time anchor
          return;
        case "visibility":
          if (typeof msg.hidden !== "boolean" || !finite(msg.now)) return;
          if (msg.hidden) this.hiddenAt ??= msg.now;
          else this.hiddenAt = null;
          return;
        case "reset":
          this.busy = true;
          try {
            await this.writes;
            await this.storage.clear();
            this.setSave(null);
            this.allowFound = false; // reset reloads the page before a new town is founded
            this.post({ t: "resetDone" });
          } finally {
            await this.release();
          }
          return;
      }
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
      if (msg.t === "load") this.post({ t: "loadFailed", reason: "unavailable" });
      if (msg.t === "found") this.post({ t: "foundFailed" });
      if (msg.t === "reset") this.post({ t: "resetFailed" });
    }
  }

  // Ends the busy state and applies what arrived meanwhile.
  private async release(): Promise<void> {
    this.busy = false;
    while (this.queue.length > 0 && !this.busy) await this.handle(this.queue.shift()!);
  }

  // Cells are derived data: rebuild them so saves without them (or with stale ones) are consistent.
  private settle(sim: SimState): SimState {
    const z = sim.zones;
    const cells = regenerateCells(sim.roads, z.fields, z.terrain);
    return refreshServices(rebalanceJobs(syncPeople({ ...sim, zones: { ...z, cells, rev: z.rev + 1 }, buildings: reconcile(sim.buildings, sim.roads) })));
  }

  private async load(legacy: string | null, now: number): Promise<void> {
    this.allowFound = false;
    await this.writes;
    const raw = await this.storage.get();
    const version = typeof raw === "object" && raw !== null ? (raw as { version?: unknown }).version : undefined;
    const empty = raw === undefined || raw === null;
    const migrated = empty && legacy !== null;
    let save = migrated ? migrateLegacy(legacy, now) : parseSave(raw, now);
    if (!save) {
      if (!empty || migrated) {
        this.post({ t: "loadFailed", reason: "invalid", raw: migrated ? legacy : raw });
        return;
      }
      this.allowFound = true;
      this.post({ t: "loaded", save: null, migrated: false });
      return;
    }
    const needsWeather = !save.sim.weather.site;
    if (needsWeather) save = { ...save, sim: { ...save.sim, weather: await this.weatherFor(save.city, save.sim.gameMinutes) } };
    // The town waits where it was left: the time since the last save is not played back.
    save = { ...save, sim: this.settle({ ...save.sim, realTime: now }) };
    // Keep the old format until the replacement has been written successfully.
    if (version === 3) await this.storage.keepOld?.(raw, 3);
    const writesMigration = version === 3 || migrated;
    if (writesMigration) await this.storage.put(save);
    this.setSave(save);
    this.layRoadHouses();
    const ready = this.save!;
    if (ready !== save || (needsWeather && !writesMigration)) await this.persist(ready);
    this.postLoaded(ready, migrated);
    this.postLife();
    this.enrich();
  }

  // The whole town goes to the main thread; the snapshots after it carry what differs from it.
  private postLoaded(save: SaveV4, migrated: boolean): void {
    const snap = toSnapshot(save.sim);
    this.posted = { snap, text: {} };
    this.post({ t: "loaded", save: toClientSave(save, snap), migrated });
  }

  private setSave(save: SaveV4 | null): void {
    this.save = save;
    this.posted = null;
    this.postedRev = save ? save.sim.zones.rev : -1;
    this.postedChronicle = save ? save.sim.chronicle : null;
    this.postedFinds = save ? save.sim.finds : null;
    this.postedArticles = save ? save.sim.articles : null;
    this.lifeFrom = null;
    this.pausedFraction = 0;
    this.free = false;
    this.persistedAt = save?.sim.realTime ?? 0;
    this.failed.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // Carries what changed since the last message with the town in it: parts of the snapshot, the zones, the chronicle.
  private postSnapshot(): void {
    if (!this.save || !this.posted) return; // nothing to differ from before "loaded"
    const { zones, chronicle } = this.save.sim;
    const msg: Extract<FromWorker, { t: "snapshot" }> = { t: "snapshot", sim: snapshotDelta(this.posted, toSnapshot(this.save.sim)) };
    if (zones.rev !== this.postedRev) {
      this.postedRev = zones.rev;
      msg.zones = zones;
    }
    if (chronicle !== this.postedChronicle) {
      this.postedChronicle = chronicle;
      msg.chronicle = chronicle;
    }
    const { finds, articles } = this.save.sim;
    if (finds !== this.postedFinds) {
      this.postedFinds = finds;
      msg.finds = finds;
    }
    if (articles !== this.postedArticles) {
      this.postedArticles = articles;
      msg.articles = articles;
    }
    this.post(msg);
  }

  // Walkers, carts, traffic and lights for the current game day and the families on their way; cosmetic, so a failure only costs the visuals.
  private postLife(): void {
    if (!this.save) return;
    try {
      const { incoming, residents, levers } = this.save.sim;
      const day = dayOf(this.save.sim.gameMinutes);
      this.lifeFrom = { day, incoming, residents, levers };
      const { trips, rests, traffic, lights } = computeLife(this.save.sim, day);
      this.post({ t: "life", day, trips, rests, traffic, lights });
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
    }
  }

  // Samples terrain for cells still pending; results are merged and cells regenerated per batch.
  private enrich(): void {
    if (this.enriching || !this.sampler) return;
    this.enriching = this.enrichLoop().finally(() => {
      this.enriching = null;
      if (this.failed.size > 0 && !this.retryTimer) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.failed.clear();
          this.enrich();
        }, ENRICH_RETRY_MS);
      }
    });
  }

  private async enrichLoop(): Promise<void> {
    const sampler = this.sampler!;
    try {
      for (;;) {
        const save = this.save;
        if (!save) return;
        const keys = pendingKeys(save.sim.zones.cells).filter((k) => !this.failed.has(k));
        if (keys.length === 0) return;
        const session = this.posted;
        const city = save.city;
        const frame = makeFrame(city.lat, city.lng);
        for (let n = 0; n < keys.length; n += ENRICH_BATCH) {
          const got: Record<string, TerrainInfo> = {};
          const failed: string[] = [];
          await Promise.all(
            keys.slice(n, n + ENRICH_BATCH).map(async (k) => {
              const [x, y] = qpoint(k);
              try {
                got[k] = overTerrain(await sampler(frame, x, y), x, y, this.save?.sim.clearings ?? []); // cleared forest is meadow
              } catch {
                failed.push(k);
              }
            }),
          );
          while (this.busy) await new Promise((r) => setTimeout(r, 20)); // not while a load owns the state
          const cur = this.save;
          if (!cur || this.posted !== session) return; // reset or loaded another save meanwhile
          for (const k of failed) this.failed.add(k);
          if (Object.keys(got).length === 0) continue;
          const z = cur.sim.zones;
          const zones = rezone({ ...z, terrain: { ...z.terrain, ...got } }, cur.sim.roads, z.fields);
          const buildings = reconcile(cur.sim.buildings, cur.sim.roads);
          this.save = { ...cur, sim: syncPeople({ ...cur.sim, zones, buildings }) };
          this.layRoadHouses();
          this.postSnapshot();
          await this.persist(this.save);
        }
      }
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
    }
  }

  // Lays the houses of the roads drawn «с домами» whose ground is surveyed: a stroke along both sides of the new edges.
  // A request waits while a cell of its edges waits for terrain; it is dropped once laid, or when its town or edges went.
  private layRoadHouses(): void {
    const save = this.save;
    const queued = save?.roadHouses;
    if (!save || !queued?.length) return;
    let sim = save.sim;
    const keep: RoadHouses[] = [];
    for (const r of queued) {
      const edges = r.edges.filter((e) => Object.hasOwn(sim.roads.edges, e));
      if (edges.length === 0) continue;
      const on = new Set(edges);
      if (sim.zones.cells.some((c) => on.has(c.edge) && c.block === "pending")) {
        keep.push(edges.length === r.edges.length ? r : { ...r, edges });
        continue;
      }
      sim = applyStroke(sim, planStroke(sim, BUILDINGS[r.template], roadSpans(sim.roads, edges), r.only).items).sim;
    }
    if (sim !== save.sim) sim = refreshServices(syncPeople(sim));
    if (sim !== save.sim || keep.length !== queued.length || keep.some((r, i) => r !== queued[i])) {
      this.save = { ...save, sim, roadHouses: keep.length ? keep : undefined };
    }
  }

  private async command(id: number, cmd: Cmd): Promise<void> {
    const reject = (reason: string) => this.post({ t: "cmdResult", id, ok: false, reason });
    try {
      if (!this.save) return reject(L("Нет поселения", "No settlement"));
      const sim = this.save.sim;
      if (cmd.type === "setCityIdentity") {
        if (!seatActive(sim.buildings)) return reject(L("Сначала постройте ратушу", "Build a town hall first"));
        const city = parseCity({ ...this.save.city, name: cmd.name, flag: cmd.flag });
        if (!city) return reject(L("Название должно содержать от 1 до 40 знаков", "Use 1 to 40 characters for the name"));
        if (!city.flag) return reject(L("Некорректный флаг", "Invalid flag"));
        this.save = { ...this.save, city };
        this.post({ t: "cityChanged", city });
        await this.persist(this.save);
        this.post({ t: "cmdResult", id, ok: true });
        return;
      }
      if (import.meta.env.DEV && cmd.type === "admin") {
        // Production builds ship no admin panel; there this branch is compiled out and the command falls through to
        // the unknown-command rejection in commands.ts, e.g. when sent from devtools.
        const op = cmd.op;
        if (typeof op !== "object" || op === null) return reject(L("Некорректная команда", "Invalid command"));
        if (op.k === "free") {
          if (typeof op.on !== "boolean") return reject(L("Некорректная команда", "Invalid command"));
          this.free = op.on;
        } else if (op.k === "finish") this.save = { ...this.save, sim: finishAll(sim) };
        else if (op.k === "stock") this.save = { ...this.save, sim: grantStock(sim) };
        else if (op.k === "unlock") this.save = { ...this.save, sim: unlockAll(sim) };
        else if (op.k === "era") this.save = { ...this.save, sim: nextEra(sim) };
        else if (op.k === "form") {
          if (!sim.gov) return reject(L("Сначала постройте ратушу", "Build a town hall first"));
          const r = setFormCmd(sim, sim.gov.form === "monarchy" ? "republic" : "monarchy", true);
          if (!r.ok) return reject(r.reason);
          this.save = { ...this.save, sim: r.sim };
        }
        else if (op.k === "reveal") {
          const r = reveal(sim, op.x, op.y, op.r);
          if (!r.ok) return reject(r.reason);
          this.save = { ...this.save, sim: r.sim };
        } else return reject(L("Неизвестная команда", "Unknown command"));
        return await this.finishCommand(id);
      }
      // Everything a player sends applies through the domain's own rules (commands.ts); this free-finish rule and the
      // session stay here.
      const r = applyCmd(sim, cmd, this.save.roadHouses);
      if (!r.ok) return reject(r.reason);
      this.save = { ...this.save, sim: r.sim, ...(r.roads ? { roadHouses: r.roadHouses } : {}) };
      if (r.roads) this.layRoadHouses(); // the houses of the roads drawn «с домами» wait for their ground's survey
      if (r.unchanged) this.post({ t: "cmdResult", id, ok: true }); // nothing new: no save
      else await this.finishCommand(id, r.ids);
    } catch (e) {
      reject(e instanceof Error ? e.message : String(e));
    }
  }

  // Posts, persists and acknowledges a command that already changed this.save.
  private async finishCommand(id: number, ids?: number[]): Promise<void> {
    if (this.free) this.save = { ...this.save!, sim: finishAll(this.save!.sim) };
    this.postSnapshot();
    await this.persist(this.save!);
    this.post(ids ? { t: "cmdResult", id, ok: true, ids } : { t: "cmdResult", id, ok: true });
    this.enrich();
  }

  private persist(save: SaveV4): Promise<void> {
    // Opening separate IndexedDB transactions can reorder writes. Commit snapshots in the order they were taken.
    this.writes = this.writes.then(async () => {
      let failed = false;
      try {
        await this.storage.put(save);
      } catch (e) {
        failed = true;
        console.error("save:", e);
      }
      if (failed !== this.saveFailed) {
        this.saveFailed = failed;
        this.post({ t: "saveStatus", failed });
      }
    });
    return this.writes;
  }

  private pace(now: number): Pace {
    return { speed: this.speed, offline: this.hiddenAt !== null && now - this.hiddenAt > HIDDEN_SLOW_MS };
  }

  // A change of pace preserves how far the current tick had already run.
  private changeSpeed(speed: Speed, now: number): void {
    const was = this.speed;
    if (was === speed) return;
    const save = this.save;
    const fraction = save && was !== 0 ? tickFraction(save.sim.gameMinutes, save.sim.realTime, now, this.pace(now)) : this.pausedFraction;
    this.speed = speed;
    if (speed === 0) this.pausedFraction = fraction;
    else if (save) {
      const realTime = now - fraction * tickMs(save.sim.gameMinutes, this.pace(now));
      this.save = { ...save, sim: { ...save.sim, realTime } };
      this.pausedFraction = 0;
    }
  }

  // Called by the worker timer every 250 ms.
  tick(now: number): void {
    if (!this.save || this.busy) return;
    const pace = this.pace(now);
    // a device that slept owes nothing: the wall time of the gap is dropped
    const cur = now - this.save.sim.realTime > MAX_GAP_MS ? { ...this.save.sim, realTime: now } : this.save.sim;
    const prev = cur.gameMinutes;
    const advanced = advanceTo(cur, now, pace);
    let sim = this.free ? finishAll(advanced) : advanced;
    // a road rebuilt as a wider kind moves the lots beside it
    if (kindsChanged(cur.roads, sim.roads)) sim = this.settle(sim);
    if (sim.gameMinutes === prev) {
      if (sim.realTime !== this.save.sim.realTime) this.save = { ...this.save, sim }; // paused: the wall time just follows
      return;
    }
    this.save = { ...this.save, sim };
    this.postSnapshot();
    const from = this.lifeFrom;
    if (!from || dayOf(sim.gameMinutes) !== from.day || sim.incoming !== from.incoming || sim.residents !== from.residents || sim.levers !== from.levers) this.postLife();
    // Persist every few wall seconds, not every tick (commands and flush save as well).
    if (now - this.persistedAt >= PERSIST_MS) {
      this.persistedAt = now;
      void this.persist(this.save);
    }
  }
}

const validSpeed = (v: unknown): v is Speed => v === 0 || v === 1 || v === 2 || v === 4;
