import { homeGoods, NEED_PER_PERSON, needsAt, TOOL_USERS, TOOL_WEAR, TOOLLESS } from "./goods";
import { leverMood, workHours } from "./levers";
import { householdSatisfaction, MOOD_NEUTRAL, needMoodTerm, needsAfterDay, residentWorkFactor, starvingResidents, type NeedsDay } from "./needs";
import { allocateLabor, BUILDINGS, floorArea, FOUNDING_STOCK, foodCapacity, groupOf, homesOf, materialsOf, storageOf, storeRoom, upgradeMaterials, type Materials, type SiteLever, type StoreGroup } from "./buildings";
import { assignedHa, assignFields, bears, expectedKg, FIELD, foodKgHour, haOf, HARVEST_END_DAY, ORCHARD_YEARS, remainingHours, sowCredit, windowAt, workOf } from "./fields";
import { DIG, growDig, radiusOf } from "./excavation";
import { ageOf, foodOutlook, foodPerDay, forageKg, idleResidents, lotFront, MAX_EVENTS, productionScales } from "./people";
import { haulHours, Ledger } from "./storage";
import { adminOf, adminFactor } from "./governance";
import { buildingPriority } from "./jobs";
import { cropOf, fieldYieldMul, workshopMul } from "./tech";
import { massText } from "./units";
import { EVENING, eveningRate, gatherHouses } from "./evening";
import { covers, dwelling, SERVICE, serviceMood } from "./services";
import { tradeDay } from "./trade";
import { finishedMonuments, monumentMood, monumentsNear } from "./monuments";
import { calendar, DAY_MIN, dayOf, YEAR_DAYS, YEAR_MIN } from "./time";
import { applyFrost } from "./weather";
import { buildFactor, EFFECTS, emptyOrchard, fieldWork, firewoodDaily, frostNight, moodShift, orchardDay, orchardQuality, spoilage, workFactor } from "./weatherEffects";
import type { Building, Clearing, EconomyStats, EventKind, Field, Household, ProdFlags, ProdState, ProductionInfo, Resident, SimState, Stock, TownEvent } from "./types";
import { L } from "../i18n";

// Building materials come PACE times faster than in history; food and goods do not.
export const PACE = 4;

// Rates are per worker-hour during work hours.
export const RATE = {
  logs: 0.4, // m3, times PACE and the forest share
  planks: 0.02, // m3, times PACE
  logsPerPlank: 1.6, // m3 of logs per m3 of planks
  stone: 0.15, // t, times PACE; a quarry works on any land (rock nearby changes nothing)
  pottery: 0.025, // pieces of dishes
  weaver: 0.02, // pieces of clothing
  smithy: 0.015, // pieces of tools
  smithyLogs: 0.05, // m3 per piece (charcoal)
  carpentry: 0.015, // pieces of furnishings
  carpentryPlanks: 0.03, // m3 per piece
  householdsPerTrader: 12,
  moodStep: 0.25,
};
// A harvest window that closes with at most this share of the reaped grain still standing counts as a finished harvest.
export const HARVEST_OK = 0.25;
// Hours of hand work per unit when the stock lacks the materials of a building (already divided by PACE).
export const HAND_HOURS = { logs: 4, planks: 12, stone: 2 };

const EPS = 1e-9;

// Heating (docs/PLAN-restoration.md section 2.3): a house burns by its floor area, and only while somebody lives in it.
// The firewood rate of the weather is that of HEAT_AREA m2, the room of one family in a house of the old kind; a house
// of the old kind (and a tent) heats that much per family, a building on an old foundation its whole floor area, shared
// by the families in it, so a large half-filled house costs its whole area.
export const HEAT_AREA = 72; // m2

// m3 of firewood each household burns today, by household id.
export function heatShares(s: Pick<SimState, "households" | "buildings" | "weather">): Map<number, number> {
  const wood = firewoodDaily(s.weather);
  const out = new Map<number, number>();
  if (wood <= 0) return out;
  const living = new Map<number, number>(); // house id -> families in it
  for (const h of Object.values(s.households)) if (h.home !== null) living.set(h.home, (living.get(h.home) ?? 0) + 1);
  for (const h of Object.values(s.households)) {
    const b = h.home !== null ? s.buildings[h.home] : undefined;
    if (!b?.foundationId) {
      out.set(h.id, wood);
      continue;
    }
    const area = homesOf(b) > 0 ? floorArea(b) : HEAT_AREA;
    out.set(h.id, (wood * area) / HEAT_AREA / (living.get(b.id) ?? 1));
  }
  return out;
}
const heatDemand = (s: Pick<SimState, "households" | "buildings" | "weather">): number => {
  let sum = 0;
  for (const v of heatShares(s).values()) sum += v;
  return sum;
};

export const emptyStock = (): Stock => ({ ...FOUNDING_STOCK });
export const emptyFlags = (year = 1): ProdFlags => ({ year, sowing: false, harvest: false, done: false, closed: false, hungry: false, rot: 0 });
export const emptyProd = (): ProdState => ({ fields: {}, flags: emptyFlags(), today: {}, yesterday: {}, orchard: emptyOrchard() });

