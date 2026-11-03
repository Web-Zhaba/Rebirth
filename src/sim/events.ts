import { addChronicle } from "./chronicle";
import { DIG, growDig, isDig, radiusOf } from "./excavation";
import { assignFields, expectedKg, FIELD, haOf, windowAt, workOf } from "./fields";
import { CALL } from "./levers";
import { ageOf, fullName, isAdultAge, isFinishedHouse, killResident, syncPeople, vacantHouses } from "./people";
import { say } from "./production";
import { cropOf } from "./tech";
import { nextRandom } from "./rng";
import { refreshServices } from "./coverage";
import { covers } from "./services";
import { calendar, DAY_MIN } from "./time";
import { massText } from "./units";
import { floodRisk, lightFrost } from "./weatherEffects";
import type { Building, ChoiceOption, ServiceId, SimState, TownChoice } from "./types";
import { L } from "../i18n";

// Events with choices (PLAN-pace.md section 10). One event every one to two game days, drawn by the sim generator from
// the kinds whose condition holds; two options, each with its effect in the text. An event nobody answers resolves with
// its safe option one game day later (offline too). Everything the answer does uses the usual mechanisms.

export const EVENT_GAP = { min: DAY_MIN, span: DAY_MIN }; // game minutes between an event and the next draw
export const FIRST_EVENT = 3 * DAY_MIN; // a new town: no event for the first three days
export const ANSWER_WITHIN = DAY_MIN; // an unanswered event resolves with the safe option after this long
export const RETRY = 360; // nothing fit: look again in six game hours
export const COOLDOWN = 4 * DAY_MIN; // the same kind does not come back sooner
const HOURS = { from: 7, to: 21 }; // events are put during the day only

export const AUTO = L(" (никто не ответил)", " (no one answered)"); // ends the outcome line of an event nobody answered

export const SHELTER_FOOD = 100; // kg of food the wanderers take along
export const CART = { wares: 10, planks: 2, food: 150, stone: 2 };
export const FROST_MOOD = -6;
export const FROST_LOSS = 0.2; // share of the unreaped grain
export const DIG_LABOR = 24; // person-hours the artel loses on the sites in progress
export const DIG_HOURS = 40; // digger-hours the deeper dig adds to the disc
export const FEAST = { kgPerPerson: 3, minKg: 60, mood: 12 };
export const SICK = { food: 80, death: 0.5 };
export const FIRE = { labor: 30 }; // person-hours taken from the sites to put a fire out
export const FLOOD = { labor: 30, share: 0.15 }; // the share of the food stock a flood spoils if nobody digs
export const WOLF = { labor: 24, death: 0.25, mood: -4 }; // a hunt costs labor and may cost a hunter; a locked yard costs mood
export const RAID = { food: 150, death: 0.3 }; // the raiders' price in food; the chance a fight costs an adult
export const COLLAPSE = { labor: 30, death: 0.5 }; // labor to dig a quarryman out; the chance he dies if left
export const HOARD = { wares: 10, stone: 2, mood: 8 }; // a find handed to the common store, or shared out for mood
export const MINSTREL = { food: 40, mood: 6 }; // the feast for the travelling players

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
const NOTHING = L("Ничего не изменится.", "Nothing changes.");
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
    kg += Math.max(0, expectedKg(f, w, cropOf(s)) - w.reaped);
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

