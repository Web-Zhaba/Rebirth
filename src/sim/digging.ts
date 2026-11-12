import { BUILDINGS } from "./buildings";
import { addChronicle } from "./chronicle";
import { salvagedStone } from "./excavation";
import { foundationScale, lotRing } from "./foundationLots";
import { canPlaceOnFoundation, placeOnFoundation } from "./growth";
import { kindName, siteTitle, tierContext, tierOf } from "./heritage";
import { beyondSurvey, catalogue, foundIds } from "./items";
import { orientedBox } from "./heritageGeo";
import { MAX_EVENTS } from "./people";
import { say } from "./production";
import { streetFoundations } from "./streets";
import type { Building, FoundFoundation, SimState } from "./types";
import { CELL_SIZE } from "./zones";
import { L, plural } from "../i18n";

// Digging a surveyed outline: the second stage of excavation. The order is a site of
// the artel on the old ring, built like any construction (an \`excavation\` building, so the work, the crews and the
// player's levers are those of construction); finished, it is gone and the foundation is dug: it can be built on, gives
// its old stone, and a unique old building opens with a card while an ordinary house opens quietly.

export const EXCAVATION = "excavation";
export const isExcavation = (b: Pick<Building, "template">): boolean => b.template === EXCAVATION;

export type DigResult<S = SimState> = { ok: true; sim: S; count: number } | { ok: false; reason: string };

// Why the outline cannot be ordered dug, or null.
export function digBlocker(s: Pick<SimState, "buildings">, f: FoundFoundation | undefined): string | null {
  if (!f) return L("Нет такой находки", "No such find");
  if (!f.ghost) return L("Фундамент уже раскопан", "The foundation is already dug");
  for (const b of Object.values(s.buildings)) if (b.foundationId === f.id) return L("Здесь уже копают", "It is being dug already");
  return null;
}

// The planned dig of an outline: the ring at full size, labor by its area.
export function excavationSite(f: FoundFoundation, id: number, now: number): Building {
  const t = BUILDINGS[EXCAVATION];
  const ring = lotRing(f);
  const box = orientedBox(ring);
  const k = foundationScale(t, f);
  return {
    id,
    template: EXCAVATION,
    zone: "placed",
    lot: { cx: box.cx, cy: box.cy, angle: box.angle, w: box.w / CELL_SIZE, d: box.d / CELL_SIZE },
    side: 1,
    footprint: ring,
    height: t.height,
    state: "planned",
    labor: Math.max(2, Math.round(t.labor * k * 10) / 10),
    done: 0,
    created: now,
    paid: false,
    level: 1,
    streak: 0,
    foundationId: f.id,
    scale: k,
  };
}

type DigState = Pick<SimState, "buildings" | "finds" | "nextBuildingId" | "gameMinutes">;

function order<S extends DigState>(s: S, list: readonly FoundFoundation[]): S {
  let id = s.nextBuildingId;
  const buildings = { ...s.buildings };
  for (const f of list) buildings[id] = excavationSite(f, id++, s.gameMinutes);
  return { ...s, buildings, nextBuildingId: id };
}

// Orders one outline dug.
export function orderDig<S extends DigState>(s: S, foundationId: unknown): DigResult<S> {
  if (typeof foundationId !== "string") return { ok: false, reason: L("Некорректная находка", "Invalid find") };
  const f = s.finds.foundations.find((x) => x.id === foundationId);
  const why = digBlocker(s, f);
  if (why) return { ok: false, reason: why };
  return { ok: true, sim: order(s, [f!]), count: 1 };
}

// Orders every outline of an old street dug that is not dug or being dug yet: one click for the whole street.
export function orderStreetDig(s: SimState, streetId: unknown): DigResult {
  if (typeof streetId !== "string") return { ok: false, reason: L("Некорректная улица", "Invalid street") };
  if (!s.finds.streets.some((t) => t.id === streetId)) return { ok: false, reason: L("Нет такой улицы", "No such street") };
  const todo = streetDigs(s, streetId);
  if (todo.length === 0) return { ok: false, reason: L("На этой улице копать нечего", "Nothing left to dig on this street") };
  return { ok: true, sim: order(s, todo), count: todo.length };
}

// The outlines of a street still to order dug.
export function streetDigs(s: Pick<SimState, "finds" | "buildings">, streetId: string): FoundFoundation[] {
  const own = streetFoundations(s.finds.streets, s.finds.foundations).get(streetId) ?? [];
  return own.filter((f) => digBlocker(s, f) === null);
}

