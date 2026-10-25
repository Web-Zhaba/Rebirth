import { addChronicle } from "./chronicle";
import { DIG, growDig, isDig, radiusOf } from "./excavation";
import { assignFields, expectedKg, FIELD, haOf, windowAt, workOf } from "./fields";
import { CALL } from "./levers";
import { killResident, vacantHouses } from "./people";
import { say } from "./production";
import { nextRandom } from "./rng";
import { covers } from "./services";
import { calendar, DAY_MIN } from "./time";
import { massText } from "./units";
import type { ChoiceOption, SimState, TownChoice } from "./types";

// Events with choices (PLAN-pace.md section 10). One event every one to two game days, drawn by the sim generator from
// the kinds whose condition holds; two options, each with its effect in the text. An event nobody answers resolves with
// its safe option one game day later (offline too). Everything the answer does uses the usual mechanisms.

export const EVENT_GAP = { min: DAY_MIN, span: DAY_MIN }; // game minutes between an event and the next draw
export const FIRST_EVENT = 3 * DAY_MIN; // a new town: no event for the first three days
export const ANSWER_WITHIN = DAY_MIN; // an unanswered event resolves with the safe option after this long
export const RETRY = 360; // nothing fit: look again in six game hours
export const COOLDOWN = 4 * DAY_MIN; // the same kind does not come back sooner
const HOURS = { from: 7, to: 21 }; // events are put during the day only

export const AUTO = " (никто не ответил)"; // ends the outcome line of an event nobody answered

export const SHELTER_FOOD = 100; // kg of food the wanderers take along
export const CART = { wares: 10, planks: 2, food: 150, stone: 2 };
export const FROST_MOOD = -6;
export const FROST_LOSS = 0.2; // share of the unreaped grain
export const DIG_LABOR = 24; // person-hours the artel loses on the sites in progress
export const DIG_HOURS = 40; // digger-hours the deeper dig adds to the disc
export const FEAST = { kgPerPerson: 3, minKg: 60, mood: 12 };
export const SICK = { food: 80, death: 0.5 };

type Rand = () => number;
type Outcome = { sim: SimState; text: string };
type Body = Omit<TownChoice, "at" | "until" | "id">;

interface EventDef {
  id: string;
  weight: number; // 0: never drawn, put by its own trigger
  cond: (s: SimState) => boolean; // may the event be drawn now
  make: (s: SimState, rand: Rand) => Body;
  // The state after answer `option` (0 or 1) and the outcome line for the chronicle.
  apply: (s: SimState, option: 0 | 1, c: TownChoice, rand: Rand) => Outcome;
}

const opt = (label: string, effect: string): ChoiceOption => ({ label, effect });
const NOTHING = "Ничего не изменится.";
const moodAll = (s: SimState, d: number): SimState => ({ ...s, households: Object.fromEntries(Object.entries(s.households).map(([k, h]) => [k, { ...h, mood: Math.min(100, Math.max(0, h.mood + d)) }])) });
const popOf = (s: SimState): number => Object.keys(s.residents).length;
const freeHouse = (s: SimState): number | undefined => {
  const promised = new Set(s.incoming.map((f) => f.house));
  return vacantHouses(s.buildings, s.households).find((id) => !promised.has(id));
};

// Grain still standing in the fields a gumno works, while the harvest window is open.
function standingKg(s: SimState): number {
  if (windowAt(s.gameMinutes) !== "harvest") return 0;
  const year = calendar(s.gameMinutes).year;
  const assign = assignFields(s.zones.fields, s.buildings);
  let kg = 0;
  for (const f of s.zones.fields) {
    if (!assign.has(f.id)) continue;
    const w = workOf(s.prod.fields, f.id, year);
    kg += Math.max(0, expectedKg(f, w) - w.reaped);
  }
  return kg;
}

// Takes up to `hours` of done work back from the sites in progress (lowest id first).
function delayWork(s: SimState, hours: number): SimState {
  let left = hours;
  const buildings = { ...s.buildings };
  for (const b of Object.values(s.buildings)) {
    if (left <= 0) break;
    if (b.state !== "building" || isDig(b)) continue;
    const take = Math.min(b.done, left);
    if (take <= 0) continue;
    left -= take;
    buildings[b.id] = { ...b, done: b.done - take };
  }
  return { ...s, buildings };
}

const activeDig = (s: SimState) => Object.values(s.buildings).find((b) => isDig(b) && b.state === "active" && radiusOf(b) < DIG.maxRadius - 1e-6);