export function say(events: TownEvent[], at: number, kind: EventKind, text: string, pos?: [number, number]): TownEvent[] {
  return [...events, pos ? { at, kind, text, pos } : { at, kind, text }].slice(-MAX_EVENTS);
}

const SHORT_OF = { logs: L("брёвен", "logs"), planks: L("досок", "planks"), stone: L("камня", "stone") } as const;

// Notices for sites that were paid in this tick (`before` -> `after`, with the stock as it was before) and had to
// make part of their materials by hand: one "shortage" per material per game day. Mirrors payMaterials' accounting.
export function reportShortages(before: Record<number, Building>, after: Record<number, Building>, stock: Stock, events: TownEvent[], now: number): TownEvent[] {
  if (after === before) return events;
  const st = { ...stock };
  let out = events;
  for (const b of Object.values(after)) {
    const was = before[b.id];
    if (!was) continue;
    const up = b.state === "active" ? b.upgrade : undefined;
    const wasUp = was.state === "active" ? was.upgrade : undefined;
    if (up ? !(up.paid && wasUp && !wasUp.paid) : !(b.paid && !was.paid)) continue;
    const m = up ? upgradeMaterials(b) : materialsOf(b);
    if (!m) continue;
    const hand = up ? up.labor > (wasUp?.labor ?? 0) : (b.hand ?? 0) > 0;
    for (const g of ["logs", "planks", "stone"] as const) {
      const need = m[g];
      if (hand && need > st[g]) {
        const text = L(`Не хватает ${SHORT_OF[g]}: часть работы делают вручную`, `Short of ${SHORT_OF[g]}: part of the work is done by hand`);
        if (!out.some((e) => e.kind === "shortage" && e.text === text && dayOf(e.at) === dayOf(now))) out = say(out, now, "shortage", text, [b.lot.cx, b.lot.cy]);
      }
      st[g] -= Math.min(st[g], need);
    }
  }
  return out;
}


// Flags of the calendar year (the event flags start over every year).
const flagsFor = (f: ProdFlags, year: number): ProdFlags => (f.year === year ? f : { ...f, year, sowing: false, harvest: false, done: false, closed: false });

// ---------- workers ----------

interface Workers {
  n: Map<number, number>; // workers per workplace id
  eff: Map<number, number>; // their working strength: needs and household mood, 1 for a content worker
  lit: Map<number, number>; // their literacy, summed as shares (school / 100), weighted by the same strength
}
// Mood can change without the residents changing, so the cache hangs on both objects.
const workerCache = new WeakMap<object, WeakMap<object, Workers>>();

// Jobs change only at the daily step, so this holds for a whole day.
function workersByJob(residents: Record<number, Resident>, households: Record<number, Household>): Workers {
  let byHouseholds = workerCache.get(residents);
  if (!byHouseholds) {
    byHouseholds = new WeakMap();
    workerCache.set(residents, byHouseholds);
  }
  const hit = byHouseholds.get(households);
  if (hit) return hit;
  const w: Workers = { n: new Map(), eff: new Map(), lit: new Map() };
  for (const r of Object.values(residents)) {
    if (r.job === null) continue;
    const strength = residentWorkFactor(r, households[r.household]?.mood ?? MOOD_NEUTRAL);
    w.n.set(r.job, (w.n.get(r.job) ?? 0) + 1);
    w.eff.set(r.job, (w.eff.get(r.job) ?? 0) + strength);
    w.lit.set(r.job, (w.lit.get(r.job) ?? 0) + (r.school / 100) * strength);
  }
  byHouseholds.set(households, w);
  return w;
}

// ---------- construction materials ----------

// Person-hours of hand work that the stock's shortfall of `m` adds to a building.
export function handHours(m: Materials, st: Stock): number {
  let hours = 0;
  for (const g of ["logs", "planks", "stone"] as const) hours += Math.max(0, m[g] - st[g]) * HAND_HOURS[g];
  return hours;
}

// Takes the materials of the sites that receive their first person-hour in this spending (the same sites
// advanceBuildings serves, see allocateLabor). What the stock lacks is made by hand and added to the labor. With a
// `ledger` the materials come from the stores nearest to the site, and their carting is added to the labor too.
export function payMaterials(
  buildings: Record<number, Building>,
  stock: Stock,
  personHours: number,
  crewHours = Infinity, // no crew limit: sites are served one after another
  clearings: readonly Clearing[] = [],
  first = false, // the clearings take their crews before the buildings (see clearingsFirst)
  lever?: SiteLever,
  ledger?: Ledger,
): { buildings: Record<number, Building>; stock: Stock } {
  let out = buildings;
  let st = ledger ? ledger.stock : stock;
  for (const id of allocateLabor(buildings, personHours, crewHours, clearings, first, lever).keys()) {
    let b = buildings[id];
    // A finished house being upgraded is served like a building under construction.
    const up = b.state === "active" ? b.upgrade : undefined;
    if (up ? up.paid : b.paid) continue;
    const m = up ? upgradeMaterials(b) : materialsOf(b);
    let hand = 0;
    let haul = 0;
    if (m) {
      hand = handHours(m, st);
      if (ledger) for (const g of ["logs", "planks", "stone"] as const) haul += ledger.take(g, Math.min(st[g], m[g]), lotFront(b)).haul;
      else {
        const next = { ...st };
        for (const g of ["logs", "planks", "stone"] as const) next[g] -= Math.min(next[g], m[g]);
        st = next;
      }
    }
    const labor = (up ? up.labor : b.labor) + hand + haul;
    b = up ? { ...b, upgrade: { ...up, paid: true, labor } } : { ...b, paid: true, labor, ...(hand > 0 ? { hand } : {}), ...(haul > 0 ? { haul } : {}) };
    if (out === buildings) out = { ...buildings };
    out[id] = b;
  }
  return { buildings: out, stock: ledger ? { ...ledger.stock } : st };
}

