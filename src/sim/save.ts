import { LANDS } from "../world/landcover";
import { BUILDINGS, isPriority, JOB_KEYS, UPGRADE } from "./buildings";
import { CHRONICLE_CAP } from "./chronicle";
import { parseArticles } from "./articles";
import { DIG, parseFinds } from "./excavation";
import { emptyGrowth, NO_SPAWN, seedOf } from "./growth";
import { AUTO, parseEventLast, parsePending } from "./events";
import { migrateGoals, parseGoals } from "./goals";
import { emptyLevers, type Levers } from "./levers";
import { migrateText } from "./legacyText";
import { createFounders, isFinishedHouse, isWorkplace, MAX_EVENTS, MOOD_START } from "./people";
import { emptyFlags, emptyProd, emptyStock } from "./production";
import { emptyRoads, ROAD_KINDS } from "./roads";
import { SERVICE } from "./services";
import { YEAR_MIN, YEAR_SCALE } from "./time";
import type {
  Building,
  ChronicleEntry,
  Clearing,
  City,
  DaySummary,
  EventKind,
  Field,
  FieldWork,
  Household,
  Incoming,
  PeopleState,
  ProdFlags,
  ProdState,
  Resident,
  RoadEdge,
  RoadGraph,
  RoadNode,
  SaveV4,
  Site,
  Stock,
  SummaryLine,
  TerrainInfo,
  TownEvent,
  Upgrade,
  ZoneBlock,
  ZoneCell,
  ZoneState,
  ZoneType,
} from "./types";
import { emptyWeather, type DayStats, type Weather, type WeatherSite, type WeatherState } from "./weather";
import { emptyZones } from "./zones";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseCity(v: unknown): City | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (typeof c.name !== "string") return null;
  const name = c.name.trim();
  if (name.length < 1 || name.length > 40) return null;
  if (!isNum(c.lat) || c.lat < -90 || c.lat > 90) return null;
  if (!isNum(c.lng) || c.lng < -180 || c.lng > 180) return null;
  if (!isNum(c.foundedAt) || c.foundedAt <= 0) return null;
  return { name, lat: c.lat, lng: c.lng, foundedAt: c.foundedAt };
}

// Saves from before roads existed have no `roads`: that is an empty graph, not an error.
function parseRoads(v: unknown): RoadGraph | null {
  if (v === undefined) return emptyRoads();
  if (!isRecord(v) || !isRecord(v.nodes) || !isRecord(v.edges)) return null;
  if (!Number.isInteger(v.nextId) || (v.nextId as number) < 1) return null;
  const nextId = v.nextId as number;
  const nodes: Record<number, RoadNode> = {};
  for (const [key, raw] of Object.entries(v.nodes)) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || String(raw.id) !== key) return null;
    if (!isNum(raw.x) || !isNum(raw.y)) return null;
    const id = raw.id as number;
    if (id < 1 || id >= nextId) return null;
    nodes[id] = { id, x: raw.x, y: raw.y };
  }
  const edges: Record<number, RoadEdge> = {};
  for (const [key, raw] of Object.entries(v.edges)) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || String(raw.id) !== key) return null;
    const id = raw.id as number;
    if (id < 1 || id >= nextId || id in nodes) return null;
    if (!Number.isInteger(raw.a) || !Number.isInteger(raw.b) || raw.a === raw.b) return null;
    if (!((raw.a as number) in nodes) || !((raw.b as number) in nodes)) return null;
    if (typeof raw.kind !== "string" || !Object.hasOwn(ROAD_KINDS, raw.kind)) return null;
    if (!isNum(raw.length) || raw.length <= 0) return null;
    if (!isNum(raw.labor) || raw.labor < 0) return null;
    if (!isNum(raw.done) || raw.done < 0 || raw.done > raw.labor) return null;
    edges[id] = {
      id,
      a: raw.a as number,
      b: raw.b as number,
      kind: raw.kind as RoadEdge["kind"],
      length: raw.length,
      labor: raw.labor,
      done: raw.done,
    };
  }
  return { nodes, edges, nextId };
}

const ZONES = ["none", "res", "craft", "trade"];
const BLOCKS = ["road", "overlap", "field", "water", "steep", "pending"];

const isPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