// Families with a home and at least two members that no healer covers.
const sickFamilies = (s: SimState) => Object.values(s.households).filter((h) => h.home !== null && h.members.length >= 2 && s.buildings[h.home] && !covers(s.coverage[h.home], "healer"));

const EVENTS: EventDef[] = [
  {
    id: "shelter",
    weight: 3,
    cond: (s) => freeHouse(s) !== undefined && s.stock.food >= SHELTER_FOOD * 2,
    make: () => ({
      title: "Странники просят приюта",
      text: "К окраине посёлка вышла семья странников: дорога была долгой, они просят крова. В посёлке есть свободный дом.",
      options: [opt("Принять", `В свободный дом переедет семья, на дорогу ей уйдёт ${SHELTER_FOOD} кг еды.`), opt("Отказать", NOTHING)],
      safe: 1,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 1) return { sim: s, text: "Странникам отказали: они ушли дальше" };
      const house = freeHouse(s);
      if (house === undefined || s.stock.food < SHELTER_FOOD) return { sim: s, text: "Странникам не нашлось места: они ушли дальше" };
      const [r, rng] = nextRandom(s.rng);
      const arrive = s.gameMinutes + CALL.minMinutes + r * (CALL.maxMinutes - CALL.minMinutes);
      const incoming = [...s.incoming, { house, arrive }].sort((a, b) => a.arrive - b.arrive);
      return { sim: { ...s, rng, incoming, stock: { ...s.stock, food: s.stock.food - SHELTER_FOOD } }, text: `Странников приняли: семья переедет в свободный дом (${SHELTER_FOOD} кг еды на дорогу)` };
    },
  },
  {
    id: "cart",
    weight: 3,
    cond: (s) => s.stock.wares >= CART.wares || s.stock.food >= CART.food * 2,
    make: (s, rand) => {
      const byWares = s.stock.wares >= CART.wares && (s.stock.food < CART.food * 2 || rand() < 0.5);
      const give = byWares ? `${CART.wares} шт товаров` : `${CART.food} кг еды`;
      const get = byWares ? `${CART.planks} м³ досок` : `${CART.stone} т камня`;
      return {
        title: "Торговая телега",
        text: `В посёлок заехал торговец. Он предлагает обмен: ${give} на ${get}.`,
        options: [opt("Обменять", `Уйдёт ${give}, придёт ${get}.`), opt("Отпустить", NOTHING)],
        safe: 1,
        arg: byWares ? 0 : 1,
      };
    },
    apply: (s, o, c) => {
      if (o === 1) return { sim: s, text: "Торговца проводили без обмена" };
      if (c.arg === 0) {
        if (s.stock.wares < CART.wares) return { sim: s, text: "Обмен не состоялся: не хватило товаров" };
        return { sim: { ...s, stock: { ...s.stock, wares: s.stock.wares - CART.wares, planks: s.stock.planks + CART.planks } }, text: `Обменяли ${CART.wares} шт товаров на ${CART.planks} м³ досок` };
      }
      if (s.stock.food < CART.food) return { sim: s, text: "Обмен не состоялся: не хватило еды" };
      return { sim: { ...s, stock: { ...s.stock, food: s.stock.food - CART.food, stone: s.stock.stone + CART.stone } }, text: `Обменяли ${CART.food} кг еды на ${CART.stone} т камня` };
    },
  },
  {
    id: "frost",
    weight: 6,
    cond: (s) => standingKg(s) > 50,
    make: (s) => ({
      title: "Ранний заморозок",
      text: "Ударил ранний заморозок, а уборка урожая ещё идёт. Колосья на корню могут пострадать.",
      options: [
        opt("Поднять всех на уборку", `Урожай цел, но настроение во всех семьях ${FROST_MOOD}.`),
        opt("Принять потерю", `Пропадёт пятая часть несжатого зерна (около ${massText(standingKg(s) * FROST_LOSS)}).`),
      ],
      safe: 0,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 0) return { sim: moodAll(s, FROST_MOOD), text: "Всех подняли на уборку урожая: урожай спасён, люди устали" };
      const year = calendar(s.gameMinutes).year;
      const assign = assignFields(s.zones.fields, s.buildings);
      const fields = { ...s.prod.fields };
      let lost = 0;
      for (const f of s.zones.fields) {
        if (!assign.has(f.id)) continue;
        const w = workOf(fields, f.id, year);
        const total = FIELD.yieldKgHa * haOf(f);
        const exp = expectedKg(f, w);
        const gone = Math.max(0, exp - w.reaped) * FROST_LOSS;
        if (gone <= 0) continue;
        lost += gone;
        fields[f.id] = { ...w, sowH: ((exp - gone) / total) * FIELD.sowHoursHa * haOf(f) };
      }
      return { sim: { ...s, prod: { ...s.prod, fields } }, text: `Заморозок побил хлеба: потеряно около ${massText(lost)} зерна` };
    },
  },
  {
    id: "dig",
    weight: 3,
    cond: (s) => activeDig(s) !== undefined,
    make: (s) => {
      const d = activeDig(s)!;
      return {
        title: "Находка на раскопе",
        text: "На раскопе наткнулись на что-то необычное: ниже, кажется, есть ещё слой.",
        options: [opt("Копать глубже", `Строители потеряют около ${DIG_LABOR} чел.-ч на стройках, раскоп расширится и откроет больше находок.`), opt("Идти дальше", NOTHING)],
        safe: 1,
        arg: d.id,
        pos: [d.lot.cx, d.lot.cy],
      };
    },
    apply: (s, o, c) => {
      if (o === 1) return { sim: s, text: "Находку оставили в земле: копать дальше не стали" };
      const d = s.buildings[c.arg];
      if (!d || !isDig(d) || d.state !== "active") return { sim: s, text: "Раскоп закрыт: копать глубже негде" };
      const delayed = delayWork(s, DIG_LABOR);
      const buildings = { ...delayed.buildings, [d.id]: { ...d, radius: growDig(radiusOf(d), DIG_HOURS) } };
      return { sim: { ...delayed, buildings }, text: "Копнули глубже: раскоп расширился, стройки задержались" };
    },
  },
  {
    id: "feast",
    weight: 0, // put when the harvest goal sets goals.feast
    cond: () => false,
    make: (s) => {
      const kg = Math.max(FEAST.minKg, Math.round(popOf(s) * FEAST.kgPerPerson));
      return {
        title: "Праздник урожая",
        text: "Урожай собран, склады полны. Люди просят отпраздновать.",
        options: [opt("Устроить пир", `Уйдёт ${kg} кг еды, настроение +${FEAST.mood} во всех семьях.`), opt("Обойтись", NOTHING)],
        safe: 1,
        arg: kg,
      };
    },
    apply: (s, o, c) => {
      if (o === 1) return { sim: s, text: "Праздник отложили: обошлись без пира" };
      if (s.stock.food < c.arg) return { sim: s, text: "Праздник не состоялся: не хватило еды" };
      return { sim: moodAll({ ...s, stock: { ...s.stock, food: s.stock.food - c.arg } }, FEAST.mood), text: `Устроили пир: ушло ${c.arg} кг еды, люди повеселели` };
    },
  },
  {
    id: "sick",
    weight: 3,
    cond: (s) => sickFamilies(s).length > 0,
    make: (s, rand) => {
      const list = sickFamilies(s);
      const h = list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
      const home = s.buildings[h.home!];
      return {
        title: "Больная семья",
        text: `В семье ${h.last} (${h.members.length} чел.) заболели. Врача рядом нет.`,
        options: [opt("Ухаживать", `Уйдёт ${SICK.food} кг еды, семья поправится.`), opt("Ждать", `С вероятностью ${Math.round(SICK.death * 100)}% умрёт один из членов семьи.`)],
        safe: 0,
        arg: h.id,
        pos: [home.lot.cx, home.lot.cy],
      };
    },
    apply: (s, o, c, rand) => {
      const h = s.households[c.arg];
      if (!h) return { sim: s, text: "Больная семья уехала: помогать некому" };
      const lacking = o === 0 && s.stock.food < SICK.food; // nothing to nurse them with
      if (o === 0 && !lacking) return { sim: { ...s, stock: { ...s.stock, food: s.stock.food - SICK.food } }, text: `Больную семью вылечили: ушло ${SICK.food} кг еды` };
      const why = lacking ? ", еды на уход не хватило" : "";
      if (rand() >= SICK.death) return { sim: s, text: `Больная семья справилась сама${why}` };
      const id = h.members[Math.min(h.members.length - 1, Math.floor(rand() * h.members.length))];
      const r = s.residents[id];
      return { sim: killResident(s, id), text: `Больная семья потеряла близкого: ${r ? `${r.sex === "f" ? "умерла" : "умер"} ${r.first} ${r.last}` : "умер один из них"}${why}` };
    },
  },
];