// ---------- production (every work-hour tick) ----------

// One tick of `dt` hours of work: producers, workshops and field work. Call during work hours only.
// `scale` is the share of work left after workers were drafted into the artel (see people.ts): one for all, or by priority.
export function produceStep(s: SimState, dt: number, scale: number | readonly number[] = productionScales(s)): SimState {
  const cal = calendar(s.gameMinutes);
  const workers = workersByJob(s.residents, s.households);
  const win = windowAt(s.gameMinutes);
  const ledger = new Ledger(s);
  const stock = ledger.stock; // the totals, kept by the ledger
  const today = { ...s.prod.today };
  const haul: Record<number, number> = {};
  const full = new Set<StoreGroup>(); // groups some producer found no room for
  let flags = flagsFor(s.prod.flags, cal.year);
  let fields = s.prod.fields;
  let events = s.events;
  let buildings = s.buildings;
  const shopMul = workshopMul(s.progress);
  const admin = adminFactor(s); // past what the offices can manage every work goes slower
  // food that finds no room in the stores rots
  const addFood = (kg: number, at: [number, number]) => {
    const { stored } = ledger.put("food", kg, at);
    flags = { ...flags, rot: flags.rot + (kg - stored) };
  };
  // Units made in `h` work hours at `perHour` a work hour: the producer carts its output to the nearest store with room
  // (and its input from the nearest store holding it), which takes its share of the hours (docs/PLAN-balance.md B4).
  const carted = (b: Building, g: keyof Stock, perHour: number, h: number, input?: { g: keyof Stock; per: number }): number => {
    if (h <= 0 || perHour <= 0) return 0;
    const at = lotFront(b);
    const out = ledger.near(g, at, "room")[0];
    if (!out && g !== "food") {
      full.add(groupOf(g));
      return 0;
    }
    let perUnit = out ? haulHours(g, 1, out.metres) : 0;
    const src = input && ledger.near(input.g, at, "held")[0];
    if (input && src) perUnit += haulHours(input.g, input.per, src.metres);
    haul[b.id] = (perHour * perUnit) / (1 + perHour * perUnit);
    return (h * perHour) / (1 + perHour * perUnit);
  };
  // Output put into the stores; what does not fit is not made (food rots instead).
  const store = (b: Building, g: keyof Stock, q: number): number => {
    if (q <= 0) return 0;
    if (g === "food") {
      addFood(q, lotFront(b));
      return q;
    }
    const room = ledger.roomFor(g);
    if (room < q) full.add(groupOf(g));
    return ledger.put(g, Math.min(q, room), lotFront(b)).stored;
  };
  const made = (id: number, n: number) => {
    if (n > 0) today[id] = (today[id] ?? 0) + n;
  };
  let assign: ReadonlyMap<number, number> | null = null;
  let harvested = false;
  let toolless = false;

  for (const b of Object.values(s.buildings)) {
    if (b.state !== "active") continue;
    const n = workers.n.get(b.id) ?? 0;
    if (n === 0) continue;
    // A hungry, tired or unhappy worker gives fewer hours; literate hands add to a workshop.
    const strength = workers.eff.get(b.id) ?? n;
    const eff = b.zone === "craft" ? strength + SERVICE.literateBoost * (workers.lit.get(b.id) ?? 0) : strength;
    const wf = workFactor(b.template, s.weather); // rain, frost, storms
    if (wf <= 0) continue;
    let h = eff * dt * wf * admin * (b.zone === "craft" ? shopMul : 1) * (typeof scale === "number" ? scale : scale[buildingPriority(b, s.levers)]);
    if (TOOL_USERS.has(b.template)) {
      // tools wear out with the work; what has none works at TOOLLESS of its rate
      const wear = h * TOOL_WEAR;
      const got = ledger.take("tools", Math.min(stock.tools, wear), lotFront(b)).taken;
      if (got < wear - EPS) toolless = true;
      h *= TOOLLESS + (1 - TOOLLESS) * (wear > 0 ? got / wear : 1);
    }
    switch (b.template) {
      case "woodcutter": {
        made(b.id, store(b, "logs", carted(b, "logs", RATE.logs * PACE * (b.site?.forest ?? 0), h)));
        break;
      }
      case "sawpit": {
        // taking the logs frees more room in the timber stores than the planks need
        const q = Math.min(carted(b, "planks", RATE.planks * PACE, h, { g: "logs", per: RATE.logsPerPlank }), stock.logs / RATE.logsPerPlank);
        if (q <= 0) break;
        ledger.take("logs", q * RATE.logsPerPlank, lotFront(b));
        made(b.id, store(b, "planks", q));
        break;
      }
      case "quarry": {
        made(b.id, store(b, "stone", carted(b, "stone", RATE.stone * PACE, h)));
        break;
      }
      case "fisher":
      case "garden":
      case "hunter":
      case "forager":
      case "apiary":
      case "orchard": {
        // fruit trees bear a year after they were planted, and the year decides how much
        const bear = b.template !== "orchard" ? 1 : bears(b, s.gameMinutes) ? orchardQuality(s.prod.orchard) : 0;
        made(b.id, store(b, "food", carted(b, "food", foodKgHour(b.template, cal.season) * bear, h)));
        break;
      }
      case "pottery": {
        made(b.id, store(b, "dishes", carted(b, "dishes", RATE.pottery, h)));
        break;
      }
      case "weaver": {
        made(b.id, store(b, "clothes", carted(b, "clothes", RATE.weaver, h)));
        break;
      }
      case "smithy": {
        const q = Math.min(carted(b, "tools", RATE.smithy, h, { g: "logs", per: RATE.smithyLogs }), stock.logs / RATE.smithyLogs, ledger.roomFor("tools"));
        if (q <= 0) break;
        ledger.take("logs", q * RATE.smithyLogs, lotFront(b));
        made(b.id, store(b, "tools", q));
        break;
      }
      case "carpentry": {
        const q = Math.min(carted(b, "furniture", RATE.carpentry, h, { g: "planks", per: RATE.carpentryPlanks }), stock.planks / RATE.carpentryPlanks, ledger.roomFor("furniture"));
        if (q <= 0) break;
        ledger.take("planks", q * RATE.carpentryPlanks, lotFront(b));
        made(b.id, store(b, "furniture", q));
        break;
      }
      case "dig": {
        const r0 = radiusOf(b);
        const r = growDig(r0, h);
        if (r === r0) break;
        if (buildings === s.buildings) buildings = { ...buildings };
        buildings[b.id] = { ...b, radius: r };
        break;
      }
      case "gumno": {
        if (win === null) break;
        assign ??= assignFields(s.zones.fields, s.buildings);
        const mine = s.zones.fields.filter((f) => assign!.get(f.id) === b.id);
        const rem = mine.map((f) => {
          return remainingHours(f, workOf(fields, f.id, cal.year), win, cropOf(s));
        });
        const total = rem.reduce((m, r) => m + r, 0);
        if (total <= EPS) break;
        const use = Math.min(win === "sowing" ? h * sowCredit(s.gameMinutes) : h, total); // sowing progress; late hours count less
        if (fields === s.prod.fields) fields = { ...fields };
        mine.forEach((f, i) => {
          const part = (use * rem[i]) / total;
          const w = workOf(fields, f.id, cal.year);
          if (win === "sowing") fields[f.id] = { ...w, sowH: w.sowH + part };
          else fields[f.id] = { ...w, harvH: w.harvH + part, reaped: w.reaped + part * FIELD.reapKgHour };
        });
        if (win === "sowing") {
          if (!flags.sowing) {
            flags = { ...flags, sowing: true };
            events = say(events, s.gameMinutes, "farm", L("Начался сев", "Sowing has begun"), [b.lot.cx, b.lot.cy]);
          }
        } else {
          harvested = true;
          const kg = use * FIELD.reapKgHour;
          addFood(kg, lotFront(b));
          made(b.id, kg);
          if (!flags.harvest) {
            flags = { ...flags, harvest: true };
            events = say(events, s.gameMinutes, "farm", L("Началась уборка урожая", "The harvest has begun"), [b.lot.cx, b.lot.cy]);
          }
        }
        break;
      }
    }
  }

  if (harvested && !flags.done) {
    // Done when every field a gumno works has given what its sowing allowed.
    const work = s.zones.fields.filter((f) => assign!.has(f.id));
    let left = 0;
    let got = 0;
    for (const f of work) {
      const w = workOf(fields, f.id, cal.year);
      left += expectedKg(f, w, cropOf(s)) - w.reaped;
      got += w.reaped;
    }
    if (work.length > 0 && left <= 1e-6) {
      flags = { ...flags, done: true };
      events = say(events, s.gameMinutes, "farm", L(`Урожай собран: ${massText(got)}`, `Harvest gathered: ${massText(got)}`));
    }
  }
  if (toolless) {
    // once a game day: a smithy that makes a few tools an hour must not repeat it every tick
    const text = L("Инструменты кончились: мастерские, лесорубы и фермы работают вдвое медленнее", "Tools have run out: workshops, woodcutters and farms work at half pace");
    if (!events.some((e) => e.kind === "shortage" && e.text === text && dayOf(e.at) === dayOf(s.gameMinutes))) events = say(events, s.gameMinutes, "shortage", text);
  }
  for (const g of full) {
    // once a game day per group, like the tools
    const text = FULL_TEXT[g];
    if (!events.some((e) => e.kind === "shortage" && e.text === text && dayOf(e.at) === dayOf(s.gameMinutes))) events = say(events, s.gameMinutes, "shortage", text);
  }
  return { ...s, stock: { ...ledger.stock }, stores: ledger.stores, events, buildings, prod: { ...s.prod, fields, today, flags, haul } };
}