// Saves from before zoning have no `zones`: that is an empty state, not an error.
function parseZones(v: unknown): ZoneState | null {
  if (v === undefined) return emptyZones();
  if (!isRecord(v) || !Array.isArray(v.cells) || !Array.isArray(v.fields) || !isRecord(v.terrain)) return null;
  if (!Number.isInteger(v.rev) || (v.rev as number) < 0) return null;
  const cells: ZoneCell[] = [];
  for (const raw of v.cells) {
    if (!isRecord(raw) || typeof raw.key !== "string") return null;
    if (!Number.isInteger(raw.edge) || !Number.isInteger(raw.i) || (raw.i as number) < 0) return null;
    if (raw.side !== 1 && raw.side !== -1) return null;
    if (!Number.isInteger(raw.depth) || (raw.depth as number) < 0 || (raw.depth as number) > 3) return null;
    if (!isNum(raw.cx) || !isNum(raw.cy) || !isNum(raw.angle)) return null;
    if (typeof raw.zone !== "string" || !ZONES.includes(raw.zone)) return null;
    if (raw.block !== null && (typeof raw.block !== "string" || !BLOCKS.includes(raw.block))) return null;
    cells.push({
      key: raw.key,
      edge: raw.edge as number,
      side: raw.side,
      i: raw.i as number,
      depth: raw.depth as number,
      cx: raw.cx,
      cy: raw.cy,
      angle: raw.angle,
      zone: raw.zone as ZoneCell["zone"],
      block: raw.block as ZoneBlock | null,
    });
  }
  const fields: Field[] = [];
  for (const raw of v.fields) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || (raw.id as number) < 1) return null;
    if (!Array.isArray(raw.pts) || raw.pts.length < 3 || !raw.pts.every(isPoint)) return null;
    if (!isNum(raw.area) || raw.area <= 0) return null;
    fields.push({ id: raw.id as number, pts: (raw.pts as [number, number][]).map((p) => [p[0], p[1]]), area: raw.area });
  }
  const terrain: Record<string, TerrainInfo> = {};
  for (const [key, raw] of Object.entries(v.terrain)) {
    if (!isRecord(raw) || typeof raw.land !== "string" || !(LANDS as readonly string[]).includes(raw.land) || !isNum(raw.slope)) return null;
    terrain[key] = { land: raw.land as TerrainInfo["land"], slope: raw.slope };
  }
  return { cells, fields, terrain, rev: v.rev as number };
}

const STATES = ["planned", "building", "active"];

