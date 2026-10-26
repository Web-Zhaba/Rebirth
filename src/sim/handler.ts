import { finishAll, grantStock, nextEra, reveal, unlockAll } from "./admin";
import { newTally, observe, summarize, type Tally } from "./away";
import { advanceTo, BASE_TICK, capGap, OFFLINE, TICK_MS, type Pace, type Speed } from "./clock";
import { BUILDINGS } from "./buildings";
import { addArticles } from "./articles";
import { isCleared, nextClearingId, overTerrain, validateClearing } from "./clearing";
import { resolveChoice } from "./events";
import { cancelResearch, queueResearch, researchView, startResearch } from "./research";
import { lockReason } from "./tech";
import { callBlock, callSettlers, callToloka, setAdultSchool, setJobPriority, setPriority, setRations, setSchedule, setStaff } from "./leverCmds";
import { jobReport } from "./jobReport";
import { digInfos, keepRevealed, recordFinds } from "./excavation";
import { computeLife } from "./life";
import { refreshServices, serviceStats } from "./coverage";
import { canPlace, demand, emptyGrowth, growthAdvice, placeBuilding, reconcile, seedOf } from "./growth";
import { peopleStats, queryBuilding, syncPeople } from "./people";
import type { Cmd, FromWorker, ToWorker } from "./protocol";
import { economyStats, productionInfo } from "./production";
import { SERVICES, isService } from "./services";
import { addRoad, effectiveSpans, emptyRoads, removeEdge, ROAD_KINDS, spanReason } from "./roads";
import { migrateLegacy, parseSave } from "./save";
import { dayOf } from "./time";
import { startWeather, type WeatherState } from "./weather";
import type { BuildingQuery, ChronicleEntry, Clearing, ClientSave, Field, Finds, RoadGraph, SaveV4, Site, SimSnapshot, SimState, StoredArticle, TerrainInfo, ZoneState } from "./types";
import { emptyZones, nextFieldId, paintCells, pendingKeys, qpoint, regenerateCells, validateField } from "./zones";
import { makeFrame, type Frame } from "../world/frame";

export interface Storage {
  get(): Promise<unknown>;
  put(save: SaveV4): Promise<void>;
  clear(): Promise<void>;
  // Stores a pre-migration save once per version, never overwriting an earlier copy.
  keepOld?(raw: unknown, version: number): Promise<void>;
}

const AWAY_MIN_MS = 60_000;
const PERSIST_MS = 10_000; // wall ms between saves while ticking
const CATCHUP_MIN = 60; // game minutes: a longer catch-up reports progress
const AWAY_GAP_MS = 70_000; // a longer gap between ticks is caught up in chunks with progress
const HIDDEN_OFFLINE_MS = 5 * 60_000; // a tab hidden this long counts as offline

// Errors go to the console of the main thread, which cannot see the worker's stack: send it along.
const errorText = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));
const CHUNK_TICKS = 144; // one game day per chunk