export const overloadText = (pop: number, capacity: number, factor: number): string =>
  L(`Перегрузка управления: ${pop} жителей, управы справляются с ${Math.round(capacity)} — вся работа медленнее на ${Math.round((1 - factor) * 100)} %`, `Administration overloaded: ${pop} residents, the offices manage ${Math.round(capacity)} — all work is ${Math.round((1 - factor) * 100)}% slower`);

export const FULL_TEXT: Record<StoreGroup, string> = {
  food: L("Еде некуда класть: нужен амбар или погреб", "No room for food: a barn or cellar is needed"),
  wood: L("Лесу некуда класть: нужен склад леса", "No room for timber: a timber yard is needed"),
  stone: L("Камню некуда класть: нужен склад камня", "No room for stone: a stone yard is needed"),
  goods: L("Товарам некуда класть: нужен товарный склад", "No room for goods: a warehouse is needed"),
};

// ---------- daily ----------

// A night frost in the window (a fifth of the fields sown, harvest not closed) takes yield potential from the weather and
// the grain it stood for; reported as a farm event. Once per night: the caller runs at 00:00.
function nightFrost(s: SimState, events: TownEvent[]): { weather: SimState["weather"]; events: TownEvent[] } {
  const w = s.weather;
  const cal = calendar(s.gameMinutes);
  if (!frostNight(w) || cal.dayOfYear > HARVEST_END_DAY) return { weather: w, events };
  const assign = assignFields(s.zones.fields, s.buildings);
  let sown = 0;
  let need = 0;
  for (const f of s.zones.fields) {
    if (!assign.has(f.id)) continue;
    sown += Math.min(workOf(s.prod.fields, f.id, cal.year).sowH, FIELD.sowHoursHa * haOf(f));
    need += FIELD.sowHoursHa * haOf(f);
  }
  if (need <= 0 || sown / need < EFFECTS.frostSown) return { weather: w, events };
  const next = applyFrost(w, w.yesterday.min);
  if (next === w) return { weather: w, events };
  const standing = (crop: number) => s.zones.fields.reduce((m, f) => (assign.has(f.id) ? m + Math.max(0, expectedKg(f, workOf(s.prod.fields, f.id, cal.year), crop) - workOf(s.prod.fields, f.id, cal.year).reaped) : m), 0);
  const loss = standing(w.crop * fieldYieldMul(s.progress)) - standing(next.crop * fieldYieldMul(s.progress));
  const pctLost = Math.round((1 - next.frost / w.frost) * 100);
  const text = L(`Заморозок: ночью ${Math.round(w.yesterday.min)} °C, урожай потерял ${pctLost} %${loss >= 1 ? ` (около ${massText(loss)} зерна)` : ""}`, `Frost: ${Math.round(w.yesterday.min)} °C at night, the crop lost ${pctLost}%${loss >= 1 ? ` (about ${massText(loss)} of grain)` : ""}`);
  return { weather: next, events: say(events, s.gameMinutes, "farm", text) };
}