// The street an outline belongs to, if any.
export function streetOf(s: Pick<SimState, "finds">, foundationId: string): { id: string; name: string } | null {
  for (const [id, list] of streetFoundations(s.finds.streets, s.finds.foundations))
    if (list.some((f) => f.id === foundationId)) {
      const t = s.finds.streets.find((x) => x.id === id);
      return t ? { id, name: t.name } : null;
    }
  return null;
}

// Every finished dig: the site goes, the foundation is dug, its stone goes to the stock (the camp takes what fits; the
// rest is counted as found and lies there). A unique old building opens with a discovery; a typical one with a short
// notice; an ordinary house quietly. Driven by the state, so admin finishing works too.
export function completeExcavations(s: SimState): SimState {
  const done = Object.values(s.buildings).filter((b) => isExcavation(b) && b.state === "active");
  if (done.length === 0) return s;
  const buildings = { ...s.buildings };
  const byId = new Map(s.finds.foundations.map((f, i) => [f.id, i]));
  const foundations = s.finds.foundations.slice();
  let stone = 0;
  let events = s.events;
  let chronicle = s.chronicle;
  const ctx = tierContext(s.finds, s.articles ?? []);
  for (const b of done) {
    delete buildings[b.id];
    const i = b.foundationId ? byId.get(b.foundationId) : undefined;
    if (i === undefined) continue;
    const { ghost: _g, ...f } = foundations[i];
    foundations[i] = f;
    stone += salvagedStone(f.area);
    const tier = tierOf(f, ctx);
    const at: [number, number] = [b.lot.cx, b.lot.cy];
    if (tier === "unique") {
      const text = L(`Открыто: ${siteTitle(f)} — ${kindName(f.cls).toLowerCase()}`, `Uncovered: ${siteTitle(f)} — ${kindName(f.cls).toLowerCase()}`);
      events = [...events, { at: s.gameMinutes, kind: "discovery" as const, text, pos: at, site: f.id }].slice(-MAX_EVENTS);
      chronicle = addChronicle(chronicle, s.gameMinutes, `found:${f.id}`, text);
    } else if (tier === "typical") events = say(events, s.gameMinutes, "heritage", L(`Раскопан: ${kindName(f.cls).toLowerCase()}`, `Dug out: ${kindName(f.cls).toLowerCase()}`), at);
  }
  const n = done.length;
  if (n > 1) chronicle = addChronicle(chronicle, s.gameMinutes, "dig:dug", L(`Раскопано ${n} ${plural(n, "фундамент", "фундамента", "фундаментов")}`, `${n} foundations dug`));
  let out: SimState = { ...s, buildings, events, chronicle, stock: stone > 0 ? { ...s.stock, stone: s.stock.stone + stone } : s.stock, finds: { ...s.finds, foundations } };
  // A dig a stroke ordered puts its building on the ring now (sim/stroke.ts); one no longer possible leaves it free.
  for (const b of done) {
    const t = b.then ? BUILDINGS[b.then] : undefined;
    if (t && b.foundationId && canPlaceOnFoundation(out, t, b.foundationId, true).ok) out = placeOnFoundation(out, t, b.foundationId, true); // its road may still be under way
  }
  return reportFinds(s, out, [done[0].lot.cx, done[0].lot.cy]);
}

// The finds the digs turned up (sim/items.ts), in one notice; those lying beyond the survey point to places not open yet.
function reportFinds(before: SimState, after: SimState, at: [number, number]): SimState {
  const had = foundIds(before);
  const now = foundIds(after);
  const fresh = catalogue(after).filter((i) => now.has(i.id) && !had.has(i.id));
  if (fresh.length === 0) return after;
  const names = fresh.slice(0, 3).map((i) => i.name).join(", ") + (fresh.length > 3 ? L(` и ещё ${fresh.length - 3}`, ` and ${fresh.length - 3} more`) : "");
  let events = say(after.events, after.gameMinutes, "heritage", L(`Находки: ${names}`, `Finds: ${names}`), at);
  for (const i of fresh.filter((x) => beyondSurvey(after.finds, x)).slice(0, 2))
    events = say(events, after.gameMinutes, "heritage", L(`${i.name} указывает на место за раскопом`, `${i.name} points to a place beyond the dig`), [i.x, i.y]);
  return { ...after, events };
}