// What the main thread sees: aggregates instead of individual residents.
export function toSnapshot(sim: SimState): SimSnapshot {
  const { zones: _z, chronicle: _c, residents: _r, households: _h, nextPersonId: _p, nextHouseholdId: _n, prod: _pr, finds: _f, articles: _a, ...rest } = sim;
  const houseMood: Record<number, number> = {};
  for (const h of Object.values(sim.households)) if (h.home !== null) houseMood[h.home] = Math.round(h.mood);
  const ps = peopleStats(sim);
  const dem = demand(sim);
  return { ...rest, people: { ...ps, demand: dem, growth: growthAdvice(sim, dem, ps.builders), jobs: jobReport(sim) }, economy: economyStats(sim), services: serviceStats(sim), houseMood, digs: digInfos(sim), callBlock: callBlock(sim), research: researchView(sim) };
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

const toClientSave = (save: SaveV4): ClientSave => ({ version: 4, city: save.city, sim: { ...toSnapshot(save.sim), zones: save.sim.zones, chronicle: save.sim.chronicle, finds: save.sim.finds, articles: save.sim.articles } });
const ENRICH_BATCH = 32;
const ENRICH_RETRY_MS = 30_000;

// Looks up land type and slope at a local point. Injected so tests need no network.
export type TerrainSampler = (frame: Frame, x: number, y: number) => Promise<TerrainInfo>;

// Ground elevation in meters at a point. Injected so tests need no network; none means 0 m.
export type ElevationSampler = (lng: number, lat: number) => Promise<number>;

export class Handler {
  private save: SaveV4 | null = null;
  private postedRev = -1; // zones rev the main thread already has
  private postedChronicle: ChronicleEntry[] | null = null; // the chronicle array the main thread already has
  private postedFinds: Finds | null = null;
  private postedArticles: StoredArticle[] | null = null;
  private busy = false; // loading or catching up: other messages wait in `queue`
  private queue: ToWorker[] = [];
  private catching: Promise<void> | null = null;
  private enriching: Promise<void> | null = null;
  private failed = new Set<string>(); // qkeys that could not be sampled; retried later
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lifeDay = Number.NaN; // game day the main thread has visual life for
  private lifeIncoming: SimState["incoming"] | null = null; // families on their way it was drawn for
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
    while (this.enriching || this.catching) await (this.enriching ?? this.catching);
  }

  async handle(msg: ToWorker): Promise<void> {
    if (this.busy) {
      this.queue.push(msg); // applied, in order, when the catch-up ends
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
          this.post({ t: "loaded", save: toClientSave(save), migrated: false, away: null });
          return;
        }
        case "query":
          this.post({ t: "queryResult", id: msg.id, data: this.save && msg.q?.type === "building" ? inspect(this.save.sim, msg.q.id) : null });
          return;
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

  // Advances in chunks of one game day, yielding between them, and counts what happens on the way.
  // The result equals one advanceTo(from, now).
  private async catchUp(from: SimState, now: number): Promise<{ sim: SimState; tally: Tally }> {
    let cur = capGap(from, now);
    const tally = newTally();
    const startGm = cur.gameMinutes;
    const total = Math.floor((now - cur.realTime) / TICK_MS) * BASE_TICK;
    const report = total > CATCHUP_MIN;
    const count = (p: SimState, n: SimState) => observe(tally, p, n);
    if (report) this.post({ t: "progress", done: 0, total });
    while (cur.realTime + TICK_MS <= now) {
      cur = advanceTo(cur, Math.min(now, cur.realTime + CHUNK_TICKS * TICK_MS), OFFLINE, Infinity, count);
      if (report) {
        this.post({ t: "progress", done: cur.gameMinutes - startGm, total });
        if (cur.realTime + TICK_MS <= now) await new Promise((r) => setTimeout(r, 0));
      }
    }
    return { sim: cur, tally };
  }

  // Cells are derived data: rebuild them so saves without zones (or with stale ones) are consistent.
  private settle(sim: SimState): SimState {
    const z = sim.zones;
    const cells = regenerateCells(sim.roads, z.cells, z.fields, z.terrain);
    return refreshServices(syncPeople({ ...sim, zones: { ...z, cells }, buildings: reconcile(sim.buildings, sim.roads, cells) }));
  }

  // The tab came back after a long gap: catch up with progress, then one snapshot, one life and the summary.
  private async runAway(now: number): Promise<void> {
    this.busy = true;
    try {
      const save = this.save;
      if (!save) return;
      const realMs = now - save.sim.realTime;
      const { sim, tally } = await this.catchUp(save.sim, now);
      this.save = { ...save, sim: this.settle(sim) };
      this.postSnapshot();
      this.postLife();
      this.post({ t: "away", away: summarize(tally, save.sim, sim, realMs) });
      await this.storage.put(this.save).catch((e) => this.post({ t: "error", message: String(e) }));
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
    } finally {
      await this.release();
    }
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
      this.post({ t: "loaded", save: null, migrated: false, away: null });
      return;
    }
    if (!save.sim.weather.site) save = { ...save, sim: { ...save.sim, weather: await this.weatherFor(save.city, save.sim.gameMinutes) } };
    const realMs = now - save.sim.realTime;
    const { sim, tally } = await this.catchUp(save.sim, now);
    const away = realMs > AWAY_MIN_MS ? summarize(tally, save.sim, sim, realMs) : null;
    save = { ...save, sim: this.settle(sim) };
    this.setSave(save);
    await this.storage.put(save);
    this.post({ t: "loaded", save: toClientSave(save), migrated, away });
    this.postLife(); // after the catch-up above has finished
    this.enrich();
  }

  private setSave(save: SaveV4 | null): void {
    this.save = save;
    this.postedRev = save ? save.sim.zones.rev : -1;
    this.postedChronicle = save ? save.sim.chronicle : null;
    this.postedFinds = save ? save.sim.finds : null;
    this.postedArticles = save ? save.sim.articles : null;
    this.lifeDay = Number.NaN;
    this.lifeIncoming = null;
    this.speed = 1;
    this.free = false;
    this.hiddenAt = null;
    this.persistedAt = save?.sim.realTime ?? 0;
    this.failed.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // Zones and the chronicle are attached only when they changed since the last message that carried them.
  private postSnapshot(): void {
    if (!this.save) return;
    const { zones, chronicle } = this.save.sim;
    const msg: Extract<FromWorker, { t: "snapshot" }> = { t: "snapshot", sim: toSnapshot(this.save.sim) };
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
      const day = dayOf(this.save.sim.gameMinutes);
      this.lifeDay = day;
      this.lifeIncoming = this.save.sim.incoming;
      const { trips, traffic, lights } = computeLife(this.save.sim, day);
      this.post({ t: "life", day, trips, traffic, lights });
    } catch (e) {
      this.post({ t: "error", message: errorText(e) });
    }
  }

  private rezone(z: ZoneState, roads: RoadGraph, fields: Field[]): ZoneState {
    return { ...z, fields, cells: regenerateCells(roads, z.cells, fields, z.terrain), rev: z.rev + 1 };
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
          while (this.busy) await new Promise((r) => setTimeout(r, 20)); // not while a catch-up owns the state
          const cur = this.save;
          if (!cur || cur.city !== city) return; // reset or re-founded meanwhile
          if (Object.keys(got).length === 0) continue;
          const z = cur.sim.zones;
          const zones = this.rezone({ ...z, terrain: { ...z.terrain, ...got } }, cur.sim.roads, z.fields);
          const buildings = reconcile(cur.sim.buildings, cur.sim.roads, zones.cells);
          this.save = { ...cur, sim: syncPeople({ ...cur.sim, zones, buildings }) };
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

  private async command(id: number, cmd: Cmd): Promise<void> {
    const reject = (reason: string) => this.post({ t: "cmdResult", id, ok: false, reason });
    try {
      if (!this.save) return reject("Нет поселения");
      const sim = this.save.sim;
      const roads = sim.roads;
      const z = sim.zones;
      let next: RoadGraph = roads;
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
      } else if (cmd.type === "removeRoad") {
        if (!Object.hasOwn(roads.edges, cmd.edgeId)) return reject("Участок уже убран");
        next = removeEdge(roads, cmd.edgeId);
        zones = this.rezone(z, next, z.fields);
      } else if (cmd.type === "paintZones") {
        if (!Array.isArray(cmd.keys) || cmd.keys.length > 50_000 || !cmd.keys.every((k) => typeof k === "string")) {
          return reject("Некорректные клетки");
        }
        if (cmd.zone !== "none" && cmd.zone !== "res" && cmd.zone !== "craft" && cmd.zone !== "trade") return reject("Неизвестная зона");
        const locked = cmd.zone === "none" ? null : lockReason(sim, cmd.zone);
        if (locked) return reject(locked);
        zones = { ...z, cells: paintCells(z.cells, cmd.keys, cmd.zone), rev: z.rev + 1 };
      } else if (cmd.type === "addField") {
        const v = validateField(cmd.pts, roads, z.fields);
        if (!v.ok) return reject(v.reason);
        zones = this.rezone(z, roads, [...z.fields, { id: nextFieldId(z.fields), pts: v.pts, area: v.area }]);
      } else if (cmd.type === "removeField") {
        if (!z.fields.some((f) => f.id === cmd.id)) return reject("Поле уже убрано");
        zones = this.rezone(z, roads, z.fields.filter((f) => f.id !== cmd.id));
      } else if (cmd.type === "addClearing") {
        const v = validateClearing(cmd.pts, cmd.forest, roads, z.fields, sim.clearings);
        if (!v.ok) return reject(v.reason);
        const c: Clearing = { id: nextClearingId(sim.clearings), pts: v.pts, area: v.area, forest: cmd.forest, labor: v.labor, done: 0 };
        this.save = { ...this.save, sim: { ...sim, clearings: [...sim.clearings, c] } };
        return await this.finishCommand(id);
      } else if (cmd.type === "removeClearing") {
        const c = sim.clearings.find((x) => x.id === cmd.id);
        if (!c) return reject("Вырубка уже убрана");
        if (isCleared(c)) return reject("Участок уже расчищен");
        this.save = { ...this.save, sim: { ...sim, clearings: sim.clearings.filter((x) => x !== c) } }; // logs already made stay in the stock
        return await this.finishCommand(id);
      } else if (cmd.type === "placeBuilding") {
        const t = typeof cmd.template === "string" && Object.hasOwn(BUILDINGS, cmd.template) ? BUILDINGS[cmd.template] : null;
        if (!t || t.zone !== "placed") return reject("Это здание нельзя поставить");
        const locked = lockReason(sim, t.id);
        if (locked) return reject(locked);
        if (!Number.isInteger(cmd.edge) || !Number.isInteger(cmd.i) || (cmd.side !== 1 && cmd.side !== -1) || !validSite(cmd.site)) {
          return reject("Некорректное место");
        }
        const ok = canPlace(sim, t, cmd.edge, cmd.side, cmd.i, cmd.site);
        if (!ok.ok) return reject(ok.reason);
        const placed = placeBuilding(sim, t, cmd.edge, cmd.side, cmd.i, cmd.site);
        this.save = { ...this.save, sim: placed };
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
      } else if (cmd.type === "setPriority" || cmd.type === "callToloka" || cmd.type === "setSchedule" || cmd.type === "setRations" || cmd.type === "setAdultSchool" || cmd.type === "callSettlers" || cmd.type === "setJobPriority" || cmd.type === "setStaff") {
        const r =
          cmd.type === "setPriority" ? setPriority(sim, cmd.key)
          : cmd.type === "callToloka" ? callToloka(sim, cmd.key)
          : cmd.type === "setSchedule" ? setSchedule(sim, cmd.strada)
          : cmd.type === "setRations" ? setRations(sim, cmd.rations)
          : cmd.type === "setAdultSchool" ? setAdultSchool(sim, cmd.on)
          : cmd.type === "setJobPriority" ? setJobPriority(sim, cmd.group, cmd.priority)
          : cmd.type === "setStaff" ? setStaff(sim, cmd.id, cmd.staff)
          : callSettlers(sim);
        if (!r.ok) return reject(r.reason);
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (cmd.type === "startResearch" || cmd.type === "queueResearch" || cmd.type === "cancelResearch") {
        const r = cmd.type === "startResearch" ? startResearch(sim, cmd.techId) : cmd.type === "queueResearch" ? queueResearch(sim, cmd.techId) : cancelResearch(sim, cmd.techId);
        if (!r.ok) return reject(r.reason);
        this.save = { ...this.save, sim: r.sim };
        return await this.finishCommand(id);
      } else if (cmd.type === "choose") {
        if (!sim.pending || sim.pending.id !== cmd.id) return reject("Это событие уже решено");
        if (cmd.option !== 0 && cmd.option !== 1) return reject("Некорректный ответ");
        this.save = { ...this.save, sim: resolveChoice(sim, cmd.option, false) };
        return await this.finishCommand(id);
      } else if (cmd.type === "admin") {
        const op = cmd.op;
        if (typeof op !== "object" || op === null) return reject("Некорректная команда");
        if (op.k === "free") {
          if (typeof op.on !== "boolean") return reject("Некорректная команда");
          this.free = op.on;
        } else if (op.k === "finish") this.save = { ...this.save, sim: finishAll(sim) };
        else if (op.k === "stock") this.save = { ...this.save, sim: grantStock(sim) };
        else if (op.k === "unlock") this.save = { ...this.save, sim: unlockAll(sim) };
        else if (op.k === "era") this.save = { ...this.save, sim: nextEra(sim) };
        else if (op.k === "reveal") {
          const r = reveal(sim, op.x, op.y, op.r);
          if (!r.ok) return reject(r.reason);
          this.save = { ...this.save, sim: r.sim };
        } else return reject("Неизвестная команда");
        return await this.finishCommand(id);
      } else if (cmd.type === "demolish") {
        if (!Object.hasOwn(sim.buildings, cmd.id)) return reject("Здание уже снесено");
        const gone = sim.buildings[cmd.id];
        const rest = { ...sim.buildings };
        delete rest[cmd.id];
        this.save = { ...this.save, sim: refreshServices(syncPeople({ ...sim, buildings: rest, finds: keepRevealed(sim.finds, gone) })) };
        return await this.finishCommand(id);
      } else {
        return reject("Неизвестная команда");
      }
      const buildings = reconcile(sim.buildings, next, zones.cells);
      this.save = { ...this.save, sim: refreshServices(syncPeople({ ...sim, roads: next, zones, buildings })) };
      await this.finishCommand(id);
    } catch (e) {
      reject(e instanceof Error ? e.message : String(e));
    }
  }

  // Posts, persists and acknowledges a command that already changed this.save.
  private async finishCommand(id: number): Promise<void> {
    if (this.free) this.save = { ...this.save!, sim: finishAll(this.save!.sim) };
    this.postSnapshot();
    try {
      await this.storage.put(this.save!);
    } catch (e) {
      this.post({ t: "error", message: String(e) });
    }
    this.post({ t: "cmdResult", id, ok: true });
    this.enrich();
  }

  private pace(now: number): Pace {
    return { speed: this.speed, offline: this.hiddenAt !== null && now - this.hiddenAt > HIDDEN_OFFLINE_MS };
  }

  // Called by the worker timer every 250 ms.
  tick(now: number): void {
    if (!this.save || this.busy) return;
    const pace = this.pace(now);
    if (pace.speed !== 0 && now - this.save.sim.realTime > AWAY_GAP_MS) {
      this.catching = this.runAway(now).finally(() => (this.catching = null));
      return;
    }
    const prev = this.save.sim.gameMinutes;
    const advanced = advanceTo(this.save.sim, now, pace);
    const sim = this.free ? finishAll(advanced) : advanced;
    if (sim.gameMinutes === prev) {
      if (sim.realTime !== this.save.sim.realTime) this.save = { ...this.save, sim }; // paused: the wall time just follows
      return;
    }
    this.save = { ...this.save, sim };
    this.postSnapshot();
    if (dayOf(sim.gameMinutes) !== this.lifeDay || sim.incoming !== this.lifeIncoming) this.postLife();
    // Persist every few wall seconds, not every tick (commands and flush save as well).
    if (now - this.persistedAt >= PERSIST_MS) {
      this.persistedAt = now;
      this.storage.put(this.save).catch((e) => this.post({ t: "error", message: String(e) }));
    }
  }
}

const validSpeed = (v: unknown): v is Speed => v === 0 || v === 1 || v === 2 || v === 4;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const validSite = (v: unknown): v is Site =>
  typeof v === "object" && v !== null && ["forest", "water", "rock"].every((k) => finite((v as Record<string, unknown>)[k]) && (v as Record<string, number>)[k] >= 0 && (v as Record<string, number>)[k] <= 1);

// The message crossed a thread boundary, so check the shape at runtime.
function validateAddRoad(cmd: Extract<Cmd, { type: "addRoad" }>): string | null {
  const { pts, labor, kind, snapTol, span } = cmd;
  if (span !== undefined && (!finite(span) || span < 0)) return "Некорректный пролёт";
  if (typeof kind !== "string" || !Object.hasOwn(ROAD_KINDS, kind)) return "Неизвестный вид дороги";
  if (!finite(snapTol) || snapTol <= 0 || snapTol > 1000) return "Некорректный допуск";
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 512) return "Некорректная линия";
  if (!pts.every((p) => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6)) {
    return "Некорректная линия";
  }
  if (!Array.isArray(labor) || labor.length !== pts.length - 1 || !labor.every((l) => finite(l) && l >= 0)) return "Некорректная стоимость";
  return null;
}
