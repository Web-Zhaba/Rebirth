import { leverMood } from "./levers";
import { allocateLabor, BUILDINGS, CELLAR_CAP, FOUNDING_STOCK, foodCapacity, storageOf, UPGRADE, type Materials, type SiteLever } from "./buildings";
import { assignedHa, assignFields, bears, expectedKg, FIELD, foodKgHour, haOf, HARVEST_END_DAY, ORCHARD_YEARS, remainingHours, sowCredit, windowAt, workOf } from "./fields";
import { DIG, growDig, onOldFoundation, radiusOf } from "./excavation";
import { ageOf, foodOutlook, foodPerDay, forageKg, idleResidents, MAX_EVENTS, productionScales } from "./people";
import { buildingPriority } from "./jobs";
import { massText } from "./units";
import { EVENING, eveningRate, gatherHouses } from "./evening";
import { covers, SERVICE, serviceMood } from "./services";
import { calendar, DAY_MIN, dayOf, YEAR_DAYS, YEAR_MIN } from "./time";
import { applyFrost } from "./weather";
import { buildFactor, EFFECTS, emptyOrchard, fieldWork, firewoodDaily, frostNight, moodShift, orchardDay, orchardQuality, spoilage, workFactor } from "./weatherEffects";
import type { Building, Clearing, EconomyStats, EventKind, Field, Household, ProdFlags, ProdState, ProductionInfo, Resident, SimState, Stock, TownEvent } from "./types";

// Building materials come PACE times faster than in history; food and wares do not.
export const PACE = 4;

// Rates are per worker-hour during work hours.
export const RATE = {
  logs: 0.4, // m3, times PACE and the forest share
  planks: 0.02, // m3, times PACE
  logsPerPlank: 1.6, // m3 of logs per m3 of planks
  stone: 0.15, // t, times PACE; a quarry works on any land (rock nearby changes nothing)
  pottery: 0.025, // pieces
  smithy: 0.015,
  smithyLogs: 0.05, // m3 per piece (charcoal)
  carpentry: 0.015,
  carpentryPlanks: 0.03, // m3 per piece
  waresPerPerson: 0.05, // pieces a day
  householdsPerTrader: 12,
  moodStep: 0.25,
};
// A harvest window that closes with at most this share of the reaped grain still standing counts as a finished harvest.
export const HARVEST_OK = 0.25;
// Hours of hand work per unit when the stock lacks the materials of a building (already divided by PACE).
export const HAND_HOURS = { logs: 4, planks: 12, stone: 2 };

const EPS = 1e-9;

export const emptyStock = (): Stock => ({ ...FOUNDING_STOCK });
export const emptyFlags = (year = 1): ProdFlags => ({ year, sowing: false, harvest: false, done: false, closed: false, hungry: false, rot: 0 });
export const emptyProd = (): ProdState => ({ fields: {}, flags: emptyFlags(), today: {}, yesterday: {}, orchard: emptyOrchard() });

export function say(events: TownEvent[], at: number, kind: EventKind, text: string, pos?: [number, number]): TownEvent[] {
  return [...events, pos ? { at, kind, text, pos } : { at, kind, text }].slice(-MAX_EVENTS);
}

