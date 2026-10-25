import { allocateLabor, BARN_CAP, BUILDINGS, FOUNDING_STOCK, foodCapacity, UPGRADE, type Materials } from "./buildings";
import { assignedHa, assignFields, expectedKg, FIELD, FISH, haOf, remainingHours, windowAt, workOf } from "./fields";
import { DIG, growDig, onOldFoundation, radiusOf } from "./excavation";
import { ageOf, foodOutlook, foodPerDay, forageKg, idleResidents, MAX_EVENTS, productionScale } from "./people";
import { massText } from "./units";
import { covers, SERVICE, serviceMood } from "./services";
import { calendar, dayOf } from "./time";
import type { Building, EconomyStats, EventKind, Field, Household, ProdFlags, ProdState, ProductionInfo, Resident, SimState, Stock, TownEvent } from "./types";

// Building materials come PACE times faster than in history; food and wares do not.
export const PACE = 4;

// Rates are per worker-hour during work hours.
export const RATE = {
  logs: 0.25, // m3, times PACE and the forest share
  planks: 0.02, // m3, times PACE
  logsPerPlank: 1.6, // m3 of logs per m3 of planks
  stone: 0.15, // t, times PACE and (0.4 + 0.6 rock)
  rockBase: 0.4,
  fish: FISH.kgHour, // kg of food
  winterFish: FISH.winter,
  pottery: 0.025, // pieces
  smithy: 0.015,
  smithyLogs: 0.05, // m3 per piece (charcoal)
  carpentry: 0.015,
  carpentryPlanks: 0.03, // m3 per piece
  waresPerPerson: 0.05, // pieces a day
  householdsPerTrader: 12,
  moodStep: 0.25,
};
// Hours of hand work per unit when the stock lacks the materials of a building (already divided by PACE).
export const HAND_HOURS = { logs: 4, planks: 12, stone: 2 };

const EPS = 1e-9;

export const emptyStock = (): Stock => ({ ...FOUNDING_STOCK });
export const emptyFlags = (year = 1): ProdFlags => ({ year, sowing: false, harvest: false, done: false, closed: false, hungry: false, rot: 0 });
export const emptyProd = (): ProdState => ({ fields: {}, flags: emptyFlags(), today: {}, yesterday: {} });

function say(events: TownEvent[], at: number, kind: EventKind, text: string): TownEvent[] {
  return [...events, { at, kind, text }].slice(-MAX_EVENTS);
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
): { buildings: Record<number, Building>; stock: Stock } {
  let out = buildings;
  let st = stock;
  for (const id of allocateLabor(buildings, personHours, crewHours).keys()) {
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
// `scale` is the share of work left after workers were drafted into the artel (see people.ts).
export function produceStep(s: SimState, dt: number, scale: number = productionScale(s)): SimState {
  const cal = calendar(s.gameMinutes);
  const workers = workersByJob(s.residents);
  const win = windowAt(s.gameMinutes);
  const stock = { ...s.stock };
  const today = { ...s.prod.today };
  let flags = flagsFor(s.prod.flags, cal.year);
  let fields = s.prod.fields;
  let events = s.events;
  let buildings = s.buildings;
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
    const h = eff * dt * scale;
    switch (b.template) {
      case "woodcutter": {
        const q = h * RATE.logs * PACE * (b.site?.forest ?? 0);
        stock.logs += q;
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
        const q = h * RATE.stone * PACE * (RATE.rockBase + (1 - RATE.rockBase) * (b.site?.rock ?? 0));
        stock.stone += q;
        made(b.id, q);
        break;
      }
      case "fisher": {
        const q = h * RATE.fish * (cal.season === 3 ? RATE.winterFish : 1);
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
          return remainingHours(f, workOf(fields, f.id, cal.year), win);
        });
        const total = rem.reduce((m, r) => m + r, 0);
        if (total <= EPS) break;
        const use = Math.min(h, total);
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
            events = say(events, s.gameMinutes, "farm", "Начался сев");
          }
        } else {
          harvested = true;
          const kg = use * FIELD.reapKgHour;
          addFood(kg);
          made(b.id, kg);
          if (!flags.harvest) {
            flags = { ...flags, harvest: true };
            events = say(events, s.gameMinutes, "farm", "Началась жатва");
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
      left += expectedKg(f, w) - w.reaped;
      got += w.reaped;
    }
    if (work.length > 0 && left <= 1e-6) {
      flags = { ...flags, done: true };
      events = say(events, s.gameMinutes, "farm", `Урожай собран: ${massText(got)}`);
    }
  }
  return { ...s, stock, events, buildings, prod: { ...s.prod, fields, today, flags } };
}

// ---------- daily ----------