const pick = <T,>(list: T[], rand: Rand): T => list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
const finishedHouses = (s: SimState) => Object.values(s.buildings).filter(isFinishedHouse);
const adults = (s: SimState) => Object.values(s.residents).filter((r) => isAdultAge(ageOf(r.born, s.gameMinutes)));
const quarrymen = (s: SimState) => Object.values(s.residents).filter((r) => r.job !== null && s.buildings[r.job]?.template === "quarry");
const died = (r: { sex: "m" | "f"; first: string; last: string }) => L(`${r.sex === "f" ? "погибла" : "погиб"} ${fullName(r)}`, `${fullName(r)} was killed`);
const chance = (p: number) => `${Math.round(p * 100)}%`;
// The town has a finished building of this kind (a tavern, a market, a hunter's hut).
const active = (s: SimState, template: string) => Object.values(s.buildings).some((b) => b.state === "active" && b.template === template);
// A building within a service's reach (services cover the houses and workplaces around them).
const coveredBy = (s: SimState, b: Building | undefined, id: ServiceId) => !!b && covers(s.coverage[b.id], id);
// The same effects, lessened by the building that prevents them.
const fireLabor = (s: SimState, b?: Building) => (coveredBy(s, b, "well") ? FIRE.labor / 2 : FIRE.labor);
const huntDeath = (s: SimState) => (active(s, "hunter") ? WOLF.death / 2 : WOLF.death);
const bribe = (s: SimState) => (active(s, "market") ? RAID.food / 2 : RAID.food);
const quarryDeath = (s: SimState, b?: Building) => (coveredBy(s, b, "healer") ? COLLAPSE.death / 2 : COLLAPSE.death);
const feastKg = (s: SimState) => (active(s, "tavern") ? MINSTREL.food / 2 : MINSTREL.food);

// Families with a home and at least two members that no healer covers.
const sickFamilies = (s: SimState) => Object.values(s.households).filter((h) => h.home !== null && h.members.length >= 2 && s.buildings[h.home] && !covers(s.coverage[h.home], "healer"));

