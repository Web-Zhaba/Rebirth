import { homeGoods, takeGoods } from "./goods";
import { BUILDINGS, isJobKey, isPriority, remainingClearing, remainingLabor, type JobKey, type Priority } from "./buildings";
import { jobsOf } from "./fields";
import { withChronicle } from "./chronicle";
import { CALL, RATIONS, SUPPLIES, TOLOKA_COOLDOWN, tolokaActive, workEndAt, workHours, isWorkHour, type Levers, type Rations } from "./levers";
import { countResidents, foodPerDay, freeHomes, isWorkplace, rebalanceJobs } from "./people";
import { Ledger } from "./storage";
import { massText } from "./units";
import { say } from "./production";
import { classPupils } from "./school";
import { nextRandom } from "./rng";
import { isTradeOrder, TRADE_NAME, type TradeOrder } from "./trade";
import { calendar } from "./time";
import type { SimState } from "./types";
import { L } from "../i18n";

// Player levers as pure state changes (PLAN-pace.md section 8); the handler turns them into commands.

export type LeverResult = { ok: true; sim: SimState } | { ok: false; reason: string };

const fail = (reason: string): LeverResult => ({ ok: false, reason });
const done = (sim: SimState, text: string): LeverResult => ({ ok: true, sim: withChronicle({ ...sim, events: say(sim.events, sim.gameMinutes, "order", text) }, "order", text) });
const set = (s: SimState, patch: Partial<Levers>): SimState => ({ ...s, levers: { ...s.levers, ...patch } });

// Name and open work of a site key (building id, or -id of a clearing); null when there is nothing to work on.
export function siteInfo(s: Pick<SimState, "buildings" | "clearings">, key: number): { name: string; remaining: number } | null {
  if (key > 0) {
    const b = s.buildings[key];
    if (!b) return null;
    const remaining = remainingLabor(b);
    return remaining > 1e-9 ? { name: (BUILDINGS[b.template]?.name ?? b.template).toLowerCase(), remaining } : null;
  }
  const c = s.clearings.find((x) => x.id === -key);
  if (!c) return null;
  const remaining = remainingClearing(c);
  return remaining > 1e-9 ? { name: L("вырубка", "the clearing"), remaining } : null;
}

export function setPriority(s: SimState, key: number | null): LeverResult {
  if (key === null) return s.levers.priority === null ? { ok: true, sim: s } : done(set(s, { priority: null }), L("Очерёдность работ снята", "Work order cleared"));
  if (!Number.isInteger(key) || key === 0) return fail(L("Некорректная стройка", "Invalid site"));
  const site = siteInfo(s, key);
  if (!site) return fail(L("Здесь нечего строить", "Nothing to build here"));
  if (s.levers.priority === key) return { ok: true, sim: s };
  return done(set(s, { priority: key }), L(`Строители берутся за ${site.name} в первую очередь`, `Builders take on ${site.name} first`));
}

// Minutes until a толока can be called again; 0 when it can.
export const tolokaWait = (s: Pick<SimState, "levers" | "gameMinutes">): number => Math.max(0, s.levers.tolokaReady - s.gameMinutes);

export function callToloka(s: SimState, key: number): LeverResult {
  if (!Number.isInteger(key) || key === 0) return fail(L("Некорректная стройка", "Invalid site"));
  const site = siteInfo(s, key);
  if (!site) return fail(L("Здесь нечего строить", "Nothing to build here"));
  if (tolokaActive(s.levers, s.gameMinutes)) return fail(L("Общий сбор уже идёт", "All hands is already under way"));
  if (tolokaWait(s) > 0) return fail(L("Общий сбор недавно объявляли: люди ещё отдыхают", "All hands was called recently: people are still resting"));
  if (!isWorkHour(calendar(s.gameMinutes).hour, s.levers)) return fail(L("Общий сбор объявляют в рабочие часы", "All hands can only be called during work hours"));
  if (countResidents(s.residents, s.gameMinutes).adults === 0) return fail(L("Некого звать", "No one to call"));
  return done(set(s, { toloka: { site: key, until: workEndAt(s.gameMinutes, s.levers) }, tolokaReady: s.gameMinutes + TOLOKA_COOLDOWN }), L(`Общий сбор: все взрослые идут на ${site.name}, остальные дела стоят до вечера`, `All hands: every adult goes to ${site.name}, other work waits until evening`));
}

