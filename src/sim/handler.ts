import { houseGoods } from "./coverage";
import { finishAll, grantStock, nextEra, reveal, unlockAll } from "./admin";
import { advanceTo, type Pace, type Speed } from "./clock";
import { BUILDINGS } from "./buildings";
import { addArticles } from "./articles";
import { isCleared, nextClearingId, overTerrain, validateClearing } from "./clearing";
import { scarcity } from "./heritage";
import { loseSite } from "./restore";
import { orderDig, orderStreetDig } from "./digging";
import { applyStroke, cancelPlans, newRoadEdges, planStroke, roadSpans, strokeTemplate, type StrokeSpan } from "./stroke";
import { returnFind, useFind } from "./items";
import { arrangeExhibitions, museumDaily, museumStaff, setExhibition } from "./museum";
import { cancelResearch, queueResearch, researchView, startResearch } from "./research";
import { lockReason } from "./tech";
import { callBlock, callSettlers, callToloka, grantSupplies, setAdultSchool, setJobPriority, setPriority, setRations, setSchedule, setStaff, setTrade } from "./leverCmds";
import { jobReport } from "./jobReport";
import { digInfos, keepRevealed, recordFinds } from "./excavation";
import { computeLife } from "./life";
import { snapshotDelta, type Posted } from "./delta";
import { refreshServices, serviceStats } from "./coverage";
import { canPlace, canPlaceOnFoundation, placeOnFoundation, emptyGrowth, placeBuilding, reconcile, seedOf } from "./growth";
import { freeHomes, peopleStats, queryBuilding, queryResident, syncPeople } from "./people";
import { inflowPerDay } from "./attraction";
import type { Cmd, FromWorker, ToWorker } from "./protocol";
import { economyStats, productionInfo } from "./production";
import { SERVICES, isService } from "./services";
import { addRoad, effectiveSpans, emptyRoads, kindsChanged, removeEdge, ROAD_KINDS, spanReason, upgradeRoads } from "./roads";
import { migrateLegacy, parseSave } from "./save";
import { dayOf } from "./time";
import { startWeather, type WeatherState } from "./weather";
import { fieldProgress } from "./fields";
import type { BuildingQuery, ChronicleEntry, Clearing, ClientSave, Field, Finds, RoadGraph, SaveV4, Site, SimSnapshot, SimState, StoredArticle, TerrainInfo, ZoneState } from "./types";
import { emptyZones, nextFieldId, pendingKeys, qkey, qpoint, regenerateCells, validateField } from "./zones";
import { makeFrame, type Frame } from "../world/frame";
import { L } from "../i18n";

// A road drawn «с домами»: the template to lay along both sides of its edges once their cells are surveyed.
interface RoadHouses {
  city: unknown; // the town it was drawn in
  edges: number[];
  template: string;
  only: boolean; // only foundations
}

export interface Storage {
  get(): Promise<unknown>;
  put(save: SaveV4): Promise<void>;
  clear(): Promise<void>;
  // Stores a pre-migration save once per version, never overwriting an earlier copy.
  keepOld?(raw: unknown, version: number): Promise<void>;
}