// 00:00: yesterday's output is filed, people eat, goods are handed out, moods move, the harvest window
// is settled, food above the barns' capacity rots. Runs before the people's daily step.
export function dailyEconomy(s: SimState): SimState {
  const now = s.gameMinutes;
  const cal = calendar(now);
  let flags = flagsFor(s.prod.flags, cal.year);
  let events = s.events;
  // households fetch their food, goods and firewood from the stores nearest to their home (tents: the camp)
  const ledger = new Ledger(s);
  const stock = ledger.stock;
  const camp: [number, number] = [0, 0];
  const homeAt = (h: Household): [number, number] => {
    const home = h.home !== null ? s.buildings[h.home] : undefined;
    return home ? lotFront(home) : camp;
  };
  const frost = nightFrost(s, events);
  events = frost.events;
  let buildings = s.buildings;
  for (const b of Object.values(s.buildings)) {
    if (b.template !== "orchard" || b.state !== "active" || b.ripe !== undefined) continue;
    if (buildings === s.buildings) buildings = { ...buildings };
    buildings[b.id] = { ...b, ripe: now + ORCHARD_YEARS * YEAR_MIN }; // finished: the trees take a year to bear
  }
  const orchard = orchardDay(s.prod.orchard, s.weather, calendar(now - 60).year, calendar(now - 60).season); // the day that ended

  // the idle adults gather food for the town (as far as the barns hold it)
  ledger.put("food", forageKg(s), camp);

  // food: each household eats its share
  const need = foodPerDay(s.residents, now, s.levers, s.weather);
  const eaten = Math.min(stock.food, need);
  let mouths = 0;
  for (const h of Object.values(s.households)) mouths += h.members.length;
  if (mouths > 0) for (const h of Object.values(s.households)) ledger.take("food", (eaten * h.members.length) / mouths, homeAt(h));
  const fed = need > 0 ? eaten / need : 1;
  if (fed < 1 - EPS && !flags.hungry) {
    flags = { ...flags, hungry: true };
    events = say(events, now, "food", L("Еда закончилась, люди голодают", "Food has run out, people are starving"));
  } else if (fed >= 1 - EPS && flags.hungry) flags = { ...flags, hungry: false };
  // heat and damp spoil the stock; what lies in cellars and barns suffers less (cellars hold the best), at the camp most
  for (const p of ledger.points) {
    const kind = s.buildings[p.id]?.template;
    const spoiled = ledger.held(p.id, "food") * spoilage(s.weather, kind === "barn" ? 1 : 0, kind === "cellar" ? 1 : 0);
    ledger.lose(p.id, "food", spoiled);
    flags = { ...flags, rot: flags.rot + spoiled };
  }
  // food with no room rots: what lies beyond a store's room (a store was demolished, an old save) or found none
  flags = { ...flags, rot: flags.rot + ledger.trim("food") + (ledger.lost.food ?? 0) };
  if (flags.rot >= (s.weather.site ? EFFECTS.rotReport : 1)) {
    events = say(events, now, "food", L(`Пропало ${Math.round(flags.rot)} кг еды: ${s.weather.site ? "жара, сырость, не хватает складов" : "не хватает складов"}`, `${Math.round(flags.rot)} kg of food spoiled: ${s.weather.site ? "heat, damp, not enough storage" : "not enough storage"}`));
    flags = { ...flags, rot: 0 };
  }

  // goods: each employed trade worker serves 12 households a day (a literate one 20 % more, a learning one part of it), starting
  // from a different one each day; each market worker then hands out to 20 households the market covers
  let shopSlots = 0;
  let marketSlots = 0;
  let traders = 0; // working strength of the market workers
  for (const r of Object.values(s.residents)) {
    if (r.job === null) continue;
    const b = s.buildings[r.job];
    if (!b || b.state !== "active") continue;
    const strength = residentWorkFactor(r, s.households[r.household]?.mood ?? MOOD_NEUTRAL);
    if (b.zone === "trade") shopSlots += RATE.householdsPerTrader * (1 + (SERVICE.literateBoost * r.school) / 100) * strength;
    else if (b.template === "market") {
      marketSlots += SERVICE.marketHouseholds * strength;
      traders += strength;
    }
  }
  // the markets swap the ordered goods before the day's goods are handed out
  const swap = tradeDay(stock, s.levers.trade, traders, ledger.roomFor("food"));
  if (swap) {
    Object.assign(stock, swap.stock);
    ledger.sync(); // the traded goods come to and go from the stores nearest to the camp
  }
  const ids = Object.keys(s.households).map(Number).sort((p, q) => p - q);
  const served = new Map<number, number>(); // household -> share of its need supplied
  // a household needs the goods of its house's level (a tent counts as level 1)
  const hand = (h: Household) => {
    const level = h.home !== null ? (s.buildings[h.home]?.level ?? 1) : 1;
    let want = 0;
    let give = 0;
    for (const g of needsAt(level)) {
      const w = NEED_PER_PERSON[g] * h.members.length;
      const t = ledger.take(g, Math.min(w, stock[g]), homeAt(h)).taken;
      want += w;
      give += t;
    }
    served.set(h.id, want > 0 ? give / want : 1);
  };
  let slots = Math.floor(shopSlots + EPS);
  for (let k = 0; k < ids.length && slots > 0 && homeGoods(stock) > EPS; k++) {
    hand(s.households[ids[(k + dayOf(now)) % ids.length]]);
    slots--;
  }
  slots = Math.floor(marketSlots + EPS);
  for (let k = 0; k < ids.length && slots > 0 && homeGoods(stock) > EPS; k++) {
    const h = s.households[ids[(k + dayOf(now)) % ids.length]];
    if (served.has(h.id) || !covers(s.coverage[dwelling(h)], "market")) continue;
    hand(h);
    slots--;
  }

  // firewood: every household burns by the cold of the day that ended; those the logs do not reach stay cold
  const cold = new Set<number>();
  const heat = heatShares(s);
  let burn = 0;
  for (const v of heat.values()) burn += v;
  ledger.put("logs", brushwood(s, burn), camp); // the idle gather brushwood when the logs will not last the day
  if (burn > 0) {
    for (const id of ids) {
      const wood = heat.get(id) ?? 0;
      if (wood <= 0) continue;
      const ok = stock.logs >= wood - EPS;
      ledger.take("logs", Math.min(wood, stock.logs), homeAt(s.households[id]));
      if (!ok) cold.add(id);
    }
    if (cold.size > 0 && !Object.values(s.households).some((h) => h.cold)) events = say(events, now, "shortage", L("Дров нет, люди мёрзнут", "No firewood, people are freezing"));
  }

  // the administration falls behind: said once a day while it lasts
  const admin = adminOf(s);
  if (admin.factor < 1) events = say(events, now, "shortage", overloadText(admin.pop, admin.capacity, admin.factor));

  // Personal needs of the day that ended. Mood is coloured by the needs the day began with (the values on `s`), so a
  // single daily step still uses the state it was called with; the fresh needs are what the next day works with.
  const hours = workHours(s.levers).end - workHours(s.levers).start;
  let residents = s.residents;
  const gather = gatherHouses(s); // evening gatherings: a tavern in reach or a chapel
  for (const r of Object.values(s.residents)) {
    const h = s.households[r.household];
    if (!h) continue;
    const home = h.home !== null ? s.buildings[h.home] : undefined;
    const day: NeedsDay = { now, fed, served: served.get(h.id) ?? 0, gather: gather.has(dwelling(h)), cold: cold.has(h.id), hours };
    if (residents === s.residents) residents = { ...residents };
    residents[r.id] = { ...r, needs: needsAfterDay(r, h, home, day) };
  }
  const starving = starvingResidents(residents);
  if (starving > 0 && !flags.starving) {
    flags = { ...flags, starving: true };
    events = say(events, now, "food", L("Люди истощены: голод подрывает силы", "People are exhausted: hunger saps their strength"));
  } else if (starving === 0 && flags.starving) {
    const { starving: _starving, ...rest } = flags;
    flags = rest;
  }

  // mood
  const households: Record<number, Household> = {};
  const weatherMood = moodShift(s.weather);
  const idle = idleResidents(s);
  const monuments = finishedMonuments(s.buildings);
  for (const h of Object.values(s.households)) {
    let adults = 0;
    let idlers = 0;
    for (const m of h.members) {
      const r = s.residents[m];
      if (!r) continue;
      const age = ageOf(r.born, now);
      if (age >= 16 && age < 60) adults++;
      if (idle.has(m)) idlers++;
    }
    const jobless = adults > 0 ? 12 * (idlers / adults) : 0;
    const kids = h.members.some((m) => {
      const r = s.residents[m];
      const age = r ? ageOf(r.born, now) : 0;
      return age >= SERVICE.schoolFrom && age < SERVICE.schoolTo;
    });
    const home = h.home !== null ? s.buildings[h.home] : undefined;
    const bonus = h.home !== null ? serviceMood(s.coverage[h.home], kids) + (gather.has(h.home) ? EVENING.gatherMood : 0) + (home ? monumentMood(monumentsNear(monuments, home.lot.cx, home.lot.cy)) : 0) : 0;
    const needMood = needMoodTerm(householdSatisfaction(h.members, s.residents));
    const target = Math.min(100, Math.max(0, 10 + 45 * fed + 10 * (served.get(h.id) ?? 0) + 10 * (h.home !== null ? 1 : 0) + bonus - jobless + leverMood(s.levers) + weatherMood + (cold.has(h.id) ? EFFECTS.unheatedMood : 0) + needMood));
    const next: Household = { ...h, mood: h.mood + (target - h.mood) * RATE.moodStep, served: served.get(h.id) ?? 0 };
    if (cold.has(h.id)) next.cold = true;
    else delete next.cold;
    households[h.id] = next;
  }

  // the harvest window is over: whatever stands unreaped is lost
  let fields = s.prod.fields;
  const over = cal.season === 3 || (cal.season === 2 && cal.dayOfSeason > FIELD.harvestDays);
  if (over && !flags.closed) {
    const assign = assignFields(s.zones.fields, s.buildings);
    let lost = 0;
    let got = 0;
    for (const f of s.zones.fields) {
      if (!assign.has(f.id)) continue;
      const w = workOf(fields, f.id, cal.year);
      lost += Math.max(0, expectedKg(f, w, cropOf(s)) - w.reaped);
      got += w.reaped;
    }
    flags = { ...flags, closed: true };
    // Most of the grain in the barn counts as a harvest (the goal and the chronicle must not wait a year for the last sheaves).
    if (flags.harvest && !flags.done && got > 0 && lost <= HARVEST_OK * got) {
      flags = { ...flags, done: true };
      events = say(events, now, "farm", L(`Урожай собран: ${massText(got)}`, `Harvest gathered: ${massText(got)}`));
    }
    if (lost >= 1) events = say(events, now, "farm", L(`Зерно осталось в поле и пропало: ${massText(lost)}`, `Grain left in the field and was lost: ${massText(lost)}`));
  }
  // progress of fields that are gone or of earlier years is dropped
  const live = new Set(s.zones.fields.map((f) => f.id));
  for (const [key, w] of Object.entries(fields)) {
    if (live.has(Number(key)) && w.year === cal.year) continue;
    if (fields === s.prod.fields) fields = { ...fields };
    delete fields[Number(key)];
  }

  return { ...s, stock: { ...ledger.stock }, stores: ledger.stores, events, buildings, residents, households, weather: frost.weather, prod: { fields, flags, today: {}, yesterday: s.prod.today, orchard, ...(s.prod.haul ? { haul: s.prod.haul } : {}), ...(swap && s.levers.trade ? { trade: { ...s.levers.trade, gave: swap.gave, got: swap.got } } : {}) } };
}