export function setSchedule(s: SimState, strada: boolean): LeverResult {
  if (typeof strada !== "boolean") return fail(L("Некорректный распорядок", "Invalid schedule"));
  if (s.levers.strada === strada) return { ok: true, sim: s };
  const next = set(s, { strada });
  const w = workHours(next);
  return done(next, strada ? L(`Долгий день: работают с ${w.start} до ${w.end} часов, люди устают`, `Long day: work from ${w.start}:00 to ${w.end}:00, people get tired`) : L(`Обычный распорядок: работа с ${w.start} до ${w.end} часов`, `Normal schedule: work from ${w.start}:00 to ${w.end}:00`));
}

// Grown-ups without reading go to school instead of work (see classPupils); the jobs are reassigned at once.
export function setAdultSchool(s: SimState, on: boolean): LeverResult {
  if (typeof on !== "boolean") return fail(L("Некорректный приказ", "Invalid order"));
  if (s.levers.adultSchool === on) return { ok: true, sim: s };
  const withLever = set(s, { adultSchool: on });
  const inClass = classPupils(withLever);
  const residents = { ...s.residents };
  for (const r of Object.values(residents)) if (!!r.inClass !== inClass.has(r.id)) residents[r.id] = { ...r, inClass: inClass.has(r.id) };
  const next = rebalanceJobs({ ...withLever, residents });
  return done(next, on ? L("Неграмотные взрослые идут в школу вместо работы", "Illiterate adults go to school instead of work") : L("Взрослые возвращаются к работе", "Adults return to work"));
}

export function setRations(s: SimState, rations: Rations): LeverResult {
  if (typeof rations !== "string" || !Object.hasOwn(RATIONS, rations)) return fail(L("Неизвестные нормы еды", "Unknown rations"));
  if (s.levers.rations === rations) return { ok: true, sim: s };
  return done(set(s, { rations }), `${L("Нормы еды", "Rations")}: ${RATIONS[rations].name.toLowerCase()}`);
}

// What the markets swap every day; null stops the trade.
export function setTrade(s: SimState, order: TradeOrder | null): LeverResult {
  if (order !== null && !isTradeOrder(order)) return fail(L("Некорректный обмен", "Invalid trade"));
  const was = s.levers.trade;
  if (was?.give === order?.give && was?.get === order?.get) return { ok: true, sim: s };
  return done(set(s, { trade: order ? { give: order.give, get: order.get } : null }), order ? L(`Рынок меняет ${TRADE_NAME[order.give]} на ${TRADE_NAME[order.get]}`, `The market trades ${TRADE_NAME[order.give]} for ${TRADE_NAME[order.get]}`) : L("Обмен на рынке остановлен", "Market trade stopped"));
}

// Hiring priority of a job group (or of construction); the people are reassigned at once.
export function setJobPriority(s: SimState, group: JobKey, priority: Priority): LeverResult {
  if (!isJobKey(group)) return fail(L("Неизвестная группа работ", "Unknown work group"));
  if (!isPriority(priority)) return fail(L("Некорректный приоритет", "Invalid priority"));
  if (s.levers.jobs[group] === priority) return { ok: true, sim: s };
  const next = set(s, { jobs: { ...s.levers.jobs, [group]: priority } });
  return { ok: true, sim: rebalanceJobs(next) };
}

