import { refreshServices } from "./coverage";
import { BUILDINGS } from "./buildings";
import { addArticles } from "./articles";
import { isCleared, nextClearingId, validateClearing } from "./clearing";
import { loseSite } from "./restore";
import { orderDig, orderStreetDig } from "./digging";
import { applyStroke, cancelPlans, planStroke, roadSpans, strokeTemplate, type StrokeSpan } from "./stroke";
import { returnFind, useFind } from "./items";
import { arrangeExhibitions, museumDaily, setExhibition } from "./museum";
import { cancelResearch, queueResearch, startResearch } from "./research";
import { lockReason } from "./tech";
import { callSettlers, callToloka, chooseHeadCmd, setAdultSchool, setFormCmd, setJobPriority, setPriority, setRations, setSchedule, setStaff, setTermCmd, setTrade, grantSupplies, nameStall } from "./leverCmds";
import { keepRevealed, recordFinds } from "./excavation";
import { canPlace, canPlaceOnFoundation, placeOnFoundation, placeBuilding, reconcile } from "./growth";
import { rebalanceJobs, syncPeople } from "./people";
import { pruneFieldWork } from "./fields";
import { L } from "../i18n";
import type { Cmd } from "./protocol";
import { addRoad, effectiveSpans, finishedRoadsChanged, removeEdge, ROAD_KINDS, spanReason, upgradeRoads } from "./roads";
import { nextFieldId, regenerateCells, validateField } from "./zones";
import type { Clearing, Field, RoadGraph, RoadHouses, SimState, Site, ZoneState } from "./types";

export const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Cells are derived data: rebuild them so saves without them (or with stale ones) are consistent.
export function rezone(z: ZoneState, roads: RoadGraph, fields: Field[]): ZoneState {
  return { ...z, fields, cells: regenerateCells(roads, fields, z.terrain), rev: z.rev + 1 };
}

// What one command yields: a new sim state, or the reason the player sees. Road commands also carry the road-laying
// queue (`roads` marks them), placeStroke the ids of what it laid; `unchanged` says nothing new came of the command
// (no snapshot, no save).
export type CmdOutcome =
  | { ok: true; sim: SimState; roads?: true; roadHouses?: RoadHouses[]; ids?: number[]; unchanged?: true }
  | { ok: false; reason: string };