const BY_ID = new Map(EVENTS.map((e) => [e.id, e]));
export const EVENT_IDS = EVENTS.map((e) => e.id);

// A local generator over s.rng: the draw and the next state.
function generator(s: SimState): { rand: Rand; state: () => number } {
  let st = s.rng;
  return {
    rand: () => {
      const [v, n] = nextRandom(st);
      st = n;
      return v;
    },
    state: () => st,
  };
}

// ---------- resolving ----------

// Applies answer `option` to the pending event: effects, the outcome in the feed and the chronicle.
export function resolveChoice(s: SimState, option: 0 | 1, auto: boolean): SimState {
  const c = s.pending;
  const def = c && BY_ID.get(c.id);
  if (!c || !def) return { ...s, pending: null };
  const g = generator(s);
  const out = def.apply({ ...s, pending: null }, option, c, g.rand);
  const at = s.gameMinutes;
  const text = `${c.title}: ${out.text}${auto ? AUTO : ""}`;
  return {
    ...out.sim,
    rng: out.sim.rng !== s.rng ? out.sim.rng : g.state(), // shelter draws its own arrival time
    events: say(out.sim.events, at, "event", text, c.pos),
    chronicle: addChronicle(out.sim.chronicle, at, `event:${c.id}`, text),
  };
}