function parseBuildings(v: unknown, nextId: unknown): Record<number, Building> | null {
  if (!isRecord(v) || !Number.isInteger(nextId) || (nextId as number) < 1) return null;
  const out: Record<number, Building> = {};
  for (const [key, raw] of Object.entries(v)) {
    if (!isRecord(raw) || !Number.isInteger(raw.id) || String(raw.id) !== key) return null;
    const id = raw.id as number;
    if (id < 1 || id >= (nextId as number)) return null;
    if (typeof raw.template !== "string" || !Object.hasOwn(BUILDINGS, raw.template)) return null;
    if (raw.zone !== BUILDINGS[raw.template].zone) return null;
    if (raw.side !== 1 && raw.side !== -1) return null;
    const lot = raw.lot;
    if (!isRecord(lot) || !isNum(lot.cx) || !isNum(lot.cy) || !isNum(lot.angle)) return null;
    if (!Number.isInteger(lot.w) || !Number.isInteger(lot.d) || (lot.w as number) < 1 || (lot.d as number) < 1) return null;
    if (!Array.isArray(raw.footprint) || raw.footprint.length !== 4 || !raw.footprint.every(isPoint)) return null;
    if (!isNum(raw.height) || raw.height <= 0) return null;
    if (typeof raw.state !== "string" || !STATES.includes(raw.state)) return null;
    if (!isNum(raw.labor) || raw.labor <= 0 || !isNum(raw.done) || raw.done < 0 || raw.done > raw.labor) return null;
    if (!isNum(raw.created)) return null;
    let site: Site | undefined;
    if (raw.site !== undefined) {
      const q = raw.site;
      const share = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;
      if (!isRecord(q) || !share(q.forest) || !share(q.water) || !share(q.rock)) return null;
      site = { forest: q.forest, water: q.water, rock: q.rock };
    }
    out[id] = {
      id,
      template: raw.template,
      zone: raw.zone as ZoneType,
      lot: { cx: lot.cx, cy: lot.cy, angle: lot.angle, w: lot.w as number, d: lot.d as number },
      side: raw.side,
      footprint: (raw.footprint as [number, number][]).map((p) => [p[0], p[1]]),
      height: raw.height,
      state: raw.state as Building["state"],
      labor: raw.labor,
      done: raw.done,
      created: raw.created,
      // Saves from before production: finished and started buildings were built without materials.
      paid: typeof raw.paid === "boolean" ? raw.paid : raw.state !== "planned",
      // Saves from before services: level 1 (a level 2 only makes sense for the izba), no streak.
      level: raw.level === 2 && raw.template === UPGRADE.template ? 2 : 1,
      streak: nonNegInt(raw.streak) ? raw.streak : 0,
    };
    if (site) out[id].site = site;
    // Saves from before excavation: a dig site starts at its first radius.
    if (raw.template === DIG.template) out[id].radius = isNum(raw.radius) && raw.radius >= DIG.startRadius ? Math.min(DIG.maxRadius, raw.radius) : DIG.startRadius;
    if (raw.onRuins === true) out[id].onRuins = true;
    if (isNum(raw.hand) && raw.hand > 0) out[id].hand = raw.hand;
    if (raw.template === "orchard" && isNum(raw.ripe)) out[id].ripe = raw.ripe;
    if (nonNegInt(raw.staff)) out[id].staff = Math.min(raw.staff, 99); // hiring limit of a workplace
    const up = raw.upgrade;
    if (up !== undefined && raw.state === "active" && isRecord(up) && isNum(up.labor) && up.labor > 0 && isNum(up.done) && up.done >= 0 && up.done <= up.labor) {
      const upgrade: Upgrade = { labor: up.labor, done: up.done, paid: up.paid === true };
      out[id].upgrade = upgrade;
    }
  }
  return out;
}

const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const EVENT_KINDS = ["birth", "death", "marriage", "arrival", "departure", "movein", "farm", "food", "clearing", "built", "shortage", "order", "goal", "unlock", "event"];

// A position of two finite numbers, else undefined (the event is kept without it).
const parsePos = (v: unknown): [number, number] | undefined => (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : undefined);