// Staff limit of a finished workplace: 0..jobs; all of its jobs clears the limit. The people are reassigned at once.
export function setStaff(s: SimState, id: number, staff: number): LeverResult {
  const b = Number.isInteger(id) ? s.buildings[id] : undefined;
  if (!isWorkplace(b)) return fail(L("Здесь нет работы", "No work here"));
  if (!Number.isInteger(staff) || staff < 0) return fail(L("Некорректное число работников", "Invalid number of workers"));
  const jobs = jobsOf(b, s);
  if (staff > jobs) return fail(L("Мест меньше", "Fewer jobs than that"));
  if (staff === (b.staff ?? jobs)) return { ok: true, sim: s };
  const { staff: _old, ...rest } = b;
  const nb = staff >= jobs ? rest : { ...rest, staff };
  return { ok: true, sim: rebalanceJobs({ ...s, buildings: { ...s.buildings, [id]: nb } }) };
}

// Why a call for settlers cannot be made now, or null.
export function callBlock(s: Pick<SimState, "stock" | "buildings" | "households" | "incoming">): string | null {
  if (freeHomes(s.buildings, s.households, s.incoming).length === 0) return L("Нет свободного дома для новой семьи", "No free house for a new family");
  if (s.stock.food < CALL.food) return L(`Не хватает еды: нужно ${CALL.food} кг`, `Not enough food: ${CALL.food} kg needed`);
  if (homeGoods(s.stock) < CALL.goods) return L(`Не хватает одежды, посуды и утвари: нужно ${CALL.goods} шт`, `Not enough clothing, dishes and furnishings: ${CALL.goods} pcs needed`);
  return null;
}

export function callSettlers(s: SimState): LeverResult {
  const bad = callBlock(s);
  if (bad) return fail(bad);
  const house = freeHomes(s.buildings, s.households, s.incoming)[0];
  const [r, rng] = nextRandom(s.rng);
  const arrive = s.gameMinutes + CALL.minMinutes + r * (CALL.maxMinutes - CALL.minMinutes);
  const incoming = [...s.incoming, { house, arrive }].sort((a, b) => a.arrive - b.arrive);
  const next: SimState = { ...s, rng, incoming, stock: { ...takeGoods(s.stock, CALL.goods)!, food: s.stock.food - CALL.food } };
  return done(next, L(`Позвали поселенцев: ушло ${CALL.food} кг еды и ${CALL.goods} шт товаров, семья будет в течение суток`, `Settlers called: ${CALL.food} kg of food and ${CALL.goods} goods spent; a family will arrive within a day`));
}

// Supplies for a watched ad, laid into the stores nearest to the camp; what finds no room is kept at the camp all the
// same, so a reward is never lost to full stores.
export function grantSupplies(s: SimState): LeverResult {
  const food = Math.round(Math.max(SUPPLIES.minFood, SUPPLIES.foodDays * foodPerDay(s.residents, s.gameMinutes, s.levers)));
  const l = new Ledger(s);
  l.stock.food += food;
  l.stock.logs += SUPPLIES.logs;
  l.stock.planks += SUPPLIES.planks;
  l.stock.stone += SUPPLIES.stone;
  l.stock.tools += SUPPLIES.tools;
  l.sync(true);
  const what = L(
    `еда ${massText(food)}, брёвна ${SUPPLIES.logs} м³, доски ${SUPPLIES.planks} м³, камень ${SUPPLIES.stone} т, инструменты ${SUPPLIES.tools} шт.`,
    `food ${massText(food)}, logs ${SUPPLIES.logs} m³, planks ${SUPPLIES.planks} m³, stone ${SUPPLIES.stone} t, tools ${SUPPLIES.tools} pcs`,
  );
  return done({ ...s, stock: l.stock, stores: l.stores }, L(`Прибыли припасы: ${what}`, `Supplies arrived: ${what}`));
}

// End of each tick: a priority whose site is finished is dropped; a толока ends with the workday or with its site.
export function settleLevers(s: SimState): SimState {
  const l = s.levers;
  const priority = l.priority !== null && !siteInfo(s, l.priority) ? null : l.priority;
  const toloka = l.toloka && (s.gameMinutes >= l.toloka.until || !siteInfo(s, l.toloka.site)) ? null : l.toloka;
  if (priority === l.priority && toloka === l.toloka) return s;
  return { ...s, levers: { ...l, priority, toloka } };
}
