import { addChronicle } from "./chronicle";
import { assignFields, FIELD, haOf, workOf } from "./fields";
import { CALL } from "./levers";
import { vacantHouses } from "./people";
import { say } from "./production";
import { nextRandom } from "./rng";
import { calendar, dayOf } from "./time";
import type { Building, GoalsState, SimState, ZoneType } from "./types";

// Goals and unlocks (PLAN-pace.md section 9). Three goals are active at a time; finishing one pays its reward and the
// next goal of the chain takes the free slot. Everything not listed as an unlock is available from the start:
// path, road, demolish, residential zone, field, clearing, gumno, woodcutter, well, dig (and «снять зону»).

export const ACTIVE_GOALS = 3;
export const FEAST_MOOD = 15; // one-off mood bonus of the harvest feast reward

type Slice = Pick<SimState, "buildings" | "residents" | "stock" | "prod" | "zones" | "chronicle" | "clearings" | "gameMinutes">;

export interface GoalDef {
  id: string;
  title: string; // «Построить 2 избы»
  reward: string; // what it pays, shown up front
  target: number;
  unit: string; // "", "м³", "га"
  unlocks: string[]; // unlock keys paid by the goal
  families?: number; // free families that come
  value: (s: Slice) => number; // progress, may exceed the target
  gate?: (s: Slice) => boolean; // extra condition besides value >= target
  gateHint?: string; // shown while the gate is closed
}

const finished = (b: Building): boolean => b.state === "active";
const countWhere = (s: Pick<SimState, "buildings">, f: (b: Building) => boolean): number => Object.values(s.buildings).filter((b) => finished(b) && f(b)).length;
const exists = (s: Pick<SimState, "buildings">, f: (b: Building) => boolean): boolean => Object.values(s.buildings).some((b) => finished(b) && f(b));