// Structurally broken people data gives null (the caller starts over with founders). References to
// buildings that do not exist are repaired instead: such households go back to tents, such workers
// lose the job. Missing people data (older saves) also gives null.
function parsePeople(sim: Record<string, unknown>, buildings: Record<number, Building>): PeopleState | null {
  const { residents: rawR, households: rawH } = sim;
  if (!isRecord(rawR) || !isRecord(rawH)) return null;
  if (!Number.isInteger(sim.nextPersonId) || (sim.nextPersonId as number) < 1) return null;
  if (!Number.isInteger(sim.nextHouseholdId) || (sim.nextHouseholdId as number) < 1) return null;
  const nextPerson = sim.nextPersonId as number;
  const nextHouse = sim.nextHouseholdId as number;
  const residents: Record<number, Resident> = {};
  for (const [key, r] of Object.entries(rawR)) {
    if (!isRecord(r) || !Number.isInteger(r.id) || String(r.id) !== key) return null;
    const id = r.id as number;
    if (id < 1 || id >= nextPerson) return null;
    if (typeof r.first !== "string" || typeof r.last !== "string" || r.first === "" || r.last === "") return null;
    if (r.sex !== "m" && r.sex !== "f") return null;
    if (!isNum(r.born)) return null;
    if (!Number.isInteger(r.household) || (r.spouse !== null && !Number.isInteger(r.spouse))) return null;
    if (r.job !== null && !Number.isInteger(r.job)) return null;
    if (r.commute !== null && (!isNum(r.commute) || r.commute < 0)) return null;
    if (!nonNegInt(r.idleDays)) return null;
    residents[id] = {
      id,
      first: r.first,
      last: r.last,
      sex: r.sex,
      born: r.born,
      household: r.household as number,
      spouse: r.spouse as number | null,
      job: r.job as number | null,
      commute: r.commute as number | null,
      idleDays: r.idleDays,
      literate: r.literate === true,
      school: isNum(r.school) ? Math.min(100, Math.max(0, r.school)) : 0,
      ...(r.inClass === true ? { inClass: true } : {}),
    };
  }
  const households: Record<number, Household> = {};
  const homes = new Set<number>();
  const seen = new Set<number>();
  for (const [key, h] of Object.entries(rawH)) {
    if (!isRecord(h) || !Number.isInteger(h.id) || String(h.id) !== key) return null;
    const id = h.id as number;
    if (id < 1 || id >= nextHouse) return null;
    if (typeof h.last !== "string" || h.last === "" || !isNum(h.arrived)) return null;
    if (!Array.isArray(h.members) || h.members.length === 0) return null;
    const members: number[] = [];
    for (const m of h.members) {
      if (!Number.isInteger(m) || !residents[m as number] || residents[m as number].household !== id || seen.has(m as number)) return null;
      seen.add(m as number);
      members.push(m as number);
    }
    let home: number | null = null;
    if (h.home !== null) {
      if (!Number.isInteger(h.home)) return null;
      if (isFinishedHouse(buildings[h.home as number]) && !homes.has(h.home as number)) {
        home = h.home as number;
        homes.add(home);
      }
    }
    const mood = isNum(h.mood) ? Math.min(100, Math.max(0, h.mood)) : MOOD_START;
    // Saves from before the flag: the founding households arrived at minute 0.
    const founder = typeof h.founder === "boolean" ? h.founder : h.arrived === 0;
    households[id] = { id, last: h.last, home, members, arrived: h.arrived, founder, mood, ...(h.cold === true ? { cold: true as const } : {}) };
  }
  if (seen.size !== Object.keys(residents).length) return null; // a resident in no household
  for (const r of Object.values(residents)) {
    if (!households[r.household]) return null;
    if (r.spouse !== null) {
      const sp = residents[r.spouse];
      if (!sp || sp.spouse !== r.id || sp.household !== r.household) return null;
    }
    if (r.job !== null && !isWorkplace(buildings[r.job])) {
      r.job = null;
      r.commute = null;
    }
  }
  const events: TownEvent[] = [];
  if (Array.isArray(sim.events)) {
    for (const e of sim.events) {
      if (isRecord(e) && isNum(e.at) && typeof e.kind === "string" && EVENT_KINDS.includes(e.kind) && typeof e.text === "string") {
        const pos = parsePos(e.pos);
        events.push(pos ? { at: e.at, kind: e.kind as EventKind, text: migrateText(e.text), pos } : { at: e.at, kind: e.kind as EventKind, text: migrateText(e.text) });
      }
    }
  }
  return { residents, households, nextPersonId: nextPerson, nextHouseholdId: nextHouse, events: events.slice(-MAX_EVENTS) };
}

// A stock with any broken figure gives back the founding stock.
function parseStock(v: unknown): Stock {
  const keys = ["food", "logs", "planks", "stone", "wares"] as const;
  if (!isRecord(v) || !keys.every((k) => isNum(v[k]) && (v[k] as number) >= 0)) return emptyStock();
  return { food: v.food as number, logs: v.logs as number, planks: v.planks as number, stone: v.stone as number, wares: v.wares as number };
}

const numRecord = (v: unknown): Record<number, number> => {
  const out: Record<number, number> = {};
  if (!isRecord(v)) return out;
  for (const [k, n] of Object.entries(v)) if (Number.isInteger(Number(k)) && isNum(n) && n >= 0) out[Number(k)] = n;
  return out;
};

