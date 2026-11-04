import { addChronicle } from "./chronicle";
import type { Building, DigInfo, FoundFoundation, FoundPlace, Finds, SimState } from "./types";
import { decimal, L, plural } from "../i18n";

// Excavation (PLAN.md section 12): dig sites reveal a growing disc of the buried old city.
export const DIG = {
  template: "dig",
  startRadius: 0, // m, when the site is finished
  maxRadius: 120, // m
  areaPerHour: 160, // m2 of revealed area per digger-hour: 40 m2 × PACE (4), like other construction work
  stonePerM2: 0.001, // t of salvaged stone per m2 of foundation
  stoneCap: 1, // t per foundation
  batch: 200, // foundations per recordFinds command
};

const MAX_FOUNDATIONS = 20_000;
const MAX_RING = 2000;
const MAX_LIST = 1000;
const EPS = 1e-9;

type Pt = [number, number];

export const emptyFinds = (): Finds => ({ foundations: [], pois: [], streets: [], revealed: [] });
export const isDig = (b: Pick<Building, "template">): boolean => b.template === DIG.template;
export const radiusOf = (b: Pick<Building, "radius">): number => b.radius ?? DIG.startRadius;
export const revealedArea = (r: number): number => Math.PI * r * r;

// Radius after `diggerHours` of work: the revealed area grows by areaPerHour per hour, up to the maximum.
export const growDig = (r: number, diggerHours: number): number => Math.min(DIG.maxRadius, Math.sqrt(r * r + (DIG.areaPerHour * diggerHours) / Math.PI));

// A finished site that has revealed everything it can: it goes away on its own.
export const digDone = (b: Building): boolean => isDig(b) && b.state === "active" && radiusOf(b) >= DIG.maxRadius - EPS;

// The finds of a dig site that goes away: its disc is kept, so what it revealed stays on the map and in the notebook.
export function keepRevealed(f: Finds, b: Building): Finds {
  if (!isDig(b) || b.state !== "active") return f;
  return { ...f, revealed: [...f.revealed, { digId: b.id, x: b.lot.cx, y: b.lot.cy, r: radiusOf(b) }] };
}

// ---------- geometry ----------