// ---------- scheduling ----------

function put(s: SimState, id: string, body: Body, next: number): SimState {
  const at = s.gameMinutes;
  const c: TownChoice = { id, at, until: at + ANSWER_WITHIN, ...body };
  return { ...s, pending: c, nextEvent: next, eventLast: { ...s.eventLast, [id]: at }, events: say(s.events, at, "event", `Событие: ${c.title}`, c.pos) };
}

// Every tick: an event past its deadline resolves with the safe option; with none waiting, the harvest feast comes
// as soon as goals.feast is set, else a drawn event when the time is due.
export function eventStep(s: SimState): SimState {
  let cur = s;
  if (cur.pending && cur.gameMinutes >= cur.pending.until) cur = resolveChoice(cur, cur.pending.safe, true);
  if (cur.pending) return cur;
  const hour = calendar(cur.gameMinutes).hour;
  if (hour < HOURS.from || hour >= HOURS.to) return cur;
  if (!cur.goals.feast && cur.gameMinutes < cur.nextEvent) return cur;
  const g = generator(cur);
  let def: EventDef | undefined;
  if (cur.goals.feast) def = BY_ID.get("feast");
  else {
    const fit = EVENTS.filter((e) => e.weight > 0 && cur.gameMinutes - (cur.eventLast[e.id] ?? -Infinity) >= COOLDOWN && e.cond(cur));
    if (fit.length === 0) return { ...cur, nextEvent: cur.gameMinutes + RETRY };
    let pick = g.rand() * fit.reduce((m, e) => m + e.weight, 0);
    def = fit.find((e) => (pick -= e.weight) < 0) ?? fit[fit.length - 1];
  }
  const body = def!.make(cur, g.rand);
  const next = cur.gameMinutes + EVENT_GAP.min + g.rand() * EVENT_GAP.span;
  const base: SimState = { ...cur, rng: g.state(), goals: def!.id === "feast" ? { ...cur.goals, feast: false } : cur.goals };
  return put(base, def!.id, body, def!.id === "feast" ? Math.max(cur.nextEvent, next) : next);
}

// ---------- saves ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

const parseOption = (v: unknown): ChoiceOption | null => (isRec(v) && str(v.label, 80) && str(v.effect, 300) ? { label: v.label, effect: v.effect } : null);

// A saved pending event, repaired; null when missing or broken.
export function parsePending(v: unknown): TownChoice | null {
  if (!isRec(v) || typeof v.id !== "string" || !BY_ID.has(v.id) || !isNum(v.at) || !isNum(v.until) || !str(v.title, 80) || !str(v.text, 400)) return null;
  if (!Array.isArray(v.options) || v.options.length !== 2 || (v.safe !== 0 && v.safe !== 1) || !isNum(v.arg)) return null;
  const a = parseOption(v.options[0]);
  const b = parseOption(v.options[1]);
  if (!a || !b) return null;
  const pos = Array.isArray(v.pos) && v.pos.length === 2 && isNum(v.pos[0]) && isNum(v.pos[1]) ? ([v.pos[0], v.pos[1]] as [number, number]) : undefined;
  return { id: v.id, at: v.at, until: v.until, title: v.title, text: v.text, options: [a, b], safe: v.safe, arg: v.arg, ...(pos ? { pos } : {}) };
}

export function parseEventLast(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isRec(v)) for (const id of EVENT_IDS) if (isNum(v[id])) out[id] = v[id] as number;
  return out;
}