const SHORT_OF = { logs: "брёвен", planks: "досок", stone: "камня" } as const;

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
    const m = up ? UPGRADE.materials : BUILDINGS[b.template]?.materials;
    if (!m) continue;
    const hand = up ? up.labor > (wasUp?.labor ?? 0) : (b.hand ?? 0) > 0;
    for (const g of ["logs", "planks", "stone"] as const) {
      const need = !up && b.onRuins && g === "stone" ? 0 : m[g];
      if (hand && need > st[g]) {
        const text = `Не хватает ${SHORT_OF[g]}: часть работы делают вручную`;
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
  lit: Map<number, number>; // of them literate
}
const workerCache = new WeakMap<object, Workers>();

// Jobs change only at the daily step, so this holds for a whole day.
function workersByJob(residents: Record<number, Resident>): Workers {
  const hit = workerCache.get(residents);
  if (hit) return hit;
  const w: Workers = { n: new Map(), lit: new Map() };
  for (const r of Object.values(residents)) {
    if (r.job === null) continue;
    w.n.set(r.job, (w.n.get(r.job) ?? 0) + 1);
    if (r.literate) w.lit.set(r.job, (w.lit.get(r.job) ?? 0) + 1);
  }
  workerCache.set(residents, w);
  return w;
}

// ---------- construction materials ----------

// Person-hours of hand work that the stock's shortfall of `m` adds to a building (stone is free on old foundations).
export function handHours(m: Materials, st: Stock, ruins = false): number {
  let hours = 0;
  for (const g of ["logs", "planks", "stone"] as const) hours += Math.max(0, (ruins && g === "stone" ? 0 : m[g]) - st[g]) * HAND_HOURS[g];
  return hours;
}

// Takes the materials of the sites that receive their first person-hour in this spending (the same sites
// advanceBuildings serves, see allocateLabor). What the stock lacks is made by hand and added to the labor.
export function payMaterials(
  buildings: Record<number, Building>,
  stock: Stock,
  personHours: number,
  foundations: readonly { ring: [number, number][] }[] = [],
  crewHours = Infinity, // no crew limit: sites are served one after another
  clearings: readonly Clearing[] = [],
  first = false, // the clearings take their crews before the buildings (see clearingsFirst)
  lever?: SiteLever,
): { buildings: Record<number, Building>; stock: Stock } {
  let out = buildings;
  let st = stock;
  for (const id of allocateLabor(buildings, personHours, crewHours, clearings, first, lever).keys()) {
    let b = buildings[id];
    // A finished house being upgraded is served like a building under construction.
    const up = b.state === "active" ? b.upgrade : undefined;
    if (up ? up.paid : b.paid) continue;
    const m = up ? UPGRADE.materials : BUILDINGS[b.template]?.materials;
    // A new building whose footprint overlaps an old foundation needs no stone and 25 % less labor.
    const ruins = !up && onOldFoundation(b.footprint, foundations);
    let hand = 0;
    const next = { ...st };
    if (m) {
      hand = handHours(m, st, ruins);
      for (const g of ["logs", "planks", "stone"] as const) next[g] -= Math.min(next[g], ruins && g === "stone" ? 0 : m[g]);
    }
    st = next;
    const cut = ruins ? 1 - DIG.laborCut : 1;
    const labor = ((up ? up.labor : b.labor) + hand) * cut;
    hand *= cut;
    b = up ? { ...b, upgrade: { ...up, paid: true, labor } } : { ...b, paid: true, labor, ...(hand > 0 ? { hand } : {}), ...(ruins ? { onRuins: true } : {}) };
    if (out === buildings) out = { ...buildings };
    out[id] = b;
  }
  return { buildings: out, stock: st };
}

// ---------- production (every work-hour tick) ----------

// One tick of `dt` hours of work: producers, workshops and field work. Call during work hours only.
// `scale` is the share of work left after workers were drafted into the artel (see people.ts): one for all, or by priority.
export function produceStep(s: SimState, dt: number, scale: number | readonly number[] = productionScales(s)): SimState {
  const cal = calendar(s.gameMinutes);
  const workers = workersByJob(s.residents);
  const win = windowAt(s.gameMinutes);
  const stock = { ...s.stock };
  const today = { ...s.prod.today };
  let flags = flagsFor(s.prod.flags, cal.year);
  let fields = s.prod.fields;
  let events = s.events;
  let buildings = s.buildings;
  let logsCut = 0;
  const cap = foodCapacity(s.buildings);
  const addFood = (kg: number) => {
    const take = Math.max(0, Math.min(kg, cap - stock.food));
    stock.food += take;
    flags = { ...flags, rot: flags.rot + (kg - take) };
  };
  const made = (id: number, n: number) => {
    if (n > 0) today[id] = (today[id] ?? 0) + n;
  };
  let assign: Map<number, number> | null = null;
  let harvested = false;

  for (const b of Object.values(s.buildings)) {
    if (b.state !== "active") continue;
    const n = workers.n.get(b.id) ?? 0;
    if (n === 0) continue;
    // Literate hands make a workshop more productive.
    const eff = b.zone === "craft" ? n + SERVICE.literateBoost * (workers.lit.get(b.id) ?? 0) : n;
    const wf = workFactor(b.template, s.weather); // rain, frost, storms
    if (wf <= 0) continue;
    const h = eff * dt * wf * (typeof scale === "number" ? scale : scale[buildingPriority(b, s.levers)]);
    switch (b.template) {
      case "woodcutter": {
        const q = h * RATE.logs * PACE * (b.site?.forest ?? 0);
        stock.logs += q;
        logsCut += q;
        made(b.id, q);
        break;
      }
      case "sawpit": {
        const q = Math.min(h * RATE.planks * PACE, stock.logs / RATE.logsPerPlank);
        stock.logs = Math.max(0, stock.logs - q * RATE.logsPerPlank);
        stock.planks += q;
        made(b.id, q);
        break;
      }
      case "quarry": {
        const q = h * RATE.stone * PACE;
        stock.stone += q;
        made(b.id, q);
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
        const q = h * foodKgHour(b.template, cal.season) * bear;
        addFood(q);
        made(b.id, q);
        break;
      }
      case "pottery": {
        const q = h * RATE.pottery;
        stock.wares += q;
        made(b.id, q);
        break;
      }
      case "smithy": {
        const q = Math.min(h * RATE.smithy, stock.logs / RATE.smithyLogs);
        stock.logs = Math.max(0, stock.logs - q * RATE.smithyLogs);
        stock.wares += q;
        made(b.id, q);
        break;
      }
      case "carpentry": {
        const q = Math.min(h * RATE.carpentry, stock.planks / RATE.carpentryPlanks);
        stock.planks = Math.max(0, stock.planks - q * RATE.carpentryPlanks);
        stock.wares += q;
        made(b.id, q);
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
          return remainingHours(f, workOf(fields, f.id, cal.year), win, s.weather.crop);
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
            events = say(events, s.gameMinutes, "farm", "Начался сев", [b.lot.cx, b.lot.cy]);
          }
        } else {
          harvested = true;
          const kg = use * FIELD.reapKgHour;
          addFood(kg);
          made(b.id, kg);
          if (!flags.harvest) {
            flags = { ...flags, harvest: true };
            events = say(events, s.gameMinutes, "farm", "Началась уборка урожая", [b.lot.cx, b.lot.cy]);
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
      left += expectedKg(f, w, s.weather.crop) - w.reaped;
      got += w.reaped;
    }
    if (work.length > 0 && left <= 1e-6) {
      flags = { ...flags, done: true };
      events = say(events, s.gameMinutes, "farm", `Урожай собран: ${massText(got)}`);
    }
  }
  return { ...s, stock, events, buildings, goals: { ...s.goals, logsMade: s.goals.logsMade + logsCut }, prod: { ...s.prod, fields, today, flags } };
}

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
  const loss = standing(w.crop) - standing(next.crop);
  const text = `Заморозок: ночью ${Math.round(w.yesterday.min)} °C, урожай потерял ${Math.round((1 - next.frost / w.frost) * 100)} %${loss >= 1 ? ` (около ${massText(loss)} зерна)` : ""}`;
  return { weather: next, events: say(events, s.gameMinutes, "farm", text) };
}

// 00:00: yesterday's output is filed, people eat, wares are handed out, moods move, the harvest window
// is settled, food above the barns' capacity rots. Runs before the people's daily step.
export function dailyEconomy(s: SimState): SimState {
  const now = s.gameMinutes;
  const cal = calendar(now);
  let flags = flagsFor(s.prod.flags, cal.year);
  let events = s.events;
  const stock = { ...s.stock };
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
  stock.food += Math.max(0, Math.min(forageKg(s), foodCapacity(s.buildings) - stock.food));

  // food
  const need = foodPerDay(s.residents, now, s.levers, s.weather);
  const eaten = Math.min(stock.food, need);
  stock.food -= eaten;
  const fed = need > 0 ? eaten / need : 1;
  if (fed < 1 - EPS && !flags.hungry) {
    flags = { ...flags, hungry: true };
    events = say(events, now, "food", "Еда закончилась, люди голодают");
  } else if (fed >= 1 - EPS && flags.hungry) flags = { ...flags, hungry: false };
  const cap = foodCapacity(s.buildings);
  // heat and damp spoil the stock; what lies in cellars and barns suffers less (cellars hold the best)
  let barns = 0;
  let cellars = 0;
  for (const b of Object.values(s.buildings)) if (b.state === "active") b.template === "cellar" ? (cellars += CELLAR_CAP) : (barns += storageOf(b.template));
  const inCellar = stock.food > 0 ? Math.min(1, cellars / stock.food) : 0;
  const inBarn = stock.food > 0 ? Math.min(1 - inCellar, barns / stock.food) : 0;
  const spoiled = stock.food * spoilage(s.weather, inBarn, inCellar);
  stock.food -= spoiled;
  flags = { ...flags, rot: flags.rot + spoiled };
  if (stock.food > cap) {
    flags = { ...flags, rot: flags.rot + stock.food - cap };
    stock.food = cap;
  }
  if (flags.rot >= (s.weather.site ? EFFECTS.rotReport : 1)) {
    events = say(events, now, "food", `Пропало ${Math.round(flags.rot)} кг еды: ${s.weather.site ? "жара, сырость, не хватает складов" : "не хватает складов"}`);
    flags = { ...flags, rot: 0 };
  }

  // wares: each employed trade worker serves 12 households a day (a literate one 20 % more), starting
  // from a different one each day; each market worker then hands out to 20 households the market covers
  let shopSlots = 0;
  let marketSlots = 0;
  for (const r of Object.values(s.residents)) {
    if (r.job === null) continue;
    const b = s.buildings[r.job];
    if (!b || b.state !== "active") continue;
    if (b.zone === "trade") shopSlots += RATE.householdsPerTrader * (1 + (r.literate ? SERVICE.literateBoost : 0));
    else if (b.template === "market") marketSlots += SERVICE.marketHouseholds;
  }
  const ids = Object.keys(s.households).map(Number).sort((p, q) => p - q);
  const served = new Map<number, number>(); // household -> share of its need supplied
  const hand = (h: Household) => {
    const want = RATE.waresPerPerson * h.members.length;
    const give = Math.min(want, stock.wares);
    stock.wares -= give;
    served.set(h.id, want > 0 ? give / want : 1);
  };
  let slots = Math.floor(shopSlots + EPS);
  for (let k = 0; k < ids.length && slots > 0 && stock.wares > EPS; k++) {
    hand(s.households[ids[(k + dayOf(now)) % ids.length]]);
    slots--;
  }
  slots = marketSlots;
  for (let k = 0; k < ids.length && slots > 0 && stock.wares > EPS; k++) {
    const h = s.households[ids[(k + dayOf(now)) % ids.length]];
    if (served.has(h.id) || h.home === null || !covers(s.coverage[h.home], "market")) continue;
    hand(h);
    slots--;
  }

  // firewood: every household burns by the cold of the day that ended; those the logs do not reach stay cold
  const cold = new Set<number>();
  const wood = firewoodDaily(s.weather);
  stock.logs += brushwood(s, wood * ids.length); // the idle gather brushwood when the logs will not last the day
  if (wood > 0) {
    for (const id of ids) {
      if (stock.logs >= wood - EPS) stock.logs = Math.max(0, stock.logs - wood);
      else {
        stock.logs = 0;
        cold.add(id);
      }
    }
    if (cold.size > 0 && !Object.values(s.households).some((h) => h.cold)) events = say(events, now, "shortage", "Дров нет, люди мёрзнут");
  }

  // mood
  const households: Record<number, Household> = {};
  const weatherMood = moodShift(s.weather);
  const idle = idleResidents(s);
  const gather = gatherHouses(s); // evening gatherings: a tavern in reach or a chapel
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
    const bonus = h.home !== null ? serviceMood(s.coverage[h.home], kids) + (gather.has(h.home) ? EVENING.gatherMood : 0) : 0;
    const target = Math.min(100, Math.max(0, 10 + 45 * fed + 10 * (served.get(h.id) ?? 0) + 10 * (h.home !== null ? 1 : 0) + bonus - jobless + leverMood(s.levers) + weatherMood + (cold.has(h.id) ? EFFECTS.unheatedMood : 0)));
    const next: Household = { ...h, mood: h.mood + (target - h.mood) * RATE.moodStep };
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
      lost += Math.max(0, expectedKg(f, w, s.weather.crop) - w.reaped);
      got += w.reaped;
    }
    flags = { ...flags, closed: true };
    // Most of the grain in the barn counts as a harvest (the goal and the chronicle must not wait a year for the last sheaves).
    if (flags.harvest && !flags.done && got > 0 && lost <= HARVEST_OK * got) {
      flags = { ...flags, done: true };
      events = say(events, now, "farm", `Урожай собран: ${massText(got)}`);
    }
    if (lost >= 1) events = say(events, now, "farm", `Зерно осталось в поле и пропало: ${massText(lost)}`);
  }
  // progress of fields that are gone or of earlier years is dropped
  const live = new Set(s.zones.fields.map((f) => f.id));
  for (const [key, w] of Object.entries(fields)) {
    if (live.has(Number(key)) && w.year === cal.year) continue;
    if (fields === s.prod.fields) fields = { ...fields };
    delete fields[Number(key)];
  }

  return { ...s, stock, events, buildings, households, weather: frost.weather, prod: { fields, flags, today: {}, yesterday: s.prod.today, orchard } };
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
  pottery: "wares",
  smithy: "wares",
  carpentry: "wares",
};