// 00:00: yesterday's output is filed, people eat, wares are handed out, moods move, the harvest window
// is settled, food above the barns' capacity rots. Runs before the people's daily step.
export function dailyEconomy(s: SimState): SimState {
  const now = s.gameMinutes;
  const cal = calendar(now);
  let flags = flagsFor(s.prod.flags, cal.year);
  let events = s.events;
  const stock = { ...s.stock };

  // the idle adults gather food for the town (as far as the barns hold it)
  stock.food += Math.max(0, Math.min(forageKg(s), foodCapacity(s.buildings) - stock.food));

  // food
  const need = foodPerDay(s.residents, now);
  const eaten = Math.min(stock.food, need);
  stock.food -= eaten;
  const fed = need > 0 ? eaten / need : 1;
  if (fed < 1 - EPS && !flags.hungry) {
    flags = { ...flags, hungry: true };
    events = say(events, now, "food", "Провизия закончилась, люди голодают");
  } else if (fed >= 1 - EPS && flags.hungry) flags = { ...flags, hungry: false };
  const cap = foodCapacity(s.buildings);
  if (stock.food > cap) {
    flags = { ...flags, rot: flags.rot + stock.food - cap };
    stock.food = cap;
  }
  if (flags.rot >= 1) {
    events = say(events, now, "food", `Пропало ${Math.round(flags.rot)} кг провизии: не хватает амбаров`);
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

  // mood
  const households: Record<number, Household> = {};
  const idle = idleResidents(s);
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
    const bonus = h.home !== null ? serviceMood(s.coverage[h.home], kids) : 0;
    const target = Math.min(100, Math.max(0, 10 + 45 * fed + 10 * (served.get(h.id) ?? 0) + 10 * (h.home !== null ? 1 : 0) + bonus - jobless));
    households[h.id] = { ...h, mood: h.mood + (target - h.mood) * RATE.moodStep };
  }

  // the harvest window is over: whatever stands unreaped is lost
  let fields = s.prod.fields;
  const over = cal.season === 3 || (cal.season === 2 && cal.dayOfSeason > FIELD.harvestDays);
  if (over && !flags.closed) {
    const assign = assignFields(s.zones.fields, s.buildings);
    let lost = 0;
    for (const f of s.zones.fields) {
      if (!assign.has(f.id)) continue;
      const w = workOf(fields, f.id, cal.year);
      lost += Math.max(0, expectedKg(f, w) - w.reaped);
    }
    flags = { ...flags, closed: true };
    if (lost >= 1) events = say(events, now, "farm", `Зерно осталось в поле и пропало: ${massText(lost)}`);
  }
  // progress of fields that are gone or of earlier years is dropped
  const live = new Set(s.zones.fields.map((f) => f.id));
  for (const [key, w] of Object.entries(fields)) {
    if (live.has(Number(key)) && w.year === cal.year) continue;
    if (fields === s.prod.fields) fields = { ...fields };
    delete fields[Number(key)];
  }

  return { ...s, stock, events, households, prod: { fields, flags, today: {}, yesterday: s.prod.today } };
}

// ---------- aggregates and inspector ----------

export const GOOD: Record<string, keyof Stock> = {
  woodcutter: "logs",
  sawpit: "planks",
  quarry: "stone",
  fisher: "food",
  gumno: "food",
  pottery: "wares",
  smithy: "wares",
  carpentry: "wares",
};

export function economyStats(s: SimState): EconomyStats {
  const need = foodPerDay(s.residents, s.gameMinutes);
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
    expected += expectedKg(f, w);
  }
  let moods = 0;
  let hs = 0;
  for (const h of Object.values(s.households)) {
    moods += h.mood;
    hs++;
  }
  return {
    foodCap: foodCapacity(s.buildings),
    foodPerDay: need,
    foodDays: need > 0 ? Math.min(999, s.stock.food / need) : 999,
    yesterday,
    fields: { count: s.zones.fields.length, ha, assignedHa: aHa, sown: sowNeed > 0 ? sownH / sowNeed : 0, reaped, expected, window: windowAt(s.gameMinutes) },
    avgMood: hs > 0 ? moods / hs : 0,
    forage: forageKg(s),
    outlook: foodOutlook(s),
  };
}

// Production details for the inspector; undefined for buildings that produce nothing (houses, shops).
export function productionInfo(s: SimState, b: Building): ProductionInfo | undefined {
  const good = GOOD[b.template];
  if (!good && b.template !== "barn") return undefined;
  const info: ProductionInfo = { good: good ?? null, yesterday: s.prod.yesterday[b.id] ?? 0 };
  if (b.site) info.site = b.site;
  if (b.template === "barn") info.storage = BARN_CAP;
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
      expected += expectedKg(f, w);
    }
    info.fields = { count: mine.length, ha: assignedHa(b.id, s.zones.fields, assign), sown: need > 0 ? sownH / need : 0, reaped, expected };
  }
  return info;
}