// Hectares sown this year on the fields a gumno works.
export function sownHa(s: Pick<SimState, "zones" | "buildings" | "prod" | "gameMinutes">): number {
  const year = calendar(s.gameMinutes).year;
  const assign = assignFields(s.zones.fields, s.buildings);
  let ha = 0;
  for (const f of s.zones.fields) {
    if (!assign.has(f.id)) continue;
    const w = workOf(s.prod.fields, f.id, year);
    ha += haOf(f) * Math.min(1, w.sowH / (FIELD.sowHoursHa * haOf(f)));
  }
  return ha;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// Chain order = the order of the plan table.
export const GOALS: GoalDef[] = [
  { id: "izbas2", title: "Построить 2 избы", reward: "пильня, амбар", target: 2, unit: "", unlocks: ["sawpit", "barn"], value: (s) => countWhere(s, (b) => b.zone === "res") },
  {
    id: "logs20",
    title: "Накопить 20 м³ брёвен",
    reward: "каменоломня, ремесленная зона",
    target: 20,
    unit: "м³",
    unlocks: ["quarry", "zone:craft"],
    value: (s) => s.stock.logs,
    // The founding stock already holds the logs: they count once the town makes its own (a woodcutter or a clearing).
    gate: (s) => exists(s, (b) => b.template === "woodcutter") || s.clearings.some((c) => c.done >= c.labor),
    gateHint: "нужен лесоруб или вырубка",
  },
  { id: "sow2", title: "Засеять 2 га", reward: "рыбак, +1 семья", target: 2, unit: "га", unlocks: ["fisher"], families: 1, value: (s) => round1(sownHa(s)) },
  { id: "dig", title: "Открыть раскоп", reward: "первая статья в тетради", target: 1, unit: "", unlocks: [], value: (s) => countWhere(s, (b) => b.template === "dig") },
  { id: "pop25", title: "25 жителей", reward: "торговая зона, рынок", target: 25, unit: "", unlocks: ["zone:trade", "market"], value: (s) => Object.keys(s.residents).length },
  {
    id: "harvest",
    title: "Первый урожай",
    reward: "часовня, праздник урожая",
    target: 1,
    unit: "",
    unlocks: ["chapel"],
    value: (s) => (s.chronicle.some((e) => e.kind === "harvest") || s.prod.flags.done ? 1 : 0),
  },
  { id: "pop50", title: "50 жителей", reward: "школа, лекарь", target: 50, unit: "", unlocks: ["school", "healer"], value: (s) => Object.keys(s.residents).length },
  { id: "craft5", title: "5 ремесленных построек", reward: "улучшение изб", target: 5, unit: "", unlocks: ["upgrade"], value: (s) => countWhere(s, (b) => b.zone === "craft") },
];

const GOAL_BY_ID = new Map(GOALS.map((g) => [g.id, g]));

// What each unlock key is called in the reward lines.
export const UNLOCK_NAME: Record<string, string> = {
  sawpit: "пильня",
  barn: "амбар",
  quarry: "каменоломня",
  fisher: "рыбак",
  market: "рынок",
  chapel: "часовня",
  school: "школа",
  healer: "лекарь",
  "zone:craft": "ремесленная зона",
  "zone:trade": "торговая зона",
  upgrade: "улучшение изб",
};

// The goal that opens each unlock.
export const UNLOCK_GOAL: Record<string, GoalDef> = {};
for (const g of GOALS) for (const k of g.unlocks) UNLOCK_GOAL[k] = g;

export const ALL_UNLOCKS = Object.keys(UNLOCK_NAME);

export const initialGoals = (): GoalsState => ({ done: [], unlocks: [], families: 0, notebook: false, feast: false });
// Every goal paid, nothing locked: for plain sim states in tests and tools that do not play the chain.
export const allUnlocked = (): GoalsState => ({ done: GOALS.map((g) => g.id), unlocks: [...ALL_UNLOCKS], families: 0, notebook: true, feast: false });

export const isUnlocked = (g: Pick<GoalsState, "unlocks">, key: string): boolean => g.unlocks.includes(key);

// The unlock key of a build-bar tool or template id, or null when it is available from the start.
export function unlockKeyOf(tool: string): string | null {
  if (tool === "craft" || tool === "trade") return `zone:${tool}`;
  return Object.hasOwn(UNLOCK_NAME, tool) && !tool.startsWith("zone:") && tool !== "upgrade" ? tool : null;
}
export const zoneKey = (z: ZoneType): string | null => (z === "res" ? null : `zone:${z}`);

// Russian reason a tool or template is closed, or null when it can be used.
export function lockReason(s: { goals: GoalsState }, tool: string): string | null {
  const key = unlockKeyOf(tool);
  if (!key || isUnlocked(s.goals, key)) return null;
  return `Откроется: ${UNLOCK_GOAL[key].title}`;
}

export const goalDone = (g: GoalsState, id: string): boolean => g.done.includes(id);

// The (up to three) goals in play: the first not yet done, in chain order.
export const activeGoals = (g: GoalsState): GoalDef[] => GOALS.filter((x) => !g.done.includes(x.id)).slice(0, ACTIVE_GOALS);

// A goal as the tracker shows it.
export interface GoalView {
  id: string;
  title: string;
  reward: string;
  value: number; // progress, capped at the target
  target: number;
  unit: string;
  hint: string | null; // what is missing while the goal cannot finish yet
}

export function goalViews(s: Slice & { goals: GoalsState }): GoalView[] {
  return activeGoals(s.goals).map((g) => ({
    id: g.id,
    title: g.title,
    reward: g.reward,
    value: Math.min(g.target, round1(g.value(s))),
    target: g.target,
    unit: g.unit,
    hint: g.gate && !g.gate(s) ? (g.gateHint ?? null) : null,
  }));
}

const met = (g: GoalDef, s: Slice): boolean => g.value(s) >= g.target && (!g.gate || g.gate(s));

const lowerNames = (keys: string[]): string => keys.map((k) => UNLOCK_NAME[k]).join(", ");

// ---------- paying a goal ----------

function complete(s: SimState, def: GoalDef, pos?: [number, number]): SimState {
  const at = s.gameMinutes;
  let goals: GoalsState = { ...s.goals, done: [...s.goals.done, def.id], unlocks: [...s.goals.unlocks, ...def.unlocks.filter((k) => !s.goals.unlocks.includes(k))] };
  let events = say(s.events, at, "goal", `Цель выполнена: ${def.title}`, pos);
  let households = s.households;
  const extra: string[] = [];
  if (def.unlocks.length > 0) {
    extra.push(`открыто: ${lowerNames(def.unlocks)}`);
    events = say(events, at, "unlock", `Открыто: ${lowerNames(def.unlocks)}`, pos);
  }
  if (def.families) {
    goals = { ...goals, families: goals.families + def.families };
    extra.push("приедет семья");
  }
  if (def.id === "dig") {
    goals = { ...goals, notebook: true };
    extra.push("в тетради ждёт первая статья");
    events = say(events, at, "unlock", "В тетради появилась первая статья: загляните в раздел «Статьи»", pos);
  }
  if (def.id === "harvest") {
    goals = { ...goals, feast: true }; // P7 turns this flag into the feast event
    households = Object.fromEntries(Object.entries(s.households).map(([k, h]) => [k, { ...h, mood: Math.min(100, h.mood + FEAST_MOOD) }]));
    extra.push("праздник урожая, настроение выше");
    events = say(events, at, "unlock", "Праздник урожая: люди повеселели", pos);
  }
  const text = `Цель выполнена: ${def.title}${extra.length ? ` (${extra.join("; ")})` : ""}`;
  return { ...s, goals, events, households, chronicle: addChronicle(s.chronicle, at, `goal:${def.id}`, text) };
}

// Families owed by the goals come when a house stands vacant and unpromised, like a call for settlers.
export function deliverFamilies(s: SimState): SimState {
  let cur = s;
  while (cur.goals.families > 0) {
    const promised = new Set(cur.incoming.map((f) => f.house));
    const house = vacantHouses(cur.buildings, cur.households).find((id) => !promised.has(id));
    if (house === undefined) break;
    const [r, rng] = nextRandom(cur.rng);
    const arrive = cur.gameMinutes + CALL.minMinutes + r * (CALL.maxMinutes - CALL.minMinutes);
    cur = { ...cur, rng, incoming: [...cur.incoming, { house, arrive }].sort((a, b) => a.arrive - b.arrive), goals: { ...cur.goals, families: cur.goals.families - 1 } };
  }
  return cur;
}

// Pays every active goal whose condition holds (and the goals that fill the freed slots), then delivers owed families.
export function checkGoals(s: SimState, pos?: [number, number]): SimState {
  let cur = s;
  for (let guard = 0; guard < GOALS.length; guard++) {
    const hit = activeGoals(cur.goals).find((g) => met(g, cur));
    if (!hit) break;
    cur = complete(cur, hit, pos);
  }
  return cur.goals.families > 0 ? deliverFamilies(cur) : cur;
}

// Daily, and in the tick a building finishes. `prev` is the state before the tick.
export function goalStep(prev: SimState, next: SimState): SimState {
  let pos: [number, number] | undefined;
  let built = false;
  if (next.buildings !== prev.buildings) {
    for (const b of Object.values(next.buildings)) {
      if (b.state === "active" && prev.buildings[b.id]?.state !== "active" && prev.buildings[b.id]) {
        built = true;
        pos ??= [b.lot.cx, b.lot.cy];
      }
    }
  }
  if (!built && dayOf(next.gameMinutes) === dayOf(prev.gameMinutes) && next.goals.families === 0) return next;
  return checkGoals(next, pos);
}

// ---------- old towns ----------

// Unlocks a town already proves by what stands in it (an old save has no goals): a placed template, a craft or trade
// building or painted zone, an izba of level 2.
export function provenUnlocks(s: Pick<SimState, "buildings" | "zones">): string[] {
  const out = new Set<string>();
  for (const b of Object.values(s.buildings)) {
    if (unlockKeyOf(b.template)) out.add(b.template);
    if (b.zone === "craft" || b.zone === "trade") out.add(`zone:${b.zone}`);
    if (b.level >= 2 || b.upgrade) out.add("upgrade");
  }
  for (const c of s.zones.cells) if (c.zone === "craft" || c.zone === "trade") out.add(`zone:${c.zone}`);
  return [...out].filter((k) => k in UNLOCK_NAME);
}

// Goals for a town loaded without any: what its buildings prove is unlocked, every goal already met is done, silently
// (no chronicle line, no family, no feast); a finished dig site counts as the opened notebook.
export function migrateGoals(s: Slice): GoalsState {
  const g = initialGoals();
  const unlocks = new Set(provenUnlocks(s));
  const done: string[] = [];
  for (const def of GOALS) {
    if (!met(def, s)) continue;
    done.push(def.id);
    for (const k of def.unlocks) unlocks.add(k);
  }
  return { ...g, done, unlocks: ALL_UNLOCKS.filter((k) => unlocks.has(k)), notebook: done.includes("dig") };
}

// A saved goals record, repaired; null when there is none (the caller migrates).
export function parseGoals(v: unknown): GoalsState | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.done) || !Array.isArray(r.unlocks)) return null;
  const done = GOALS.map((g) => g.id).filter((id) => (r.done as unknown[]).includes(id));
  const unlocks = ALL_UNLOCKS.filter((k) => (r.unlocks as unknown[]).includes(k));
  const families = Number.isInteger(r.families) && (r.families as number) > 0 ? Math.min(20, r.families as number) : 0;
  return { done, unlocks, families, notebook: r.notebook === true, feast: r.feast === true };
}

export const goalById = (id: string): GoalDef | undefined => GOAL_BY_ID.get(id);