export function pointInRing(x: number, y: number, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(ring: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// ---------- snapshot ----------

const counts = new WeakMap<Finds, Map<number, [number, number, number]>>();

function countsOf(f: Finds): Map<number, [number, number, number]> {
  const hit = counts.get(f);
  if (hit) return hit;
  const m = new Map<number, [number, number, number]>();
  const at = (id: number) => {
    let c = m.get(id);
    if (!c) m.set(id, (c = [0, 0, 0]));
    return c;
  };
  for (const x of f.foundations) at(x.digId)[0]++;
  for (const x of f.pois) at(x.digId)[1]++;
  for (const x of f.streets) at(x.digId)[2]++;
  counts.set(f, m);
  return m;
}

// The discs of all dig sites, working or gone, with the finds counted for each, for the snapshot.
export function digInfos(s: Pick<SimState, "buildings" | "finds">): DigInfo[] {
  const out: DigInfo[] = [];
  const c = countsOf(s.finds);
  const add = (id: number, x: number, y: number, r: number) => {
    const [foundations, pois, streets] = c.get(id) ?? [0, 0, 0];
    out.push({ id, x, y, r, foundations, pois, streets });
  };
  for (const b of Object.values(s.buildings)) if (isDig(b) && b.state === "active") add(b.id, b.lot.cx, b.lot.cy, radiusOf(b));
  for (const d of s.finds.revealed) add(d.digId, d.x, d.y, d.r);
  return out;
}

// ---------- recording finds ----------

export interface FindsCmd {
  digId: number;
  foundations: { id: string; ring: [number, number][]; area: number; cls?: string; name?: string; height?: number }[];
  pois: { id: string; name: string; cls: string; x: number; y: number }[];
  streets: { id: string; name: string }[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPt = (p: unknown): p is Pt => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const MAX_HEIGHT = 300; // m

// The optional type of a foundation: a kind, a name and a height, each valid when present.
const typeOk = (f: { cls?: unknown; name?: unknown; height?: unknown }): boolean =>
  (f.cls === undefined || isStr(f.cls, 60)) && (f.name === undefined || isStr(f.name, 200)) && (f.height === undefined || (finite(f.height) && f.height >= 0 && f.height <= MAX_HEIGHT));
const typeOf = (f: { cls?: string; name?: string; height?: number }): Pick<FoundFoundation, "cls" | "name" | "height"> => {
  const t: Pick<FoundFoundation, "cls" | "name" | "height"> = {};
  if (f.cls !== undefined) t.cls = f.cls;
  if (f.name !== undefined) t.name = f.name;
  if (f.height !== undefined) t.height = f.height;
  return t;
};

const tonnes = (t: number): string => decimal((Math.round(t * 10) / 10).toString());

export const salvagedStone = (area: number): number => Math.min(DIG.stoneCap, DIG.stonePerM2 * area);

export type RecordResult = { ok: true; sim: SimState } | { ok: false; reason: string };

// Stores new finds (ids already recorded are ignored), adds the salvaged stone and writes the chronicle.
// Returns the same state when nothing was new.
export function recordFinds(s: SimState, cmd: FindsCmd): RecordResult {
  const bad = (reason: string): RecordResult => ({ ok: false, reason });
  if (!isRec(cmd) || !Number.isInteger(cmd.digId)) return bad(L("Некорректные находки", "Invalid finds"));
  const dig = s.buildings[cmd.digId];
  const gone = !dig || !isDig(dig);
  if (gone && !s.finds.revealed.some((d) => d.digId === cmd.digId)) return bad(L("Раскопа уже нет", "The dig is gone"));
  const { foundations, pois, streets } = cmd;
  if (!Array.isArray(foundations) || !Array.isArray(pois) || !Array.isArray(streets)) return bad(L("Некорректные находки", "Invalid finds"));
  if (foundations.length > DIG.batch || pois.length > MAX_LIST || streets.length > MAX_LIST) return bad(L("Слишком много находок", "Too many finds"));
  for (const f of foundations) {
    if (!isRec(f) || !isStr(f.id, 200) || !finite(f.area) || f.area <= 0 || f.area > 1e7) return bad(L("Некорректный фундамент", "Invalid foundation"));
    if (!Array.isArray(f.ring) || f.ring.length < 3 || f.ring.length > MAX_RING || !f.ring.every(isPt)) return bad(L("Некорректный фундамент", "Invalid foundation"));
    if (!typeOk(f)) return bad(L("Некорректный фундамент", "Invalid foundation"));
  }
  for (const p of pois) {
    if (!isRec(p) || !isStr(p.id, 200) || !isStr(p.name, 200) || typeof p.cls !== "string" || p.cls.length > 60 || !isPt([p.x, p.y])) return bad(L("Некорректное место", "Invalid place"));
  }
  for (const t of streets) if (!isRec(t) || !isStr(t.id, 200) || !isStr(t.name, 200)) return bad(L("Некорректная улица", "Invalid street"));

  const at = s.gameMinutes;
  const seenF = new Set(s.finds.foundations.map((f) => f.id));
  const seenP = new Set(s.finds.pois.map((p) => p.id));
  const seenS = new Set(s.finds.streets.map((t) => t.id));
  const seenName = new Set(s.finds.streets.map((t) => t.name));

  let chronicle = s.chronicle;
  const newPois: FoundPlace[] = [];
  for (const p of pois) {
    if (seenP.has(p.id)) continue;
    seenP.add(p.id);
    newPois.push({ id: p.id, name: p.name, kind: p.cls, digId: cmd.digId, at, x: r2(p.x), y: r2(p.y) });
    chronicle = addChronicle(chronicle, at, "dig:poi", L(`Раскоп: найдено место «${p.name}»`, `Dig: found a place, “${p.name}”`));
  }
  const newStreets: FoundPlace[] = [];
  for (const t of streets) {
    if (seenS.has(t.id) || seenName.has(t.name)) continue;
    seenS.add(t.id);
    seenName.add(t.name);
    newStreets.push({ id: t.id, name: t.name, kind: "street", digId: cmd.digId, at });
    chronicle = addChronicle(chronicle, at, "dig:street", L(`Раскоп: найдена старая улица — ${t.name}`, `Dig: found an old street — ${t.name}`));
  }
  const newF: FoundFoundation[] = [];
  let stone = 0;
  // Old saves hold foundations without a type: an id that arrives again with one is enriched in place.
  let known = s.finds.foundations;
  let enriched = 0;
  for (const f of foundations) {
    if (seenF.has(f.id) && f.cls !== undefined) {
      const i = known.findIndex((x) => x.id === f.id);
      if (i >= 0 && known[i].cls === undefined) {
        if (known === s.finds.foundations) known = known.slice();
        known[i] = { ...known[i], ...typeOf(f) };
        enriched++;
      }
      continue;
    }
    if (seenF.has(f.id) || s.finds.foundations.length + newF.length >= MAX_FOUNDATIONS) continue;
    seenF.add(f.id);
    newF.push({ id: f.id, ring: f.ring.map((p): Pt => [r2(p[0]), r2(p[1])]), area: f.area, digId: cmd.digId, at, ...typeOf(f) });
    stone += salvagedStone(f.area);
  }
  if (newF.length > 0) {
    const n = newF.length;
    const word = n % 10 === 1 && n % 100 !== 11 ? `открыт ${n} фундамент` : `открыто ${n} ${plural(n, "фундамент", "фундамента", "фундаментов")}`;
    chronicle = addChronicle(chronicle, at, "dig:found", L(`Раскоп: ${word}, +${tonnes(stone)} т камня`, `Dig: uncovered ${n} ${plural(n, "", "", "", "foundation")}, +${tonnes(stone)} t of stone`));
  }
  if (newF.length + newPois.length + newStreets.length + enriched === 0) return { ok: true, sim: s };
  return {
    ok: true,
    sim: {
      ...s,
      stock: stone > 0 ? { ...s.stock, stone: s.stock.stone + stone } : s.stock,
      chronicle,
      finds: {
        ...s.finds,
        foundations: newF.length ? [...known, ...newF] : known,
        pois: newPois.length ? [...s.finds.pois, ...newPois] : s.finds.pois,
        streets: newStreets.length ? [...s.finds.streets, ...newStreets] : s.finds.streets,
      },
    },
  };
}

// ---------- save ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Broken records are dropped one by one; a broken finds record is an empty one, never a lost town.
export function parseFinds(v: unknown): Finds {
  const out = emptyFinds();
  if (!isRec(v)) return out;
  const base = (r: Record<string, unknown>) => isStr(r.id, 200) && Number.isInteger(r.digId) && isNum(r.at);
  if (Array.isArray(v.foundations)) {
    for (const r of v.foundations) {
      if (!isRec(r) || !base(r) || !isNum(r.area) || r.area <= 0) continue;
      if (!Array.isArray(r.ring) || r.ring.length < 3 || r.ring.length > MAX_RING || !r.ring.every(isPt)) continue;
      const fd: FoundFoundation = { id: r.id as string, ring: (r.ring as Pt[]).map((p): Pt => [p[0], p[1]]), area: r.area, digId: r.digId as number, at: r.at as number };
      if (isStr(r.cls, 60)) fd.cls = r.cls;
      if (isStr(r.name, 200)) fd.name = r.name;
      if (isNum(r.height) && r.height >= 0 && r.height <= MAX_HEIGHT) fd.height = r.height;
      if (r.state === "restoring" || r.state === "restored" || r.state === "lost") fd.state = r.state;
      out.foundations.push(fd);
    }
  }
  for (const key of ["pois", "streets"] as const) {
    const list = v[key];
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      if (!isRec(r) || !base(r) || !isStr(r.name, 200) || typeof r.kind !== "string") continue;
      const p: FoundPlace = { id: r.id as string, name: r.name, kind: r.kind, digId: r.digId as number, at: r.at as number };
      if (isNum(r.x) && isNum(r.y)) {
        p.x = r.x;
        p.y = r.y;
      }
      out[key].push(p);
    }
  }
  if (Array.isArray(v.revealed)) {
    for (const r of v.revealed) {
      if (!isRec(r) || !Number.isInteger(r.digId) || !isNum(r.x) || !isNum(r.y) || !isNum(r.r) || r.r <= 0) continue;
      out.revealed.push({ digId: r.digId as number, x: r.x, y: r.y, r: r.r });
    }
  }
  return out;
}