const EVENTS: EventDef[] = [
  {
    id: "shelter",
    weight: 3,
    cond: (s) => freeHouse(s) !== undefined && s.stock.food >= SHELTER_FOOD * 2,
    make: () => ({
      title: L("Странники просят приюта", "Wanderers ask for shelter"),
      text: L("К окраине посёлка вышла семья странников: дорога была долгой, они просят крова. В посёлке есть свободный дом.", "A family of wanderers has come to the edge of the village: the road was long and they ask for a roof. There is a free house."),
      options: [opt(L("Принять", "Take them in"), L(`В свободный дом переедет семья, на дорогу ей уйдёт ${SHELTER_FOOD} кг еды.`, `The family moves into the free house; ${SHELTER_FOOD} kg of food goes to them for the road.`)), opt(L("Отказать", "Refuse"), NOTHING)],
      safe: 1,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 1) return { sim: s, text: L("Странникам отказали: они ушли дальше", "The wanderers were refused and moved on") };
      const house = freeHouse(s);
      if (house === undefined || s.stock.food < SHELTER_FOOD) return { sim: s, text: L("Странникам не нашлось места: они ушли дальше", "There was no room for the wanderers; they moved on") };
      const [r, rng] = nextRandom(s.rng);
      const arrive = s.gameMinutes + CALL.minMinutes + r * (CALL.maxMinutes - CALL.minMinutes);
      const incoming = [...s.incoming, { house, arrive }].sort((a, b) => a.arrive - b.arrive);
      return { sim: { ...s, rng, incoming, stock: { ...s.stock, food: s.stock.food - SHELTER_FOOD } }, text: L(`Странников приняли: семья переедет в свободный дом (${SHELTER_FOOD} кг еды на дорогу)`, `The wanderers were taken in: the family moves into the free house (${SHELTER_FOOD} kg of food for the road)`) };
    },
  },
  {
    id: "cart",
    weight: 3,
    cond: (s) => s.stock.wares >= CART.wares || s.stock.food >= CART.food * 2,
    make: (s, rand) => {
      const byWares = s.stock.wares >= CART.wares && (s.stock.food < CART.food * 2 || rand() < 0.5);
      const give = byWares ? L(`${CART.wares} шт товаров`, `${CART.wares} goods`) : L(`${CART.food} кг еды`, `${CART.food} kg of food`);
      const get = byWares ? L(`${CART.planks} м³ досок`, `${CART.planks} m³ of planks`) : L(`${CART.stone} т камня`, `${CART.stone} t of stone`);
      return {
        title: L("Торговая телега", "A trader’s cart"),
        text: L(`В посёлок заехал торговец. Он предлагает обмен: ${give} на ${get}.`, `A trader has driven into the village. He offers a trade: ${give} for ${get}.`),
        options: [opt(L("Обменять", "Trade"), L(`Уйдёт ${give}, придёт ${get}.`, `${give} go out, ${get} come in.`)), opt(L("Отпустить", "Let him go"), NOTHING)],
        safe: 1,
        arg: byWares ? 0 : 1,
      };
    },
    apply: (s, o, c) => {
      if (o === 1) return { sim: s, text: L("Торговца проводили без обмена", "The trader left without a deal") };
      if (c.arg === 0) {
        if (s.stock.wares < CART.wares) return { sim: s, text: L("Обмен не состоялся: не хватило товаров", "No trade: not enough goods") };
        return { sim: { ...s, stock: { ...s.stock, wares: s.stock.wares - CART.wares, planks: s.stock.planks + CART.planks } }, text: L(`Обменяли ${CART.wares} шт товаров на ${CART.planks} м³ досок`, `Traded ${CART.wares} goods for ${CART.planks} m³ of planks`) };
      }
      if (s.stock.food < CART.food) return { sim: s, text: L("Обмен не состоялся: не хватило еды", "No trade: not enough food") };
      return { sim: { ...s, stock: { ...s.stock, food: s.stock.food - CART.food, stone: s.stock.stone + CART.stone } }, text: L(`Обменяли ${CART.food} кг еды на ${CART.stone} т камня`, `Traded ${CART.food} kg of food for ${CART.stone} t of stone`) };
    },
  },
  {
    id: "frost",
    weight: 6,
    // With weather: a light frost night (a harder one has already cost grain, see nightFrost); calm: a random draw.
    cond: (s) => standingKg(s) > 50 && (!s.weather.site || lightFrost(s.weather)),
    make: (s) => ({
      title: L("Ранний заморозок", "Early frost"),
      text: L("Ударил ранний заморозок, а уборка урожая ещё идёт. Колосья на корню могут пострадать.", "An early frost has struck while the harvest is still under way. The standing grain may suffer."),
      options: [
        opt(L("Поднять всех на уборку", "Everyone to the harvest"), L(`Урожай цел, но настроение во всех семьях ${FROST_MOOD}.`, `The crop is saved, but mood in every family ${FROST_MOOD}.`)),
        opt(L("Принять потерю", "Accept the loss"), L(`Пропадёт пятая часть несжатого зерна (около ${massText(standingKg(s) * FROST_LOSS)}).`, `A fifth of the unreaped grain is lost (about ${massText(standingKg(s) * FROST_LOSS)}).`)),
      ],
      safe: 0,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 0) return { sim: moodAll(s, FROST_MOOD), text: L("Всех подняли на уборку урожая: урожай спасён, люди устали", "Everyone turned out for the harvest: the crop is saved, people are tired") };
      const year = calendar(s.gameMinutes).year;
      const assign = assignFields(s.zones.fields, s.buildings);
      const fields = { ...s.prod.fields };
      let lost = 0;
      for (const f of s.zones.fields) {
        if (!assign.has(f.id)) continue;
        const w = workOf(fields, f.id, year);
        const total = FIELD.yieldKgHa * haOf(f) * cropOf(s);
        const exp = expectedKg(f, w, cropOf(s));
        const gone = Math.max(0, exp - w.reaped) * FROST_LOSS;
        if (gone <= 0) continue;
        lost += gone;
        fields[f.id] = { ...w, sowH: ((exp - gone) / total) * FIELD.sowHoursHa * haOf(f) };
      }
      return { sim: { ...s, prod: { ...s.prod, fields } }, text: L(`Заморозок побил хлеба: потеряно около ${massText(lost)} зерна`, `The frost hit the grain: about ${massText(lost)} lost`) };
    },
  },
  {
    id: "dig",
    weight: 3,
    cond: (s) => activeDig(s) !== undefined,
    make: (s) => {
      const d = activeDig(s)!;
      return {
        title: L("Находка на раскопе", "A find at the dig"),
        text: L("На раскопе наткнулись на что-то необычное: ниже, кажется, есть ещё слой.", "The diggers hit something unusual: there seems to be another layer below."),
        options: [opt(L("Копать глубже", "Dig deeper"), L(`Строители потеряют около ${DIG_LABOR} чел.-ч на стройках, раскоп расширится и откроет больше находок.`, `Builders lose about ${DIG_LABOR} person-h on the sites; the dig widens and uncovers more finds.`)), opt(L("Идти дальше", "Move on"), NOTHING)],
        safe: 1,
        arg: d.id,
        pos: [d.lot.cx, d.lot.cy],
      };
    },
    apply: (s, o, c) => {
      if (o === 1) return { sim: s, text: L("Находку оставили в земле: копать дальше не стали", "The find was left in the ground: no deeper digging") };
      const d = s.buildings[c.arg];
      if (!d || !isDig(d) || d.state !== "active") return { sim: s, text: L("Раскоп закрыт: копать глубже негде", "The dig is closed: nowhere to dig deeper") };
      const delayed = delayWork(s, DIG_LABOR);
      const buildings = { ...delayed.buildings, [d.id]: { ...d, radius: growDig(radiusOf(d), DIG_HOURS) } };
      return { sim: { ...delayed, buildings }, text: L("Копнули глубже: раскоп расширился, стройки задержались", "Dug deeper: the dig widened, building was delayed") };
    },
  },
  {
    id: "feast",
    weight: 0, // put once, by the first finished harvest (feastDue)
    cond: () => false,
    make: (s) => {
      const kg = Math.max(FEAST.minKg, Math.round(popOf(s) * FEAST.kgPerPerson));
      return {
        title: L("Праздник урожая", "Harvest festival"),
        text: L("Урожай собран, склады полны. Люди просят отпраздновать.", "The harvest is in and the stores are full. People ask for a celebration."),
        options: [opt(L("Устроить пир", "Hold a feast"), L(`Уйдёт ${kg} кг еды, настроение +${FEAST.mood} во всех семьях.`, `${kg} kg of food is spent, mood +${FEAST.mood} in every family.`)), opt(L("Обойтись", "Do without"), NOTHING)],
        safe: 1,
        arg: kg,
      };
    },
    apply: (s, o, c) => {
      if (o === 1) return { sim: s, text: L("Праздник отложили: обошлись без пира", "The festival was put off: no feast") };
      if (s.stock.food < c.arg) return { sim: s, text: L("Праздник не состоялся: не хватило еды", "No festival: not enough food") };
      return { sim: moodAll({ ...s, stock: { ...s.stock, food: s.stock.food - c.arg } }, FEAST.mood), text: L(`Устроили пир: ушло ${c.arg} кг еды, люди повеселели`, `A feast was held: ${c.arg} kg of food spent, people cheered up`) };
    },
  },
  {
    id: "sick",
    weight: 3,
    cond: (s) => sickFamilies(s).length > 0,
    make: (s, rand) => {
      const h = pick(sickFamilies(s), rand);
      const home = s.buildings[h.home!];
      return {
        title: L("Больная семья", "A sick family"),
        text: L(`В семье ${h.last} (${h.members.length} чел.) заболели. Врача рядом нет.`, `The ${h.last} family (${h.members.length} ${h.members.length === 1 ? "person" : "people"}) has fallen ill. There is no doctor nearby.`),
        options: [opt(L("Ухаживать", "Nurse them"), L(`Уйдёт ${SICK.food} кг еды, семья поправится.`, `${SICK.food} kg of food is spent; the family recovers.`)), opt(L("Ждать", "Wait"), L(`С вероятностью ${Math.round(SICK.death * 100)}% умрёт один из членов семьи.`, `A ${Math.round(SICK.death * 100)}% chance that one family member dies.`))],
        safe: 0,
        arg: h.id,
        pos: [home.lot.cx, home.lot.cy],
      };
    },
    apply: (s, o, c, rand) => {
      const h = s.households[c.arg];
      if (!h) return { sim: s, text: L("Больная семья уехала: помогать некому", "The sick family has left: no one to help") };
      const lacking = o === 0 && s.stock.food < SICK.food; // nothing to nurse them with
      if (o === 0 && !lacking) return { sim: { ...s, stock: { ...s.stock, food: s.stock.food - SICK.food } }, text: L(`Больную семью вылечили: ушло ${SICK.food} кг еды`, `The sick family was nursed back to health: ${SICK.food} kg of food spent`) };
      const why = lacking ? L(", еды на уход не хватило", "; there was not enough food to nurse them") : "";
      if (rand() >= SICK.death) return { sim: s, text: L(`Больная семья справилась сама${why}`, `The sick family pulled through on its own${why}`) };
      const id = h.members[Math.min(h.members.length - 1, Math.floor(rand() * h.members.length))];
      const r = s.residents[id];
      return { sim: killResident(s, id), text: L(`Больная семья потеряла близкого: ${r ? `${r.sex === "f" ? "умерла" : "умер"} ${r.first} ${r.last}` : "умер один из них"}${why}`, `The sick family lost one of its own: ${r ? `${r.first} ${r.last} died` : "one of them died"}${why}`) };
    },
  },
  {
    id: "fire",
    weight: 3,
    cond: (s) => finishedHouses(s).length > 0,
    make: (s, rand) => {
      const b = pick(finishedHouses(s), rand);
      const h = Object.values(s.households).find((x) => x.home === b.id);
      return {
        title: L("Пожар", "Fire"),
        text: h ? L(`Загорелся дом семьи ${h.last}. Огонь быстро перекидывается на соседние крыши.`, `The ${h.last} family’s house is on fire. The flames are spreading quickly to the nearby roofs.`) : L("Загорелся пустой дом. Огонь быстро перекидывается на соседние крыши.", "An empty house is on fire. The flames are spreading quickly to the nearby roofs."),
        options: [opt(L("Тушить всем посёлком", "Everyone fights the fire"), L(`Стройки потеряют ${fireLabor(s, b)} чел.-ч, дом уцелеет.`, `The sites lose ${fireLabor(s, b)} person-h; the house is saved.`)), opt(L("Дать сгореть", "Let it burn"), h ? L(`Дом сгорит, семья ${h.last} останется без крова.`, `The house burns down; the ${h.last} family is left homeless.`) : L("Дом сгорит.", "The house burns down."))],
        safe: 0,
        arg: b.id,
        pos: [b.lot.cx, b.lot.cy],
      };
    },
    apply: (s, o, c) => {
      if (o === 0) return { sim: delayWork(s, fireLabor(s, s.buildings[c.arg])), text: L("Пожар потушили всем посёлком: дом уцелел, стройки задержались", "The whole village put out the fire: the house survived, building was delayed") };
      const b = s.buildings[c.arg];
      if (!b || !isFinishedHouse(b)) return { sim: s, text: L("Гореть уже нечему", "Nothing left to burn") };
      const rest = { ...s.buildings };
      delete rest[b.id];
      const homeless = Object.values(s.households).some((h) => h.home === b.id);
      return { sim: refreshServices(syncPeople({ ...s, buildings: rest })), text: L(`Дом сгорел дотла${homeless ? ": семья осталась без крова" : ""}`, `The house burned to the ground${homeless ? ": the family is homeless" : ""}`) };
    },
  },
  {
    id: "flood",
    weight: 3,
    cond: (s) => s.stock.food > 0 && (!s.weather.site || floodRisk(s.weather)),
    make: () => ({
      title: L("Паводок", "Flood"),
      text: L("Река поднялась за ночь и подходит к складам. Вода ещё не дошла до зерна, но медлить нельзя.", "The river rose overnight and is nearing the stores. The water hasn’t reached the grain yet, but there is no time to lose."),
      options: [opt(L("Копать канавы", "Dig ditches"), L(`Стройки потеряют ${FLOOD.labor} чел.-ч, вода уйдёт от складов.`, `The sites lose ${FLOOD.labor} person-h; the water is led away from the stores.`)), opt(L("Ждать, пока отступит", "Wait for it to recede"), L(`Вода подмочит около ${chance(FLOOD.share)} запасов еды.`, `The water spoils about ${chance(FLOOD.share)} of the food stores.`))],
      safe: 0,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 0) return { sim: delayWork(s, FLOOD.labor), text: L("Канавы отвели воду: стройки задержались, запасы целы", "The ditches led the water away: building was delayed, the stores are safe") };
      const lost = s.stock.food * FLOOD.share;
      return { sim: { ...s, stock: { ...s.stock, food: s.stock.food - lost } }, text: L(`Вода подмочила запасы: погибло около ${massText(lost)} зерна`, `The water spoiled the stores: about ${massText(lost)} of grain lost`) };
    },
  },
  {
    id: "wolves",
    weight: 3,
    cond: (s) => calendar(s.gameMinutes).season === 3 && adults(s).length > 0,
    make: (s) => ({
      title: L("Волки у околицы", "Wolves at the edge of the village"),
      text: L("Голодные зимние волки ходят вокруг дворов и ночью воют у домов.", "Hungry winter wolves prowl around the yards and howl by the houses at night."),
      options: [opt(L("Устроить облаву", "Hunt them down"), L(`Стройки потеряют ${WOLF.labor} чел.-ч; при облаве может погибнуть охотник (${chance(huntDeath(s))}).`, `The sites lose ${WOLF.labor} person-h; a hunter may die in the hunt (${chance(huntDeath(s))}).`)), opt(L("Запереть дворы", "Lock the yards"), L(`Зима в запертых домах тяжелее: настроение во всех семьях ${WOLF.mood}.`, `Winter behind locked doors is harder: mood in every family ${WOLF.mood}.`))],
      safe: 1,
      arg: 0,
    }),
    apply: (s, o, c, rand) => {
      if (o === 1) return { sim: moodAll(s, WOLF.mood), text: L("Дворы заперли: волки ушли ни с чем, зима в запертых домах тяжелее", "The yards were locked: the wolves left with nothing, winter behind locked doors is harder") };
      const d = delayWork(s, WOLF.labor);
      const pool = adults(s);
      if (pool.length === 0 || rand() >= huntDeath(s)) return { sim: d, text: L("Волков отогнали облавой: охотники вернулись живыми", "The hunt drove the wolves off: the hunters came back alive") };
      const r = pick(pool, rand);
      return { sim: killResident(d, r.id), text: L(`В облаве ${died(r)}`, `In the hunt, ${died(r)}`) };
    },
  },
  {
    id: "raid",
    weight: 2,
    cond: (s) => s.stock.food >= RAID.food,
    make: (s) => ({
      title: L("Разбойники на дороге", "Robbers on the road"),
      text: L("Чужие люди с оружием перегородили дорогу и требуют отдать запасы.", "Armed strangers have blocked the road and demand the stores."),
      options: [opt(L("Откупиться", "Pay them off"), L(`Уйдёт ${bribe(s)} кг еды.`, `${bribe(s)} kg of food is handed over.`)), opt(L("Дать отпор", "Fight back"), L(`С вероятностью ${chance(RAID.death)} в драке погибнет один из взрослых жителей. Еда останется.`, `A ${chance(RAID.death)} chance an adult resident dies in the fight. The food stays.`))],
      safe: 0,
      arg: 0,
    }),
    apply: (s, o, c, rand) => {
      if (o === 0) {
        const paid = Math.min(bribe(s), s.stock.food);
        return { sim: { ...s, stock: { ...s.stock, food: s.stock.food - paid } }, text: L(`Откупились: ушло ${paid} кг еды`, `Paid them off: ${paid} kg of food handed over`) };
      }
      const pool = adults(s);
      if (pool.length === 0 || rand() >= RAID.death) return { sim: s, text: L("Разбойники побежали после первого же удара", "The robbers fled after the first blow") };
      const r = pick(pool, rand);
      return { sim: killResident(s, r.id), text: L(`В драке с разбойниками ${died(r)}`, `In the fight with the robbers, ${died(r)}`) };
    },
  },
  {
    id: "collapse",
    weight: 2,
    cond: (s) => quarrymen(s).length > 0,
    make: (s, rand) => {
      const r = pick(quarrymen(s), rand);
      const b = s.buildings[r.job!];
      return {
        title: L("Обвал в карьере", "Quarry collapse"),
        text: L(`В карьере обвалился свод: ${fullName(r)} оказался под камнями.`, `The roof of the quarry collapsed: ${fullName(r)} is trapped under the stones.`),
        options: [opt(L("Вытаскивать", "Dig them out"), L(`Стройки потеряют ${COLLAPSE.labor} чел.-ч: людей роют из-под камней.`, `The sites lose ${COLLAPSE.labor} person-h digging people out from under the stones.`)), opt(L("Работать дальше", "Keep working"), L(`С вероятностью ${chance(quarryDeath(s, b))} ${fullName(r)} не выберется.`, `A ${chance(quarryDeath(s, b))} chance that ${fullName(r)} won’t get out.`))],
        safe: 0,
        arg: r.id,
        pos: [b.lot.cx, b.lot.cy],
      };
    },
    apply: (s, o, c, rand) => {
      if (o === 0) return { sim: delayWork(s, COLLAPSE.labor), text: L("Человека вытащили из-под камней: стройки задержались", "The worker was pulled out from under the stones: building was delayed") };
      const r = s.residents[c.arg];
      if (!r) return { sim: s, text: L("Пострадавший уже ушёл из посёлка", "The injured worker has already left the village") };
      const b = r.job === null ? undefined : s.buildings[r.job];
      if (rand() >= quarryDeath(s, b)) return { sim: s, text: L(`${fullName(r)} выбрался сам`, `${fullName(r)} got out on their own`) };
      return { sim: killResident(s, r.id), text: L(`Под обвалом ${died(r)}`, `In the collapse, ${died(r)}`) };
    },
  },
  {
    id: "hoard",
    weight: 2,
    cond: () => true,
    make: () => ({
      title: L("Находка в земле", "A find in the ground"),
      text: L("Под старым полом нашли глиняный горшок с бронзовыми украшениями и утварью.", "Under an old floor, a clay pot with bronze ornaments and utensils was found."),
      options: [opt(L("Сдать в общий запас", "Give it to the common store"), L(`Пойдёт в запасы: ${HOARD.wares} шт товаров и ${HOARD.stone} т камня.`, `Goes to the stores: ${HOARD.wares} goods and ${HOARD.stone} t of stone.`)), opt(L("Поделить между семьями", "Share it among the families"), L(`Каждая семья получит свою вещь: настроение +${HOARD.mood}.`, `Each family gets something: mood +${HOARD.mood}.`))],
      safe: 0,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 1) return { sim: moodAll(s, HOARD.mood), text: L("Находку поделили между семьями: люди довольны", "The find was shared among the families: people are pleased") };
      return { sim: { ...s, stock: { ...s.stock, wares: s.stock.wares + HOARD.wares, stone: s.stock.stone + HOARD.stone } }, text: L(`Находку сдали в общий запас: ${HOARD.wares} шт товаров и ${HOARD.stone} т камня`, `The find went to the common store: ${HOARD.wares} goods and ${HOARD.stone} t of stone`) };
    },
  },
  {
    id: "minstrels",
    weight: 3,
    cond: () => true,
    make: (s) => ({
      title: L("Бродячие музыканты", "Travelling musicians"),
      text: L("В посёлок пришли бродячие музыканты с инструментами и ручным медведем. Просят места у костра и угощения.", "Travelling musicians with their instruments and a tame bear have come to the village. They ask for a place by the fire and something to eat."),
      options: [opt(L("Угостить", "Feed them"), L(`Уйдёт ${feastKg(s)} кг еды, настроение во всех семьях +${MINSTREL.mood}.`, `${feastKg(s)} kg of food is spent, mood in every family +${MINSTREL.mood}.`)), opt(L("Прогнать", "Send them away"), NOTHING)],
      safe: 1,
      arg: 0,
    }),
    apply: (s, o) => {
      if (o === 1) return { sim: s, text: L("Музыкантов прогнали: ушли дальше по дороге", "The musicians were sent away and went on down the road") };
      const kg = feastKg(s);
      if (s.stock.food < kg) return { sim: s, text: L("Угостить музыкантов было нечем: ушли дальше", "There was nothing to feed the musicians; they moved on") };
      return { sim: moodAll({ ...s, stock: { ...s.stock, food: s.stock.food - kg } }, MINSTREL.mood), text: L(`Музыкантов угостили: ушло ${kg} кг еды, люди повеселели`, `The musicians were fed: ${kg} kg of food spent, people cheered up`) };
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

// Applies answer `option` to the pending event: effects and the outcome in the feed. Only an event the player answered
// goes to the chronicle too; the ones that resolve on their own would fill it with routine.
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
    chronicle: auto ? out.sim.chronicle : addChronicle(out.sim.chronicle, at, `event:${c.id}`, text),
  };
}

// ---------- scheduling ----------

function put(s: SimState, id: string, body: Body, next: number): SimState {
  const at = s.gameMinutes;
  const c: TownChoice = { id, at, until: at + ANSWER_WITHIN, ...body };
  return { ...s, pending: c, nextEvent: next, eventLast: { ...s.eventLast, [id]: at }, events: say(s.events, at, "event", L(`Событие: ${c.title}`, `Event: ${c.title}`), c.pos) };
}

// The harvest feast is owed once: the first harvest is finished and no feast was ever put.
const feastDue = (s: SimState): boolean => s.eventLast.feast === undefined && (s.prod.flags.done || s.chronicle.some((e) => e.kind === "harvest"));

// Every tick: an event past its deadline resolves with the safe option; with none waiting, the harvest feast comes
// as soon as it is due, else a drawn event when the time is due.
export function eventStep(s: SimState): SimState {
  let cur = s;
  if (cur.pending && cur.gameMinutes >= cur.pending.until) cur = resolveChoice(cur, cur.pending.safe, true);
  if (cur.pending) return cur;
  const hour = calendar(cur.gameMinutes).hour;
  if (hour < HOURS.from || hour >= HOURS.to) return cur;
  const feast = feastDue(cur);
  if (!feast && cur.gameMinutes < cur.nextEvent) return cur;
  const g = generator(cur);
  let def: EventDef | undefined;
  if (feast) def = BY_ID.get("feast");
  else {
    const fit = EVENTS.filter((e) => e.weight > 0 && cur.gameMinutes - (cur.eventLast[e.id] ?? -Infinity) >= COOLDOWN && e.cond(cur));
    if (fit.length === 0) return { ...cur, nextEvent: cur.gameMinutes + RETRY };
    let pick = g.rand() * fit.reduce((m, e) => m + e.weight, 0);
    def = fit.find((e) => (pick -= e.weight) < 0) ?? fit[fit.length - 1];
  }
  const body = def!.make(cur, g.rand);
  const next = cur.gameMinutes + EVENT_GAP.min + g.rand() * EVENT_GAP.span;
  const base: SimState = { ...cur, rng: g.state() };
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