// Progress of fields and event flags; whatever is broken starts empty (the fields start the year over).
function parseProd(v: unknown): ProdState {
  const out = emptyProd();
  if (!isRecord(v)) return out;
  if (isRecord(v.fields)) {
    const fields: Record<number, FieldWork> = {};
    for (const [k, raw] of Object.entries(v.fields)) {
      if (!Number.isInteger(Number(k)) || !isRecord(raw)) continue;
      if (!Number.isInteger(raw.year) || !isNum(raw.sowH) || !isNum(raw.harvH) || !isNum(raw.reaped)) continue;
      if (raw.sowH < 0 || raw.harvH < 0 || raw.reaped < 0) continue;
      fields[Number(k)] = { year: raw.year as number, sowH: raw.sowH, harvH: raw.harvH, reaped: raw.reaped };
    }
    out.fields = fields;
  }
  const f = v.flags;
  if (isRecord(f) && Number.isInteger(f.year) && isNum(f.rot) && f.rot >= 0) {
    const flag = (k: string) => f[k] === true;
    const flags: ProdFlags = { ...emptyFlags(f.year as number), sowing: flag("sowing"), harvest: flag("harvest"), done: flag("done"), closed: flag("closed"), hungry: flag("hungry"), rot: f.rot };
    out.flags = flags;
  }
  out.today = numRecord(v.today);
  out.yesterday = numRecord(v.yesterday);
  // Saves from before the orchard: a year with nothing counted.
  const o = v.orchard;
  if (isRecord(o) && Number.isInteger(o.year)) out.orchard = { year: o.year as number, frost: num(o.frost, 0, 400, 0), stress: num(o.stress, 0, 400, 0), days: num(o.days, 0, 400, 0), hot: num(o.hot, 0, 400, 0) };
  return out;
}

const SUMMARY_KINDS: readonly string[] = ["built", "arrived", "born", "made", "problem"];

// Levers: every field falls back to its default, so old saves load with all levers off.
function parseLevers(v: unknown): Levers {
  const out = emptyLevers();
  if (!isRecord(v)) return out;
  if (isNum(v.priority) && Number.isInteger(v.priority) && v.priority !== 0) out.priority = v.priority;
  const t = v.toloka;
  if (isRecord(t) && isNum(t.site) && Number.isInteger(t.site) && t.site !== 0 && isNum(t.until)) out.toloka = { site: t.site, until: t.until };
  if (isNum(v.tolokaReady)) out.tolokaReady = v.tolokaReady;
  out.strada = v.strada === true;
  out.adultSchool = v.adultSchool === true;
  if (v.rations === "reduced" || v.rations === "generous") out.rations = v.rations;
  const j = v.jobs;
  if (isRecord(j)) for (const k of JOB_KEYS) if (isPriority(j[k])) out.jobs[k] = j[k];
  return out;
}

// The last day summary; a missing or broken one is null, broken lines are dropped.
function parseSummary(v: unknown): DaySummary | null {
  if (!isRecord(v) || !isNum(v.at) || !Array.isArray(v.lines)) return null;
  const lines: SummaryLine[] = [];
  for (const l of v.lines.slice(0, 40)) {
    if (!isRecord(l) || typeof l.kind !== "string" || !SUMMARY_KINDS.includes(l.kind) || typeof l.text !== "string") continue;
    lines.push({ kind: l.kind as SummaryLine["kind"], text: migrateText(l.text.slice(0, 200)), ...(isPoint(l.pos) ? { pos: [l.pos[0], l.pos[1]] as [number, number] } : {}) });
  }
  return { at: v.at, lines };
}

// A pending choice written with the old vocabulary gets the universal words.
function migratePending(p: ReturnType<typeof parsePending>): ReturnType<typeof parsePending> {
  if (!p) return p;
  const opt = (o: { label: string; effect: string }) => ({ label: migrateText(o.label), effect: migrateText(o.effect) });
  return { ...p, title: migrateText(p.title), text: migrateText(p.text), options: [opt(p.options[0]), opt(p.options[1])] };
}

// Broken entries are dropped, never the whole chronicle.
function parseChronicle(v: unknown): ChronicleEntry[] {
  if (!Array.isArray(v)) return [];
  const out: ChronicleEntry[] = [];
  for (const e of v) {
    if (!isRecord(e) || !isNum(e.at) || typeof e.kind !== "string" || typeof e.text !== "string") continue;
    if (e.kind.startsWith("event:") && e.text.endsWith(AUTO)) continue; // routine an earlier version wrote here (now the feed only)
    out.push({ at: e.at, kind: e.kind, text: migrateText(e.text) });
  }
  return out.slice(-CHRONICLE_CAP);
}