// Applies one command of the protocol to the sim state. Session-level commands (setCityIdentity, the admin panel) and
// the free-finish rule stay in handler.ts; everything a player sends goes through the domain's own rules here.
export function applyCmd(sim: SimState, cmd: Cmd, roadHouses: RoadHouses[] | undefined): CmdOutcome {
  const roads = sim.roads;
  const z = sim.zones;
  let next: RoadGraph = roads;
  let prod = sim.prod;
  let zones: ZoneState;
  if (cmd.type === "addRoad") {
    const bad = validateAddRoad(cmd);
    if (bad) return { ok: false, reason: bad };
    const locked = lockReason(sim, cmd.kind);
    if (locked) return { ok: false, reason: locked };
    const tooLong = cmd.span === undefined ? null : spanReason(cmd.kind, cmd.span, effectiveSpans(sim.progress));
    if (tooLong) return { ok: false, reason: tooLong };
    const r = addRoad(roads, cmd.pts, cmd.kind, cmd.snapTol, cmd.labor);
    if (!r.ok) return { ok: false, reason: r.reason };
    next = r.graph;
    zones = rezone(z, next, z.fields);
    let queued = roadHouses;
    if (queued && r.splits.size) queued = queued.map((h) => ({ ...h, edges: h.edges.flatMap((id) => r.splits.get(id) ?? [id]) }));
    const t = cmd.houses ? strokeTemplate(cmd.houses.template) : null;
    // a house template the town cannot build yet leaves the road without them
    if (t && !(lockReason(sim, t.zone) ?? lockReason(sim, t.id))) {
      queued = [...(queued ?? []), { edges: r.added, template: t.id, only: cmd.houses?.onlyFoundations === true }];
    }
    roadHouses = queued;
  } else if (cmd.type === "upgradeRoad") {
    const bad = validateUpgradeRoad(cmd);
    if (bad) return { ok: false, reason: bad };
    const locked = lockReason(sim, cmd.kind);
    if (locked) return { ok: false, reason: locked };
    const tooLong = cmd.span === undefined ? null : spanReason(cmd.kind, cmd.span, effectiveSpans(sim.progress));
    if (tooLong) return { ok: false, reason: tooLong };
    const r = upgradeRoads(roads, cmd.edges, cmd.kind, cmd.labor);
    if (!r.ok) return { ok: false, reason: r.reason };
    next = r.graph;
    zones = rezone(z, next, z.fields);
  } else if (cmd.type === "removeRoad") {
    if (!Object.hasOwn(roads.edges, cmd.edgeId)) return { ok: false, reason: L("Участок уже убран", "The section is already removed") };
    next = removeEdge(roads, cmd.edgeId);
    zones = rezone(z, next, z.fields);
  } else if (cmd.type === "addField") {
    const v = validateField(cmd.pts, roads, z.fields, Object.values(sim.buildings).map((b) => b.footprint));
    if (!v.ok) return { ok: false, reason: v.reason };
    zones = rezone(z, roads, [...z.fields, { id: nextFieldId(z.fields), pts: v.pts, area: v.area }]);
  } else if (cmd.type === "removeField") {
    if (!z.fields.some((f) => f.id === cmd.id)) return { ok: false, reason: L("Поле уже убрано", "The field is already removed") };
    zones = rezone(z, roads, z.fields.filter((f) => f.id !== cmd.id));
    const fields = pruneFieldWork(zones.fields, prod.fields);
    if (fields !== prod.fields) prod = { ...prod, fields };
  } else if (cmd.type === "addClearing") {
    const v = validateClearing(cmd.pts, cmd.forest, roads, z.fields, sim.clearings);
    if (!v.ok) return { ok: false, reason: v.reason };
    const c: Clearing = { id: nextClearingId(sim.clearings), pts: v.pts, area: v.area, forest: cmd.forest, labor: v.labor, done: 0 };
    return { ok: true, sim: { ...sim, clearings: [...sim.clearings, c] } };
  } else if (cmd.type === "removeClearing") {
    const c = sim.clearings.find((x) => x.id === cmd.id);
    if (!c) return { ok: false, reason: L("Вырубка уже убрана", "The clearing is already removed") };
    if (isCleared(c)) return { ok: false, reason: L("Участок уже расчищен", "The area is already cleared") };
    return { ok: true, sim: { ...sim, clearings: sim.clearings.filter((x) => x !== c) } }; // logs already made stay in the stock
  } else if (cmd.type === "placeBuilding") {
    const t = typeof cmd.template === "string" && Object.hasOwn(BUILDINGS, cmd.template) ? BUILDINGS[cmd.template] : null;
    if (!t) return { ok: false, reason: L("Это здание нельзя поставить", "This building can’t be placed") };
    const locked = lockReason(sim, t.zone) ?? lockReason(sim, t.id);
    if (locked) return { ok: false, reason: locked };
    if (!Number.isInteger(cmd.edge) || !Number.isInteger(cmd.i) || (cmd.side !== 1 && cmd.side !== -1) || !validSite(cmd.site)) {
      return { ok: false, reason: L("Некорректное место", "Invalid place") };
    }
    const ok = canPlace(sim, t, cmd.edge, cmd.side, cmd.i, cmd.site);
    if (!ok.ok) return { ok: false, reason: ok.reason };
    return { ok: true, sim: placeBuilding(sim, t, cmd.edge, cmd.side, cmd.i, cmd.site) };
  } else if (cmd.type === "placeOnFoundation") {
    const t = typeof cmd.template === "string" && Object.hasOwn(BUILDINGS, cmd.template) ? BUILDINGS[cmd.template] : null;
    if (!t) return { ok: false, reason: L("Это здание нельзя поставить", "This building can’t be placed") };
    const locked = lockReason(sim, t.zone) ?? lockReason(sim, t.id);
    if (locked) return { ok: false, reason: locked };
    if (typeof cmd.foundationId !== "string") return { ok: false, reason: L("Некорректное место", "Invalid place") };
    const ok = canPlaceOnFoundation(sim, t, cmd.foundationId);
    if (!ok.ok) return { ok: false, reason: ok.reason };
    return { ok: true, sim: placeOnFoundation(sim, t, cmd.foundationId) };
  } else if (cmd.type === "placeStroke") {
    const t = strokeTemplate(cmd.template);
    if (!t) return { ok: false, reason: L("Это здание нельзя поставить", "This building can’t be placed") };
    const locked = lockReason(sim, t.zone) ?? lockReason(sim, t.id);
    if (locked) return { ok: false, reason: locked };
    if (!validSpans(cmd.spans) || (cmd.drop !== undefined && !validKeys(cmd.drop))) return { ok: false, reason: L("Некорректное место", "Invalid place") };
    const plan = planStroke(sim, t, cmd.spans, cmd.onlyFoundations === true);
    const drop = new Set(cmd.drop ?? []);
    const r = applyStroke(sim, plan.items.filter((it) => !drop.has(it.key)));
    if (r.placed === 0) return { ok: false, reason: plan.skipped[0]?.reason ?? L("Вдоль дороги здесь нет места", "No room along the road here") };
    const ids: number[] = [];
    for (let b = sim.nextBuildingId; b < r.sim.nextBuildingId; b++) ids.push(b);
    return { ok: true, sim: r.sim, ids };
  } else if (cmd.type === "cancelStroke") {
    if (!Array.isArray(cmd.ids) || cmd.ids.length > 10_000 || !cmd.ids.every((x) => Number.isInteger(x))) return { ok: false, reason: L("Некорректные здания", "Invalid buildings") };
    const r = cancelPlans(sim, cmd.ids);
    if (r.removed === 0) return { ok: false, reason: L("Отменять нечего: стройка уже началась", "Nothing to undo: work has already started") };
    return { ok: true, sim: refreshServices(syncPeople(r.sim)) };
  } else if (cmd.type === "returnFind" || cmd.type === "useFind" || cmd.type === "setExhibition" || cmd.type === "arrangeExhibitions") {
    const r = cmd.type === "returnFind" ? returnFind(sim, cmd.id) : cmd.type === "useFind" ? useFind(sim, cmd.id) : cmd.type === "setExhibition" ? setExhibition(sim, cmd.building, cmd.hall, cmd.theme) : arrangeExhibitions(sim);
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, sim: museumDaily(r.sim) }; // the halls show what changed at once
  } else if (cmd.type === "digFoundation" || cmd.type === "digStreet") {
    const r = cmd.type === "digFoundation" ? orderDig(sim, cmd.foundationId) : orderStreetDig(sim, cmd.streetId);
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, sim: r.sim };
  } else if (cmd.type === "recordFinds") {
    const r = recordFinds(sim, cmd);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.sim === sim) return { ok: true, sim, unchanged: true }; // nothing new: no save
    return { ok: true, sim: r.sim };
  } else if (cmd.type === "addArticles") {
    const r = addArticles(sim, cmd);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.sim === sim) return { ok: true, sim, unchanged: true }; // nothing new: no save
    return { ok: true, sim: r.sim };
  } else if (cmd.type === "setPriority" || cmd.type === "callToloka" || cmd.type === "setSchedule" || cmd.type === "setRations" || cmd.type === "setAdultSchool" || cmd.type === "callSettlers" || cmd.type === "grantSupplies" || cmd.type === "setJobPriority" || cmd.type === "setStaff" || cmd.type === "setTrade" || cmd.type === "nameStall" || cmd.type === "chooseHead" || cmd.type === "setGovForm" || cmd.type === "setTerm") {
    const r =
      cmd.type === "setPriority" ? setPriority(sim, cmd.key)
      : cmd.type === "callToloka" ? callToloka(sim, cmd.key)
      : cmd.type === "setSchedule" ? setSchedule(sim, cmd.strada)
      : cmd.type === "setRations" ? setRations(sim, cmd.rations)
      : cmd.type === "setAdultSchool" ? setAdultSchool(sim, cmd.on)
      : cmd.type === "setJobPriority" ? setJobPriority(sim, cmd.group, cmd.priority)
      : cmd.type === "setStaff" ? setStaff(sim, cmd.id, cmd.staff)
      : cmd.type === "setTrade" ? setTrade(sim, cmd.orders)
      : cmd.type === "nameStall" ? nameStall(sim, cmd.index, cmd.name)
      : cmd.type === "grantSupplies" ? grantSupplies(sim)
      : cmd.type === "chooseHead" ? chooseHeadCmd(sim, cmd.id)
      : cmd.type === "setGovForm" ? setFormCmd(sim, cmd.form)
      : cmd.type === "setTerm" ? setTermCmd(sim, cmd.term)
      : callSettlers(sim);
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, sim: r.sim };
  } else if (cmd.type === "startResearch" || cmd.type === "queueResearch" || cmd.type === "cancelResearch") {
    const r = cmd.type === "startResearch" ? startResearch(sim, cmd.techId) : cmd.type === "queueResearch" ? queueResearch(sim, cmd.techId) : cancelResearch(sim, cmd.techId);
    if (!r.ok) return { ok: false, reason: r.reason };
    return { ok: true, sim: r.sim };
  } else if (cmd.type === "demolish") {
    if (!Object.hasOwn(sim.buildings, cmd.id)) return { ok: false, reason: L("Здание уже снесено", "The building is already demolished") };
    const gone = sim.buildings[cmd.id];
    const rest = { ...sim.buildings };
    delete rest[cmd.id];
    return { ok: true, sim: refreshServices(syncPeople(loseSite({ ...sim, buildings: rest, finds: keepRevealed(sim.finds, gone) }, gone))) };
  } else {
    // admin in a production build falls through here: the branch is compiled out of handler.ts
    return { ok: false, reason: L("Неизвестная команда", "Unknown command") };
  }
  const buildings = reconcile(sim.buildings, next);
  const updated = syncPeople({ ...sim, roads: next, zones, buildings, prod });
  return { ok: true, sim: refreshServices(finishedRoadsChanged(roads, next) ? rebalanceJobs(updated) : updated), roads: true, roadHouses };
}

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