// m3 of brushwood the idle adults gather in a day: only when a household is cold or the stock is below the day's
// burning (`demand`, m3); a third less under snow.
export function brushwood(s: SimState, demand: number): number {
  if (demand <= 0 || (s.stock.logs >= demand && !Object.values(s.households).some((h) => h.cold))) return 0;
  return idleResidents(s).size * EFFECTS.brush.m3 * (s.weather.snowpack > EFFECTS.groundSnow ? EFFECTS.brush.snow : 1);
}

// ---------- aggregates and inspector ----------

export const GOOD: Record<string, keyof Stock> = {
  woodcutter: "logs",
  sawpit: "planks",
  quarry: "stone",
  fisher: "food",
  garden: "food",
  hunter: "food",
  forager: "food",
  orchard: "food",
  apiary: "food",
  gumno: "food",
  pottery: "dishes",
  weaver: "clothes",
  smithy: "tools",
  carpentry: "furniture",
};

export function economyStats(s: SimState): EconomyStats {
  const need = foodPerDay(s.residents, s.gameMinutes, s.levers, s.weather);
  const yesterday: Stock = { food: 0, logs: 0, planks: 0, stone: 0, clothes: 0, dishes: 0, furniture: 0, tools: 0 };
  for (const [key, n] of Object.entries(s.prod.yesterday)) {
    const b = s.buildings[Number(key)];
    const g = b && GOOD[b.template];
    if (g) yesterday[g] += n;
  }
  const year = calendar(s.gameMinutes).year;
  const assign = assignFields(s.zones.fields, s.buildings);
  let ha = 0;
  let aHa = 0;
  let sownH = 0;
  let sowNeed = 0;
  let reaped = 0;
  let expected = 0;
  for (const f of s.zones.fields) {
    ha += haOf(f);
    if (!assign.has(f.id)) continue;
    const w = workOf(s.prod.fields, f.id, year);
    aHa += haOf(f);
    sownH += Math.min(w.sowH, FIELD.sowHoursHa * haOf(f));
    sowNeed += FIELD.sowHoursHa * haOf(f);
    reaped += w.reaped;
    expected += expectedKg(f, w, cropOf(s));
  }
  let moods = 0;
  let hs = 0;
  let unheated = 0;
  let unheatedPeople = 0;
  for (const h of Object.values(s.households)) {
    moods += h.mood;
    hs++;
    if (h.cold) {
      unheated++;
      unheatedPeople += h.members.length;
    }
  }
  return {
    foodCap: foodCapacity(s.buildings),
    foodPerDay: need,
    foodDays: need > 0 ? Math.min(999, s.stock.food / need) : 999,
    yesterday,
    fields: { count: s.zones.fields.length, ha, assignedHa: aHa, sown: sowNeed > 0 ? sownH / sowNeed : 0, reaped, expected, window: windowAt(s.gameMinutes) },
    avgMood: hs > 0 ? moods / hs : 0,
    forage: forageKg(s),
    brushwood: brushwood(s, heatDemand(s)),
    outlook: foodOutlook(s),
    eveningWares: eveningRate(s),
    ...(s.prod.trade ? { trade: s.prod.trade } : {}),
    fieldWork: fieldWork(s.weather),
    buildFactor: buildFactor(s.weather),
    firewood: heatDemand(s),
    unheated: { households: unheated, people: unheatedPeople },
    admin: adminOf(s),
  };
}