// Clearing sites; broken entries are dropped, a missing list is empty.
function parseClearings(v: unknown): Clearing[] {
  if (!Array.isArray(v)) return [];
  const out: Clearing[] = [];
  const seen = new Set<number>();
  for (const c of v) {
    if (!isRecord(c) || !Number.isInteger(c.id) || (c.id as number) < 1 || seen.has(c.id as number)) continue;
    if (!Array.isArray(c.pts) || c.pts.length < 3 || !c.pts.every(isPoint)) continue;
    if (!isNum(c.area) || c.area <= 0 || !isNum(c.forest) || c.forest < 0 || c.forest > 1) continue;
    if (!isNum(c.labor) || c.labor <= 0 || !isNum(c.done) || c.done < 0) continue;
    seen.add(c.id as number);
    out.push({ id: c.id as number, pts: (c.pts as [number, number][]).map((p) => [p[0], p[1]]), area: c.area, forest: c.forest, labor: c.labor, done: Math.min(c.done, c.labor) });
  }
  return out;
}

// Families on their way: entries with a broken shape or without a finished house to come to are dropped.
function parseIncoming(v: unknown, buildings: Record<number, Building>): Incoming[] {
  if (!Array.isArray(v)) return [];
  const out: Incoming[] = [];
  const seen = new Set<number>();
  for (const f of v) {
    if (!isRecord(f) || !Number.isInteger(f.house) || !isNum(f.arrive) || !isFinishedHouse(buildings[f.house as number]) || seen.has(f.house as number)) continue;
    seen.add(f.house as number);
    out.push({ house: f.house as number, arrive: f.arrive });
  }
  return out;
}

const num = (v: unknown, lo: number, hi: number, d: number): number => (isNum(v) ? Math.min(hi, Math.max(lo, v)) : d);

function parseDay(v: unknown, d: DayStats): DayStats {
  if (!isRecord(v)) return d;
  return { min: num(v.min, -90, 70, d.min), max: num(v.max, -90, 70, d.max), rain: num(v.rain, 0, 1000, 0) };
}

function parseWeatherSite(v: unknown): WeatherSite | null {
  if (!isRecord(v) || !isNum(v.lat) || !isNum(v.lng) || !isNum(v.seed)) return null;
  return { lat: num(v.lat, -90, 90, 0), lng: num(v.lng, -180, 180, 0), elev: num(v.elev, -500, 9000, 0), seed: v.seed >>> 0, phase: num(v.phase, 0, 1, 0) };
}

// Saves from before the weather have none: the calm state (the handler gives the town a site on load).
function parseWeather(v: unknown): WeatherState {
  const d = emptyWeather();
  if (!isRecord(v)) return d;
  const site = parseWeatherSite(v.site);
  if (!site) return d;
  const n = isRecord(v.now) ? v.now : {};
  const now: Weather = { temp: num(n.temp, -90, 70, d.now.temp), cloud: num(n.cloud, 0, 1, 0), precip: num(n.precip, 0, 200, 0), snow: n.snow === true, wind: num(n.wind, 0, 100, 0) };
  return {
    site,
    now,
    soil: num(v.soil, 0, 1, d.soil),
    snowpack: num(v.snowpack, 0, 20, 0),
    frozen: num(v.frozen, 0, 1, 0),
    ice: num(v.ice, 0, 1, 0),
    gdd: num(v.gdd, 0, 20000, 0),
    stress: num(v.stress, 0, 1000, 0),
    stressDays: num(v.stressDays, 0, 1000, 0),
    frost: num(v.frost, 0, 1, 1),
    crop: num(v.crop, 0, 1.2, 1),
    day: parseDay(v.day, d.day),
    yesterday: parseDay(v.yesterday, d.yesterday),
  };
}