const PERSIST_MS = 10_000; // wall ms between saves while ticking
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
  return { ...rest, people: { ...ps, housing: { tents: ps.tents, free, underway }, jobs: jobReport(sim) }, economy: economyStats(sim), services: serviceStats(sim), houseMood, houseGoods: houseGoodsShare, houseResidents, digs: digInfos(sim), callBlock: callBlock(sim), inflow: inflowNow(sim), research: researchView(sim), heritageMul: scarcity(sim.finds), fieldProgress: fieldProgress(sim), museumStaff: museumStaff(sim) };
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
  private busy = false; // loading: other messages wait in `queue`
  private queue: ToWorker[] = [];
  private enriching: Promise<void> | null = null;
  private failed = new Set<string>(); // qkeys that could not be sampled; retried later
  private roadHouses: RoadHouses[] = []; // roads drawn «с домами» waiting for their ground to be surveyed
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // What the main thread's visual life was drawn from: the game day, the families on their way, the residents (their
  // jobs, homes and classes) and the levers (work hours, toloka); a change in any of them draws it anew.
  private lifeFrom: { day: number } & Pick<SimState, "incoming" | "residents" | "levers"> | null = null;
  private speed: Speed = 1; // session setting
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
  private async weatherFor(city: SaveV4["city"], t: number): Promise<WeatherState> {
    let elev = 0;
    try {
      const e = await this.elevation?.(city.lng, city.lat);
      if (typeof e === "number" && Number.isFinite(e)) elev = e;
    } catch {
      // founding never waits for the DEM
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
          const save: SaveV4 = {
            version: 4,
            city: msg.city,
            sim: { realTime: msg.now, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(msg.city.foundedAt)) },
          };
          save.sim.weather = await this.weatherFor(msg.city, 0);
          this.setSave(save);
          await this.storage.put(save);
          this.postLoaded(save, false);
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
          if (this.save) await this.storage.put(this.save);
          return;
        case "speed":
          if (!validSpeed(msg.speed) || !finite(msg.now)) return;
          this.tick(msg.now); // up to now at the old speed; a pause then owes nothing, an unpause starts from now
          this.speed = msg.speed;
          this.postSnapshot(); // carries the new wall-time anchor
          return;
        case "visibility":
          if (typeof msg.hidden !== "boolean" || !finite(msg.now)) return;
          if (msg.hidden) this.hiddenAt ??= msg.now;
          else this.hiddenAt = null;
          return;
        case "reset":
          this.setSave(null);
          await this.storage.clear();
          this.post({ t: "resetDone" });
          return;
      }
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
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
    return refreshServices(syncPeople({ ...sim, zones: { ...z, cells, rev: z.rev + 1 }, buildings: reconcile(sim.buildings, sim.roads) }));
  }

  private async load(legacy: string | null, now: number): Promise<void> {
    const raw = await this.storage.get();
    // An older save is kept as it was before its first migrated copy overwrites it (a way back).
    const version = typeof raw === "object" && raw !== null ? (raw as { version?: unknown }).version : undefined;
    if (version === 3) await this.storage.keepOld?.(raw, 3);
    let save = parseSave(raw, now);
    let migrated = false;
    if (!save && legacy) {
      save = migrateLegacy(legacy, now);
      if (save) {
        await this.storage.put(save);
        migrated = true;
      }
    }
    if (!save) {
      this.post({ t: "loaded", save: null, migrated: false });
      return;
    }
    if (!save.sim.weather.site) save = { ...save, sim: { ...save.sim, weather: await this.weatherFor(save.city, save.sim.gameMinutes) } };
    // The town waits where it was left: the time since the last save is not played back.
    save = { ...save, sim: this.settle({ ...save.sim, realTime: now }) };
    this.setSave(save);
    await this.storage.put(save);
    this.postLoaded(save, migrated);
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
    this.speed = 1;
    this.free = false;
    this.hiddenAt = null;
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

  private rezone(z: ZoneState, roads: RoadGraph, fields: Field[]): ZoneState {
    return { ...z, fields, cells: regenerateCells(roads, fields, z.terrain), rev: z.rev + 1 };
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
        const city = save.city;
        const frame = makeFrame(city.lat, city.lng);
        for (let n = 0; n < keys.length; n += ENRICH_BATCH) {
          const got: Record<string, TerrainInfo> = {};
          await Promise.all(
            keys.slice(n, n + ENRICH_BATCH).map(async (k) => {
              const [x, y] = qpoint(k);
              try {
                got[k] = overTerrain(await sampler(frame, x, y), x, y, this.save?.sim.clearings ?? []); // cleared forest is meadow
              } catch {
                this.failed.add(k);
              }
            }),
          );
          while (this.busy) await new Promise((r) => setTimeout(r, 20)); // not while a load owns the state
          const cur = this.save;
          if (!cur || cur.city !== city) return; // reset or re-founded meanwhile
          if (Object.keys(got).length === 0) continue;
          const z = cur.sim.zones;
          const zones = this.rezone({ ...z, terrain: { ...z.terrain, ...got } }, cur.sim.roads, z.fields);
          const buildings = reconcile(cur.sim.buildings, cur.sim.roads);
          this.save = { ...cur, sim: syncPeople({ ...cur.sim, zones, buildings }) };
          this.layRoadHouses();
          this.postSnapshot();
          try {
            await this.storage.put(this.save);
          } catch (e) {
            this.post({ t: "error", message: String(e) });
          }
        }
      }
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
    }
  }

  // Lays the houses of the roads drawn «с домами» whose ground is surveyed: a stroke along both sides of the new edges.
  // A request waits while a cell of its edges waits for terrain; it is dropped once laid, or when its town or edges went.
  private layRoadHouses(): void {
    if (!this.save || this.roadHouses.length === 0) return;
    let sim = this.save.sim;
    const keep: RoadHouses[] = [];
    for (const r of this.roadHouses) {
      const edges = r.edges.filter((e) => Object.hasOwn(sim.roads.edges, e));
      if (r.city !== this.save.city || edges.length === 0) continue;
      const on = new Set(edges);
      if (sim.zones.cells.some((c) => on.has(c.edge) && c.block === "pending" && !this.failed.has(qkey(c.cx, c.cy)))) {
        keep.push({ ...r, edges });
        continue;
      }
      sim = applyStroke(sim, planStroke(sim, BUILDINGS[r.template], roadSpans(sim.roads, edges), r.only).items).sim;
    }
    this.roadHouses = keep;
    if (sim !== this.save.sim) this.save = { ...this.save, sim: refreshServices(syncPeople(sim)) };
  }

  private async command(id: number, cmd: Cmd): Promise<void> {
    const reject = (reason: string) => this.post({ t: "cmdResult", id, ok: false, reason });
    try {
      if (!this.save) return reject(L("Нет поселения", "No settlement"));
      const sim = this.save.sim;
      const roads = sim.roads;
      const z = sim.zones;
      let next: RoadGraph = roads;
      let houses: RoadHouses | null = null;
      let zones: ZoneState;
      if (cmd.type === "addRoad") {
        const bad = validateAddRoad(cmd);
        if (bad) return reject(bad);
        const locked = lockReason(sim, cmd.kind);
        if (locked) return reject(locked);
        const tooLong = cmd.span === undefined ? null : spanReason(cmd.kind, cmd.span, effectiveSpans(sim.progress));
        if (tooLong) return reject(tooLong);
        const r = addRoad(roads, cmd.pts, cmd.kind, cmd.snapTol, cmd.labor);
        if (!r.ok) return reject(r.reason);
        next = r.graph;
        zones = this.rezone(z, next, z.fields);
        const t = cmd.houses ? strokeTemplate(cmd.houses.template) : null;
        // a house template the town cannot build yet leaves the road without them
        if (t && !(lockReason(sim, t.zone) ?? lockReason(sim, t.id))) {
          houses = { city: this.save.city, edges: newRoadEdges(roads, next), template: t.id, only: cmd.houses?.onlyFoundations === true };
        }
      } else if (cmd.type === "upgradeRoad") {
        const bad = validateUpgradeRoad(cmd);
        if (bad) return reject(bad);
        const locked = lockReason(sim, cmd.kind);
        if (locked) return reject(locked);
        const tooLong = cmd.span === undefined ? null : spanReason(cmd.kind, cmd.span, effectiveSpans(sim.progress));
        if (tooLong) return reject(tooLong);
        const r = upgradeRoads(roads, cmd.edges, cmd.kind, cmd.labor);
        if (!r.ok) return reject(r.reason);
        next = r.graph;
        zones = this.rezone(z, next, z.fields);
      } else if (cmd.type === "removeRoad") {
        if (!Object.hasOwn(roads.edges, cmd.edgeId)) return reject(L("Участок уже убран", "The section is already removed"));
        next = removeEdge(roads, cmd.edgeId);
        zones = this.rezone(z, next, z.fields);
      } else if (cmd.type === "addField") {
        const v = validateField(cmd.pts, roads, z.fields, Object.values(sim.buildings).map((b) => b.footprint));
        if (!v.ok) return reject(v.reason);
        zones = this.rezone(z, roads, [...z.fields, { id: nextFieldId(z.fields), pts: v.pts, area: v.area }]);
      } else if (cmd.type === "removeField") {
        if (!z.fields.some((f) => f.id === cmd.id)) return reject(L("Поле уже убрано", "The field is already removed"));
        zones = this.rezone(z, roads, z.fields.filter((f) => f.id !== cmd.id));
      } else if (cmd.type === "addClearing") {
        const v = validateClearing(cmd.pts, cmd.forest, roads, z.fields, sim.clearings);
        if (!v.ok) return reject(v.reason);
        const c: Clearing = { id: nextClearingId(sim.clearings), pts: v.pts, area: v.area, forest: cmd.forest, labor: v.labor, done: 0 };
        this.save = { ...this.save, sim: { ...sim, clearings: [...sim.clearings, c] } };
        return await this.finishCommand(id);
      } else if (cmd.type === "removeClearing") {
        const c = sim.clearings.find((x) => x.id === cmd.id);
        if (!c) return reject(L("Вырубка уже убрана", "The clearing is already removed"));
        if (isCleared(c)) return reject(L("Участок уже расчищен", "The area is already cleared"));
        this.save = { ...this.save, sim: { ...sim, clearings: sim.clearings.filter((x) => x !== c) } }; // logs already made stay in the stock
        return await this.finishCommand(id);
      } else if (cmd.type === "placeBuilding") {
        const t = typeof cmd.template === "string" && Object.hasOwn(BUILDINGS, cmd.template) ? BUILDINGS[cmd.template] : null;
        if (!t) return reject(L("Это здание нельзя поставить", "This building can’t be placed"));
        const locked = lockReason(sim, t.zone) ?? lockReason(sim, t.id);
        if (locked) return reject(locked);
        if (!Number.isInteger(cmd.edge) || !Number.isInteger(cmd.i) || (cmd.side !== 1 && cmd.side !== -1) || !validSite(cmd.site)) {
          return reject(L("Некорректное место", "Invalid place"));
        }
        const ok = canPlace(sim, t, cmd.edge, cmd.side, cmd.i, cmd.site);
        if (!ok.ok) return reject(ok.reason);
        const placed = placeBuilding(sim, t, cmd.edge, cmd.side, cmd.i, cmd.site);
        this.save = { ...this.save, sim: placed };
        return await this.finishCommand(id);
      } else if (cmd.type === "placeOnFoundation") {
        const t = typeof cmd.template === "string" && Object.hasOwn(BUILDINGS, cmd.template) ? BUILDINGS[cmd.template] : null;
        if (!t) return reject(L("Это здание нельзя поставить", "This building can’t be placed"));
        const locked = lockReason(sim, t.zone) ?? lockReason(sim, t.id);
        if (locked) return reject(locked);
        if (typeof cmd.foundationId !== "string") return reject(L("Некорректное место", "Invalid place"));
        const ok = canPlaceOnFoundation(sim, t, cmd.foundationId);
        if (!ok.ok) return reject(ok.reason);
        this.save = { ...this.save, sim: placeOnFoundation(sim, t, cmd.foundationId) };
        return await this.finishCommand(id);
      } else if (cmd.type === "placeStroke") {
        const t = strokeTemplate(cmd.template);
        if (!t) return reject(L("Это здание нельзя поставить", "This building can’t be placed"));
        const locked = lockReason(sim, t.zone) ?? lockReason(sim, t.id);
        if (locked) return reject(locked);
        if (!validSpans(cmd.spans) || (cmd.drop !== undefined && !validKeys(cmd.drop))) return reject(L("Некорректное место", "Invalid place"));
        const plan = planStroke(sim, t, cmd.spans, cmd.onlyFoundations === true);
        const drop = new Set(cmd.drop ?? []);
        const r = applyStroke(sim, plan.items.filter((it) => !drop.has(it.key)));
        if (r.placed === 0) return reject(plan.skipped[0]?.reason ?? L("Вдоль дороги здесь нет места", "No room along the road here"));
        this.save = { ...this.save, sim: r.sim };
        const ids: number[] = [];
        for (let b = sim.nextBuildingId; b < r.sim.nextBuildingId; b++) ids.push(b);
        return await this.finishCommand(id, ids);
      } else if (cmd.type === "cancelStroke") {
        if (!Array.isArray(cmd.ids) || cmd.ids.length > 10_000 || !cmd.ids.every((x) => Number.isInteger(x))) return reject(L("Некорректные здания", "Invalid buildings"));
        const r = cancelPlans(sim, cmd.ids);
        if (r.removed === 0) return reject(L("Отменять нечего: стройка уже началась", "Nothing to undo: work has already started"));
        this.save = { ...this.save, sim: refreshServices(syncPeople(r.sim)) };
        return await this.finishCommand(id);
      } else if (cmd.type === "returnFind" || cmd.type === "useFind" || cmd.type === "setExhibition" || cmd.type === "arrangeExhibitions") {
        const r = cmd.type === "returnFind" ? returnFind(sim, cmd.id) : cmd.type === "useFind" ? useFind(sim, cmd.id) : cmd.type === "setExhibition" ? setExhibition(sim, cmd.building, cmd.hall, cmd.theme) : arrangeExhibitions(sim);
        if (!r.ok) return reject(r.reason);
        this.save = { ...this.save, sim: museumDaily(r.sim) }; // the halls show what changed at once
        return await this.finishCommand(id);
      } else if (cmd.type === "digFoundation" || cmd.type === "digStreet") {
        const r = cmd.type === "digFoundation" ? orderDig(sim, cmd.foundationId) : orderStreetDig(sim, cmd.streetId);
        if (!r.ok) return reject(r.reason);
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (cmd.type === "recordFinds") {
        const r = recordFinds(sim, cmd);
        if (!r.ok) return reject(r.reason);
        if (r.sim === sim) {
          this.post({ t: "cmdResult", id, ok: true }); // nothing new: no save
          return;
        }
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (cmd.type === "addArticles") {
        const r = addArticles(sim, cmd);
        if (!r.ok) return reject(r.reason);
        if (r.sim === sim) {
          this.post({ t: "cmdResult", id, ok: true }); // nothing new: no save
          return;
        }
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (cmd.type === "setPriority" || cmd.type === "callToloka" || cmd.type === "setSchedule" || cmd.type === "setRations" || cmd.type === "setAdultSchool" || cmd.type === "callSettlers" || cmd.type === "grantSupplies" || cmd.type === "setJobPriority" || cmd.type === "setStaff" || cmd.type === "setTrade") {
        const r =
          cmd.type === "setPriority" ? setPriority(sim, cmd.key)
          : cmd.type === "callToloka" ? callToloka(sim, cmd.key)
          : cmd.type === "setSchedule" ? setSchedule(sim, cmd.strada)
          : cmd.type === "setRations" ? setRations(sim, cmd.rations)
          : cmd.type === "setAdultSchool" ? setAdultSchool(sim, cmd.on)
          : cmd.type === "setJobPriority" ? setJobPriority(sim, cmd.group, cmd.priority)
          : cmd.type === "setStaff" ? setStaff(sim, cmd.id, cmd.staff)
          : cmd.type === "setTrade" ? setTrade(sim, cmd.order)
          : cmd.type === "grantSupplies" ? grantSupplies(sim)
          : callSettlers(sim);
        if (!r.ok) return reject(r.reason);
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (cmd.type === "startResearch" || cmd.type === "queueResearch" || cmd.type === "cancelResearch") {
        const r = cmd.type === "startResearch" ? startResearch(sim, cmd.techId) : cmd.type === "queueResearch" ? queueResearch(sim, cmd.techId) : cancelResearch(sim, cmd.techId);
        if (!r.ok) return reject(r.reason);
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (import.meta.env.DEV && cmd.type === "admin") {
        // Production builds ship no admin panel; there this branch is compiled out and the command falls through to
        // the unknown-command rejection below, e.g. when sent from devtools.
        const op = cmd.op;
        if (typeof op !== "object" || op === null) return reject(L("Некорректная команда", "Invalid command"));
        if (op.k === "free") {
          if (typeof op.on !== "boolean") return reject(L("Некорректная команда", "Invalid command"));
          this.free = op.on;
        } else if (op.k === "finish") this.save = { ...this.save, sim: finishAll(sim) };
        else if (op.k === "stock") this.save = { ...this.save, sim: grantStock(sim) };
        else if (op.k === "unlock") this.save = { ...this.save, sim: unlockAll(sim) };
        else if (op.k === "era") this.save = { ...this.save, sim: nextEra(sim) };
        else if (op.k === "reveal") {
          const r = reveal(sim, op.x, op.y, op.r);
          if (!r.ok) return reject(r.reason);
          this.save = { ...this.save, sim: r.sim };
        } else return reject(L("Неизвестная команда", "Unknown command"));
        return await this.finishCommand(id);
      } else if (cmd.type === "demolish") {
        if (!Object.hasOwn(sim.buildings, cmd.id)) return reject(L("Здание уже снесено", "The building is already demolished"));
        const gone = sim.buildings[cmd.id];
        const rest = { ...sim.buildings };
        delete rest[cmd.id];
        this.save = { ...this.save, sim: refreshServices(syncPeople(loseSite({ ...sim, buildings: rest, finds: keepRevealed(sim.finds, gone) }, gone))) };
        return await this.finishCommand(id);
      } else {
        return reject(L("Неизвестная команда", "Unknown command"));
      }
      const buildings = reconcile(sim.buildings, next);
      this.save = { ...this.save, sim: refreshServices(syncPeople({ ...sim, roads: next, zones, buildings })) };
      if (houses) {
        this.roadHouses.push(houses);
        this.layRoadHouses();
      }
      await this.finishCommand(id);
    } catch (e) {
      reject(e instanceof Error ? e.message : String(e));
    }
  }

  // Posts, persists and acknowledges a command that already changed this.save.
  private async finishCommand(id: number, ids?: number[]): Promise<void> {
    if (this.free) this.save = { ...this.save!, sim: finishAll(this.save!.sim) };
    this.postSnapshot();
    try {
      await this.storage.put(this.save!);
    } catch (e) {
      this.post({ t: "error", message: String(e) });
    }
    this.post(ids ? { t: "cmdResult", id, ok: true, ids } : { t: "cmdResult", id, ok: true });
    this.enrich();
  }

  private pace(now: number): Pace {
    return { speed: this.speed, offline: this.hiddenAt !== null && now - this.hiddenAt > HIDDEN_SLOW_MS };
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
      this.storage.put(this.save).catch((e) => this.post({ t: "error", message: String(e) }));
    }
  }
}

const validSpeed = (v: unknown): v is Speed => v === 0 || v === 1 || v === 2 || v === 4;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const MAX_SPANS = 256;
const validSpans = (v: unknown): v is StrokeSpan[] =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= MAX_SPANS &&
  v.every((x) => typeof x === "object" && x !== null && Number.isInteger(x.edge) && (x.side === 1 || x.side === -1) && [x.from, x.to].every((m) => Number.isFinite(m) && Math.abs(m) < 1e6));
const validKeys = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 10_000 && v.every((k) => typeof k === "string" && k.length <= 300);

const validSite = (v: unknown): v is Site =>
  typeof v === "object" && v !== null && ["forest", "water", "rock"].every((k) => finite((v as Record<string, unknown>)[k]) && (v as Record<string, number>)[k] >= 0 && (v as Record<string, number>)[k] <= 1);

function validateUpgradeRoad(cmd: Extract<Cmd, { type: "upgradeRoad" }>): string | null {
  const { kind, edges, labor, span } = cmd;
  if (span !== undefined && (!finite(span) || span < 0)) return L("Некорректный пролёт", "Invalid span");
  if (typeof kind !== "string" || !Object.hasOwn(ROAD_KINDS, kind)) return L("Неизвестный вид дороги", "Unknown road type");
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > 512 || !edges.every((id) => Number.isInteger(id))) return L("Некорректный участок", "Invalid section");
  if (!Array.isArray(labor) || labor.length !== edges.length || !labor.every((l) => finite(l) && l >= 0)) return L("Некорректная стоимость", "Invalid cost");
  return null;
}

// The message crossed a thread boundary, so check the shape at runtime.
function validateAddRoad(cmd: Extract<Cmd, { type: "addRoad" }>): string | null {
  const { pts, labor, kind, snapTol, span } = cmd;
  if (span !== undefined && (!finite(span) || span < 0)) return L("Некорректный пролёт", "Invalid span");
  if (typeof kind !== "string" || !Object.hasOwn(ROAD_KINDS, kind)) return L("Неизвестный вид дороги", "Unknown road type");
  if (!finite(snapTol) || snapTol <= 0 || snapTol > 1000) return L("Некорректный допуск", "Invalid tolerance");
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 512) return L("Некорректная линия", "Invalid line");
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6)) {
    return L("Некорректная линия", "Invalid line");
  }
  if (!Array.isArray(labor) || labor.length !== pts.length - 1 || !labor.every((l) => finite(l) && l >= 0)) return L("Некорректная стоимость", "Invalid cost");
  return null;
}