// Production details for the inspector; undefined for buildings that produce nothing (houses, shops).
export function productionInfo(s: SimState, b: Building): ProductionInfo | undefined {
  const good = GOOD[b.template];
  const room = storeRoom(b);
  const isStore = Object.keys(room).length > 0;
  if (!good && !isStore) return undefined;
  const info: ProductionInfo = { good: good ?? null, yesterday: s.prod.yesterday[b.id] ?? 0 };
  if (b.site) info.site = b.site;
  if (storageOf(b)) info.storage = storageOf(b);
  if (isStore && b.state === "active") info.store = { held: { ...(s.stores[b.id] ?? {}) }, room };
  if (good && b.state === "active" && b.template !== "gumno") {
    const ledger = new Ledger(s);
    const to = ledger.near(good, lotFront(b), "room")[0];
    if (to) info.haul = { metres: to.metres, share: s.prod.haul?.[b.id] ?? 0 };
    else if (good !== "food") info.full = true;
  }
  if (b.template === "orchard") info.orchard = { ripeDays: b.ripe === undefined ? ORCHARD_YEARS * YEAR_DAYS : Math.max(0, Math.ceil((b.ripe - s.gameMinutes) / DAY_MIN)), quality: orchardQuality(s.prod.orchard) };
  if (b.template === "sawpit" && s.stock.logs <= EPS) info.missing = L("брёвна", "logs");
  if (b.template === "smithy" && s.stock.logs <= EPS) info.missing = L("брёвна (на уголь)", "logs (for charcoal)");
  if (b.template === "carpentry" && s.stock.planks <= EPS) info.missing = L("доски", "planks");
  if (b.template === "gumno") {
    const year = calendar(s.gameMinutes).year;
    const assign = assignFields(s.zones.fields, s.buildings);
    const mine: Field[] = s.zones.fields.filter((f) => assign.get(f.id) === b.id);
    let sownH = 0;
    let need = 0;
    let reaped = 0;
    let expected = 0;
    for (const f of mine) {
      const w = workOf(s.prod.fields, f.id, year);
      sownH += Math.min(w.sowH, FIELD.sowHoursHa * haOf(f));
      need += FIELD.sowHoursHa * haOf(f);
      reaped += w.reaped;
      expected += expectedKg(f, w, cropOf(s));
    }
    info.fields = { count: mine.length, ha: assignedHa(b.id, s.zones.fields, assign), sown: need > 0 ? sownH / need : 0, reaped, expected };
  }
  return info;
}
