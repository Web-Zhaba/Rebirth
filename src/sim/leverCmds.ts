import { BUILDINGS, isJobKey, isPriority, remainingClearing, remainingLabor, type JobKey, type Priority } from "./buildings";
import { jobsOf } from "./fields";
import { withChronicle } from "./chronicle";
import { CALL, RATIONS, TOLOKA_COOLDOWN, tolokaActive, workEndAt, workHours, isWorkHour, type Levers, type Rations } from "./levers";
import { countResidents, isWorkplace, rebalanceJobs, vacantHouses } from "./people";
import { say } from "./production";
import { nextRandom } from "./rng";
import { calendar } from "./time";
import type { SimState } from "./types";

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
  return remaining > 1e-9 ? { name: "вырубка", remaining } : null;
}

export function setPriority(s: SimState, key: number | null): LeverResult {
  if (key === null) return s.levers.priority === null ? { ok: true, sim: s } : done(set(s, { priority: null }), "Очерёдность работ снята");
  if (!Number.isInteger(key) || key === 0) return fail("Некорректная стройка");
  const site = siteInfo(s, key);
  if (!site) return fail("Здесь нечего строить");
  if (s.levers.priority === key) return { ok: true, sim: s };
  return done(set(s, { priority: key }), `Строители берутся за ${site.name} в первую очередь`);
}

// Minutes until a толока can be called again; 0 when it can.
export const tolokaWait = (s: Pick<SimState, "levers" | "gameMinutes">): number => Math.max(0, s.levers.tolokaReady - s.gameMinutes);

export function callToloka(s: SimState, key: number): LeverResult {
  if (!Number.isInteger(key) || key === 0) return fail("Некорректная стройка");
  const site = siteInfo(s, key);
  if (!site) return fail("Здесь нечего строить");
  if (tolokaActive(s.levers, s.gameMinutes)) return fail("Общий сбор уже идёт");
  if (tolokaWait(s) > 0) return fail("Общий сбор недавно объявляли: люди ещё отдыхают");
  if (!isWorkHour(calendar(s.gameMinutes).hour, s.levers)) return fail("Общий сбор объявляют в рабочие часы");
  if (countResidents(s.residents, s.gameMinutes).adults === 0) return fail("Некого звать");
  return done(set(s, { toloka: { site: key, until: workEndAt(s.gameMinutes, s.levers) }, tolokaReady: s.gameMinutes + TOLOKA_COOLDOWN }), `Общий сбор: все взрослые идут на ${site.name}, остальные дела стоят до вечера`);
}

export function setSchedule(s: SimState, strada: boolean): LeverResult {
  if (typeof strada !== "boolean") return fail("Некорректный распорядок");
  if (s.levers.strada === strada) return { ok: true, sim: s };
  const next = set(s, { strada });
  const w = workHours(next);
  return done(next, strada ? `Долгий день: работают с ${w.start} до ${w.end} часов, люди устают` : `Обычный распорядок: работа с ${w.start} до ${w.end} часов`);
}

export function setRations(s: SimState, rations: Rations): LeverResult {
  if (typeof rations !== "string" || !Object.hasOwn(RATIONS, rations)) return fail("Неизвестные нормы еды");
  if (s.levers.rations === rations) return { ok: true, sim: s };
  return done(set(s, { rations }), `Нормы еды: ${RATIONS[rations].name.toLowerCase()}`);
}

// Hiring priority of a job group (or of construction); the people are reassigned at once.
export function setJobPriority(s: SimState, group: JobKey, priority: Priority): LeverResult {
  if (!isJobKey(group)) return fail("Неизвестная группа работ");
  if (!isPriority(priority)) return fail("Некорректный приоритет");
  if (s.levers.jobs[group] === priority) return { ok: true, sim: s };
  const next = set(s, { jobs: { ...s.levers.jobs, [group]: priority } });
  return { ok: true, sim: rebalanceJobs(next) };
}

// Staff limit of a finished workplace: 0..jobs; all of its jobs clears the limit. The people are reassigned at once.
export function setStaff(s: SimState, id: number, staff: number): LeverResult {
  const b = Number.isInteger(id) ? s.buildings[id] : undefined;
  if (!isWorkplace(b)) return fail("Здесь нет работы");
  if (!Number.isInteger(staff) || staff < 0) return fail("Некорректное число работников");
  const jobs = jobsOf(b, s);
  if (staff > jobs) return fail("Мест меньше");
  if (staff === (b.staff ?? jobs)) return { ok: true, sim: s };
  const { staff: _old, ...rest } = b;
  const nb = staff >= jobs ? rest : { ...rest, staff };
  return { ok: true, sim: rebalanceJobs({ ...s, buildings: { ...s.buildings, [id]: nb } }) };
}

// Why a call for settlers cannot be made now, or null.
export function callBlock(s: Pick<SimState, "stock" | "buildings" | "households" | "incoming">): string | null {
  const promised = new Set(s.incoming.map((f) => f.house));
  if (!vacantHouses(s.buildings, s.households).some((id) => !promised.has(id))) return "Нет свободного дома для новой семьи";
  if (s.stock.food < CALL.food) return `Не хватает еды: нужно ${CALL.food} кг`;
  if (s.stock.wares < CALL.wares) return `Не хватает товаров: нужно ${CALL.wares} шт`;
  return null;
}

export function callSettlers(s: SimState): LeverResult {
  const bad = callBlock(s);
  if (bad) return fail(bad);
  const promised = new Set(s.incoming.map((f) => f.house));
  const house = vacantHouses(s.buildings, s.households).find((id) => !promised.has(id))!;
  const [r, rng] = nextRandom(s.rng);
  const arrive = s.gameMinutes + CALL.minMinutes + r * (CALL.maxMinutes - CALL.minMinutes);
  const incoming = [...s.incoming, { house, arrive }].sort((a, b) => a.arrive - b.arrive);
  const next: SimState = { ...s, rng, incoming, stock: { ...s.stock, food: s.stock.food - CALL.food, wares: s.stock.wares - CALL.wares } };
  return done(next, `Позвали поселенцев: ушло ${CALL.food} кг еды и ${CALL.wares} шт товаров, семья будет в течение суток`);
}

// End of each tick: a priority whose site is finished is dropped; a толока ends with the workday or with its site.
export function settleLevers(s: SimState): SimState {
  const l = s.levers;
  const priority = l.priority !== null && !siteInfo(s, l.priority) ? null : l.priority;
  const toloka = l.toloka && (s.gameMinutes >= l.toloka.until || !siteInfo(s, l.toloka.site)) ? null : l.toloka;
  if (priority === l.priority && toloka === l.toloka) return s;
  return { ...s, levers: { ...l, priority, toloka } };
}