// Saves from before growth have none of these fields: defaults, not an error. Broken buildings
// reset the buildings only; a broken generator state or spawn clock is replaced by a default.
// Saves without (or with broken) residents get the founders back.
function parseGrowth(sim: Record<string, unknown>, city: City, gameMinutes: number) {
  const g = emptyGrowth(seedOf(city.foundedAt), gameMinutes);
  if (sim.buildings !== undefined) {
    const b = parseBuildings(sim.buildings, sim.nextBuildingId);
    if (b) {
      g.buildings = b;
      g.nextBuildingId = sim.nextBuildingId as number;
    }
  }
  const rngOk = Number.isInteger(sim.rng) && (sim.rng as number) >= 0 && (sim.rng as number) < 2 ** 32;
  let rng = rngOk ? (sim.rng as number) : seedOf(city.foundedAt);
  let people = parsePeople(sim, g.buildings);
  if (!people) {
    const f = createFounders(rng, gameMinutes);
    people = f.people;
    rng = f.rng;
  }
  g.rng = rng;
  Object.assign(g, people);
  g.stock = parseStock(sim.stock);
  g.prod = parseProd(sim.prod);
  g.coverage = numRecord(sim.coverage); // derived: rebuilt on load and every day
  g.landValue = numRecord(sim.landValue);
  g.incoming = parseIncoming(sim.incoming, g.buildings);
  g.clearings = parseClearings(sim.clearings);
  g.attract = isNum(sim.attract) ? Math.min(1, Math.max(0, sim.attract)) : 0;
  g.chronicle = parseChronicle(sim.chronicle);
  g.summary = parseSummary(sim.summary);
  g.levers = parseLevers(sim.levers);
  g.pending = migratePending(parsePending(sim.pending));
  g.eventLast = parseEventLast(sim.eventLast);
  if (isNum(sim.nextEvent)) g.nextEvent = sim.nextEvent; // else the default of a fresh town: three game days from now
  g.finds = parseFinds(sim.finds);
  g.articles = parseArticles(sim.articles);
  g.weather = parseWeather(sim.weather);
  const ls = sim.lastSpawn;
  if (isRecord(ls) && isNum(ls.res) && isNum(ls.craft) && isNum(ls.trade)) {
    g.lastSpawn = { res: ls.res, craft: ls.craft, trade: ls.trade };
  } else g.lastSpawn = { res: NO_SPAWN, craft: NO_SPAWN, trade: NO_SPAWN };
  return g;
}

// v3 had a 360-day year. Game time and every timestamp stay as they are (the date is re-read in the
// new calendar); `born` is rescaled so each resident keeps their age in years, school days scale with the year.
const YEAR_MIN_V3 = 360 * 1440;
function fromV3(v: Record<string, unknown>): Record<string, unknown> {
  const sim = v.sim;
  if (!isRecord(sim) || !isNum(sim.gameMinutes) || !isRecord(sim.residents)) return { ...v, version: 4 };
  const now = sim.gameMinutes;
  const residents: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(sim.residents)) {
    if (!isRecord(r) || !isNum(r.born)) {
      residents[k] = r;
      continue;
    }
    // v3 kept school days (of a 360-day year); the literacy progress is a share of the child's school time now.
    const school = isNum(r.school) ? Math.min(100, (r.school * YEAR_SCALE * 100) / SERVICE.childLiteracyDays) : r.school;
    residents[k] = { ...r, born: now - (now - r.born) * (YEAR_MIN / YEAR_MIN_V3), school };
  }
  return { ...v, version: 4, sim: { ...sim, residents } };
}

export function parseSave(value: unknown, now: number): SaveV4 | null {
  if (typeof value !== "object" || value === null) return null;
  let v = value as Record<string, unknown>;
  if (v.version === 3) v = fromV3(v);
  if (v.version !== 4) return null;
  const city = parseCity(v.city);
  if (!city) return null;
  const sim = v.sim as Record<string, unknown> | null | undefined;
  if (typeof sim !== "object" || sim === null) return null;
  if (!isNum(sim.realTime) || sim.realTime <= 0 || sim.realTime > now + 60_000) return null;
  if (!isNum(sim.gameMinutes) || sim.gameMinutes < 0) return null;
  const roads = parseRoads(sim.roads);
  if (!roads) return null;
  // Cells are rebuilt from roads on load, so broken zone data only costs the paint,
  // never the whole town (a rejected save would send the player back to founding).
  const zones = parseZones(sim.zones) ?? emptyZones();
  const growth = parseGrowth(sim, city, sim.gameMinutes);
  // A save without goals is an existing town: it gets every unlock its buildings prove and every goal already met, silently.
  growth.goals = parseGoals(sim.goals) ?? migrateGoals({ ...growth, zones, gameMinutes: sim.gameMinutes });
  return { version: 4, city, sim: { realTime: sim.realTime, gameMinutes: sim.gameMinutes, roads, zones, ...growth } };
}

// Old localStorage saves (v1, v2): keep the city, start a fresh village.
export function migrateLegacy(raw: string, now: number): SaveV4 | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;
  const city = parseCity(o.city);
  if (!city) return null;
  return { version: 4, city, sim: { realTime: now, gameMinutes: 0, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(seedOf(city.foundedAt)) } };
}