export function economyStats(s: SimState): EconomyStats {
  const need = foodPerDay(s.residents, s.gameMinutes, s.levers, s.weather);
  const yesterday: Stock = { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 };
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
    expected += expectedKg(f, w, s.weather.crop);
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
    brushwood: brushwood(s, firewoodDaily(s.weather) * hs),
    outlook: foodOutlook(s),
    eveningWares: eveningRate(s),
    fieldWork: fieldWork(s.weather),
    buildFactor: buildFactor(s.weather),
    firewood: firewoodDaily(s.weather) * hs,
    unheated: { households: unheated, people: unheatedPeople },
  };
}

// Production details for the inspector; undefined for buildings that produce nothing (houses, shops).
export function productionInfo(s: SimState, b: Building): ProductionInfo | undefined {
  const good = GOOD[b.template];
  if (!good && !storageOf(b.template)) return undefined;
  const info: ProductionInfo = { good: good ?? null, yesterday: s.prod.yesterday[b.id] ?? 0 };
  if (b.site) info.site = b.site;
  if (storageOf(b.template)) info.storage = storageOf(b.template);
  if (b.template === "orchard") info.orchard = { ripeDays: b.ripe === undefined ? ORCHARD_YEARS * YEAR_DAYS : Math.max(0, Math.ceil((b.ripe - s.gameMinutes) / DAY_MIN)), quality: orchardQuality(s.prod.orchard) };
  if (b.template === "sawpit" && s.stock.logs <= EPS) info.missing = "брёвна";
  if (b.template === "smithy" && s.stock.logs <= EPS) info.missing = "брёвна (на уголь)";
  if (b.template === "carpentry" && s.stock.planks <= EPS) info.missing = "доски";
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
      expected += expectedKg(f, w, s.weather.crop);
    }
    info.fields = { count: mine.length, ha: assignedHa(b.id, s.zones.fields, assign), sown: need > 0 ? sownH / need : 0, reaped, expected };
  }
  return info;
}
