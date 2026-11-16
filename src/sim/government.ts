import { BUILDINGS, type JobGroup } from "./buildings";
import { nextRandom } from "./rng";
import { DAY_MIN, DAYS_PER_SEASON, YEAR_MIN } from "./time";
import type { Building, Resident, SimState } from "./types";
import { L } from "../i18n";

// The head of the town. A town hall (the rules' `seat`) opens the government: from then on the town has a head, or
// suffers for the want of one. The form decides who may become the head: a monarchy hands the post down to the head's
// grown children, a republic lets the player choose one of three residents for a term, and a head kept past the term
// costs the town. The head's character and background add bonuses and drawbacks of their own.

export type Form = "monarchy" | "republic";
export const FORMS: readonly Form[] = ["monarchy", "republic"];
export const TERMS = [2, 4, 8] as const; // seasons of a republican term
export type Term = (typeof TERMS)[number];

export interface Government {
  since: number; // gameMinutes the town hall first opened; the town's records start with it
  form: Form;
  settled: boolean; // the player has confirmed the form: until then no head can be chosen
  formSince: number; // gameMinutes the form was last set; it may change again five years later
  head: number | null; // resident id
  headSince: number;
  trade: JobGroup | null; // what the head worked at when chosen
  last: number | null; // the previous head: a monarchy without a head looks for the heirs among their children
  term: Term; // republic: seasons of a term
  termStart: number; // republic: gameMinutes the current term began
  terms: number; // republic: terms in a row of the current head (1 = the first)
  candidates: number[]; // residents offered for an open choice (republic, or a monarchy with no heir)
}

// What a head (or the want of one) does to the town. mood: points of the households' mood target; manage, attract,
// work: shares added to the residents the town can manage, to its attractiveness and to every work rate.
export interface Effect {
  mood: number;
  manage: number;
  attract: number;
  work: number;
}

export const NO_EFFECT: Effect = { mood: 0, manage: 0, attract: 0, work: 0 };

export const GOV = {
  noHead: { mood: -10, manage: -0.25, attract: -0.15, work: 0 } as Effect, // no head chosen
  extraTerm: { mood: -4, manage: -0.08, attract: -0.05, work: 0 } as Effect, // each term in a row past the first
  maxExtra: 3, // the extra-term penalty stops growing here
  termMood: { 2: 3, 4: 0, 8: -4 } as Record<Term, number>, // a short term pleases, a long one does not
  heirAge: 16, // a child may take the post at this age
  candidateAge: [20, 65] as const,
  candidates: 3,
  formCooldown: 5 * YEAR_MIN, // game minutes between changes of the form
  elderAge: 55,
};

// Characters: one per resident, fixed by their id. Some only help, some only hinder, most do both.
export type Trait = "wise" | "kind" | "generous" | "strict" | "ambitious" | "hospitable" | "stubborn" | "lazy" | "hotTempered" | "distrustful";

export const TRAITS: Record<Trait, { name: string; effect: Partial<Effect> }> = {
  wise: { name: L("Мудрый", "Wise"), effect: { manage: 0.15 } },
  kind: { name: L("Добродушный", "Good-natured"), effect: { mood: 5 } },
  generous: { name: L("Щедрый", "Generous"), effect: { mood: 4, work: -0.03 } },
  strict: { name: L("Строгий", "Strict"), effect: { work: 0.06, mood: -4 } },
  ambitious: { name: L("Честолюбивый", "Ambitious"), effect: { manage: 0.12, mood: -3 } },
  hospitable: { name: L("Гостеприимный", "Hospitable"), effect: { attract: 0.1, work: -0.03 } },
  stubborn: { name: L("Упрямый", "Stubborn"), effect: { work: 0.05, attract: -0.06 } },
  lazy: { name: L("Ленивый", "Lazy"), effect: { work: -0.06 } },
  hotTempered: { name: L("Вспыльчивый", "Hot-tempered"), effect: { mood: -5 } },
  distrustful: { name: L("Недоверчивый", "Distrustful"), effect: { attract: -0.1 } },
};
const TRAIT_IDS = Object.keys(TRAITS) as Trait[];

// What the head did before: the work they know best.
export const TRADE_EFFECT: Record<JobGroup, { name: string; effect: Partial<Effect> }> = {
  food: { name: L("Кормилец", "Provider"), effect: { attract: 0.05 } },
  materials: { name: L("Работник", "Labourer"), effect: { work: 0.04 } },
  crafts: { name: L("Мастер", "Craftsman"), effect: { work: 0.04 } },
  trade: { name: L("Торговец", "Trader"), effect: { attract: 0.05 } },
  services: { name: L("Служащий", "Public servant"), effect: { mood: 2 } },
};
export const LITERATE_EFFECT = { name: L("Грамотный", "Literate"), effect: { manage: 0.1 } as Partial<Effect> };
export const ELDER_EFFECT = { name: L("Опытный", "Experienced"), effect: { mood: 3 } as Partial<Effect> };

// A fixed character from the id (a 32-bit integer hash), the same in every save.
export function traitOf(id: number): Trait {
  let h = Math.imul(id ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return TRAIT_IDS[((h ^ (h >>> 13)) >>> 0) % TRAIT_IDS.length];
}

const ageOf = (r: Pick<Resident, "born">, now: number): number => (now - r.born) / YEAR_MIN;
const nameOf = (r: Pick<Resident, "first" | "last">): string => `${r.first} ${r.last}`;
export const termMinutes = (term: Term): number => term * DAYS_PER_SEASON * DAY_MIN;
export const isTerm = (v: unknown): v is Term => (TERMS as readonly unknown[]).includes(v);
export const isForm = (v: unknown): v is Form => (FORMS as readonly unknown[]).includes(v);

export function addEffect(a: Effect, b: Partial<Effect>, times = 1): Effect {
  return { mood: a.mood + (b.mood ?? 0) * times, manage: a.manage + (b.manage ?? 0) * times, attract: a.attract + (b.attract ?? 0) * times, work: a.work + (b.work ?? 0) * times };
}

// One part of a person's effect: a trait, the background, age.
export interface EffectPart {
  name: string;
  effect: Partial<Effect>;
}

// What a resident would bring as the head: the character, the work they know and literacy or age.
export function personParts(r: Pick<Resident, "id" | "born" | "literate" | "job">, now: number, buildings: Record<number, Building>, trade?: JobGroup | null): EffectPart[] {
  const t = TRAITS[traitOf(r.id)];
  const parts: EffectPart[] = [t];
  const group = trade !== undefined ? trade : r.job !== null ? (BUILDINGS[buildings[r.job]?.template ?? ""]?.group ?? null) : null;
  if (group) parts.push(TRADE_EFFECT[group]);
  if (r.literate) parts.push(LITERATE_EFFECT);
  if (ageOf(r, now) >= GOV.elderAge) parts.push(ELDER_EFFECT);
  return parts;
}

// The seat stands finished (cached per buildings object: they change together).
const seatCache = new WeakMap<object, boolean>();
export function seatActive(buildings: Record<number, Building>): boolean {
  let v = seatCache.get(buildings);
  if (v === undefined) {
    v = Object.values(buildings).some((b) => b.state === "active" && BUILDINGS[b.template]?.seat);
    seatCache.set(buildings, v);
  }
  return v;
}

// The head works at the seat as one of its clerks: their job is kept there by the hiring (people.ts jobsStep).
export function headClerk(s: Pick<SimState, "residents" | "buildings"> & { gov?: Government | null }): { id: number; seat: number } | null {
  const id = s.gov?.head;
  if (id == null || !s.residents[id]) return null;
  const seat = Object.values(s.buildings).find((b) => b.state === "active" && BUILDINGS[b.template]?.seat);
  return seat ? { id, seat: seat.id } : null;
}

type GovSource = Pick<SimState, "residents" | "buildings" | "gameMinutes"> & { gov?: Government | null };

// The parts of the town's whole effect now, each with its name (the head's, the term's, the penalties).
export function effectParts(s: GovSource): EffectPart[] {
  const g = s.gov;
  if (!g || !seatActive(s.buildings)) return [];
  const head = g.head !== null ? s.residents[g.head] : undefined;
  if (!head) return [{ name: L("Нет главы", "No head"), effect: GOV.noHead }];
  const parts = personParts(head, s.gameMinutes, s.buildings, g.trade);
  if (g.form === "republic") {
    if (GOV.termMood[g.term] !== 0) parts.push({ name: L(`Срок ${g.term} сез.`, `Term of ${g.term} seasons`), effect: { mood: GOV.termMood[g.term] } });
    const extra = Math.min(GOV.maxExtra, g.terms - 1);
    if (extra > 0) parts.push({ name: L(`Срок подряд: ${g.terms}-й`, `Term in a row: ${g.terms}`), effect: addEffect(NO_EFFECT, GOV.extraTerm, extra) });
  }
  return parts;
}

export const sumParts = (parts: readonly EffectPart[]): Effect => parts.reduce((a, p) => addEffect(a, p.effect), NO_EFFECT);

// The whole effect of the government on the town now.
export const govEffect = (s: GovSource): Effect => sumParts(effectParts(s));

// Multipliers the systems apply: the residents managed, the attractiveness, the work rates.
export const manageMul = (s: GovSource): number => Math.max(0.3, 1 + govEffect(s).manage);
export const attractMul = (s: GovSource): number => Math.max(0, 1 + govEffect(s).attract);
export const workMul = (s: GovSource): number => Math.max(0.5, 1 + govEffect(s).work);

const isAdult = (r: Resident, now: number, from: number, to = Infinity): boolean => {
  const a = ageOf(r, now);
  return a >= from && a < to;
};

// The grown children of a resident, oldest first.
export function heirsOf(residents: Record<number, Resident>, id: number | null, now: number): number[] {
  if (id === null) return [];
  return Object.values(residents)
    .filter((r) => (r.mother === id || r.father === id) && isAdult(r, now, GOV.heirAge))
    .sort((a, b) => a.born - b.born || a.id - b.id)
    .map((r) => r.id);
}

// Who the player may choose now, and how: the heirs of a monarch, an open choice of candidates, or no one.
export type ChoiceKind = "heir" | "open" | "none";

export function choices(s: Pick<SimState, "residents" | "gameMinutes"> & { gov?: Government | null }): { kind: ChoiceKind; ids: number[] } {
  const g = s.gov;
  if (!g || !g.settled) return { kind: "none", ids: [] };
  const live = (ids: number[]) => ids.filter((id) => s.residents[id]);
  const head = g.head !== null && s.residents[g.head] ? g.head : null;
  if (g.form === "monarchy") {
    const heirs = heirsOf(s.residents, head ?? g.last, s.gameMinutes);
    if (heirs.length > 0) return { kind: "heir", ids: heirs };
    return head === null ? { kind: "open", ids: live(g.candidates) } : { kind: "none", ids: [] };
  }
  if (head === null || g.terms > 1) return { kind: "open", ids: live(g.candidates) };
  return { kind: "none", ids: [] };
}

// Does the government need an open list of candidates now?
const needsCandidates = (s: Pick<SimState, "residents" | "gameMinutes"> & { gov: Government }): boolean => {
  const g = s.gov;
  if (!g.settled) return false;
  const head = g.head !== null && s.residents[g.head] ? g.head : null;
  if (g.form === "monarchy") return head === null && heirsOf(s.residents, g.last, s.gameMinutes).length === 0;
  return head === null || g.terms > 1;
};

// Keeps the candidates who are still here, adds new ones up to three; drops them when no choice is open.
function fillCandidates(s: SimState, g: Government): { gov: Government; rng: number } {
  if (!needsCandidates({ ...s, gov: g })) return { gov: g.candidates.length > 0 ? { ...g, candidates: [] } : g, rng: s.rng };
  const kept = g.candidates.filter((id) => s.residents[id] && id !== g.head);
  if (kept.length >= GOV.candidates) return { gov: kept.length === g.candidates.length ? g : { ...g, candidates: kept }, rng: s.rng };
  const pool = Object.values(s.residents)
    .filter((r) => r.id !== g.head && !kept.includes(r.id) && isAdult(r, s.gameMinutes, GOV.candidateAge[0], GOV.candidateAge[1]))
    .map((r) => r.id)
    .sort((a, b) => a - b);
  let rng = s.rng;
  const out = kept.slice();
  while (out.length < GOV.candidates && pool.length > 0) {
    const [v, n] = nextRandom(rng);
    rng = n;
    out.push(pool.splice(Math.floor(v * pool.length), 1)[0]);
  }
  return { gov: { ...g, candidates: out }, rng };
}

type Said = { kind: "head"; text: string };

// Opens the government once the seat stands; then, every midnight: a head who died or left is gone, a republican term
// that ran out starts again with the same head (a term in a row, which costs the town) and opens the choice, and the
// list of candidates is kept full. Returns the state and what to tell the player.
export function govStep(s: SimState): { sim: SimState; said: Said[] } {
  const said: Said[] = [];
  let g = s.gov;
  if (!g) {
    if (!seatActive(s.buildings)) return { sim: s, said };
    g = { since: s.gameMinutes, form: "monarchy", settled: false, formSince: s.gameMinutes - GOV.formCooldown, head: null, headSince: s.gameMinutes, trade: null, last: null, term: 4, termStart: s.gameMinutes, terms: 1, candidates: [] };
    said.push({ kind: "head", text: L("Ратуша открыта: выберите форму правления, затем главу поселения", "The town hall is open: choose the form of rule, then the head of the town") });
  }
  if (g.head !== null && !s.residents[g.head]) {
    g = { ...g, last: g.head, head: null, terms: 1 };
    said.push({ kind: "head", text: g.form === "monarchy" ? L("Поселение осталось без главы: выберите наследника", "The town has no head: choose an heir") : L("Поселение осталось без главы: выберите нового", "The town has no head: choose a new one") });
  }
  if (g.form === "republic" && g.head !== null && s.gameMinutes >= g.termStart + termMinutes(g.term)) {
    const head = s.residents[g.head];
    g = { ...g, terms: g.terms + 1, termStart: g.termStart + termMinutes(g.term) };
    said.push({ kind: "head", text: L(`Срок главы ${head ? nameOf(head) : ""} закончился: пока не выбран новый, глава остаётся на ${g.terms}-й срок, и жители недовольны`, `The term of ${head ? nameOf(head) : "the head"} is over: until a new head is chosen, they stay for term ${g.terms} and the residents are unhappy`) });
  }
  const f = fillCandidates(s, g);
  return f.gov === s.gov && f.rng === s.rng ? { sim: s, said } : { sim: { ...s, gov: f.gov, rng: f.rng }, said };
}

export type GovResult = { ok: true; sim: SimState; text: string } | { ok: false; reason: string };
const fail = (reason: string): GovResult => ({ ok: false, reason });

// The player chooses the head among those the form allows.
export function chooseHead(s: SimState, id: number): GovResult {
  const g = s.gov;
  if (!g || !seatActive(s.buildings)) return fail(L("Сначала постройте ратушу", "Build a town hall first"));
  if (!g.settled) return fail(L("Сначала выберите форму правления", "Choose the form of rule first"));
  if (!Number.isInteger(id) || !choices(s).ids.includes(id)) return fail(L("Этого жителя сейчас выбрать нельзя", "This resident cannot be chosen now"));
  const r = s.residents[id];
  const head = g.head !== null && s.residents[g.head] ? g.head : null;
  const trade = r.job !== null ? (BUILDINGS[s.buildings[r.job]?.template ?? ""]?.group ?? null) : null;
  const next: Government = { ...g, head: id, headSince: s.gameMinutes, trade, last: head ?? g.last, termStart: s.gameMinutes, terms: 1, candidates: [] };
  const verb = r.sex === "m" ? L("стал", "became") : L("стала", "became");
  const text = g.form === "monarchy" ? L(`Власть перешла к наследнику: главой поселения ${verb} ${nameOf(r)}`, `Power passed to the heir: ${nameOf(r)} ${verb} the head of the town`) : L(`Главой поселения ${verb} ${nameOf(r)}, срок ${g.term} сез.`, `${nameOf(r)} ${verb} the head of the town for ${g.term} seasons`);
  return { ok: true, sim: { ...s, gov: next }, text: g.form === "monarchy" && head === null && g.last === null ? L(`Основана династия: главой поселения ${verb} ${nameOf(r)}`, `A dynasty is founded: ${nameOf(r)} ${verb} the head of the town`) : text };
}

// The form of rule; the head stays and starts afresh. Once in five years at most (`force`: the developer panel's switch).
export function setForm(s: SimState, form: Form, force = false): GovResult {
  const g = s.gov;
  if (!g || !seatActive(s.buildings)) return fail(L("Сначала постройте ратушу", "Build a town hall first"));
  if (!isForm(form)) return fail(L("Неизвестная форма правления", "Unknown form of rule"));
  if (!g.settled) {
    // the first choice: free, and it opens the choice of the head
    const f = fillCandidates(s, { ...g, form, settled: true, formSince: s.gameMinutes, termStart: s.gameMinutes, terms: 1, candidates: [] });
    return { ok: true, sim: { ...s, gov: f.gov, rng: f.rng }, text: form === "monarchy" ? L("Поселение стало монархией: выберите, кто начнёт династию", "The town became a monarchy: choose who founds the dynasty") : L("Поселение стало республикой: выберите главу на срок", "The town became a republic: choose the head for a term") };
  }
  if (g.form === form) return { ok: true, sim: s, text: "" };
  if (!force && s.gameMinutes < g.formSince + GOV.formCooldown) return fail(L("Форму правления меняют не чаще раза в пять лет", "The form of rule changes at most once in five years"));
  const next: Government = { ...g, form, formSince: s.gameMinutes, termStart: s.gameMinutes, terms: 1, candidates: [] };
  const f = fillCandidates(s, next);
  return { ok: true, sim: { ...s, gov: f.gov, rng: f.rng }, text: form === "monarchy" ? L("Поселение стало монархией: власть передаётся детям главы", "The town became a monarchy: power passes to the head's children") : L("Поселение стало республикой: главу выбирают на срок", "The town became a republic: the head is chosen for a term") };
}

// The length of a republican term; the current term is measured anew by it.
export function setTerm(s: SimState, term: Term): GovResult {
  const g = s.gov;
  if (!g || !seatActive(s.buildings)) return fail(L("Сначала постройте ратушу", "Build a town hall first"));
  if (!isTerm(term)) return fail(L("Некорректный срок", "Invalid term"));
  if (g.term === term) return { ok: true, sim: s, text: "" };
  return { ok: true, sim: { ...s, gov: { ...g, term } }, text: L(`Срок главы: ${term} сез.`, `The head's term: ${term} seasons`) };
}

// ---------- the town's records ----------

// One midnight of the town: residents, mood and the main stocks. Kept from the town hall's first year to the end.
export interface HistoryRow {
  day: number; // day index since the founding
  pop: number;
  mood: number; // 0..100, the households' average
  food: number; // kg
  logs: number; // m3
  planks: number; // m3
  stone: number; // t
  goods: number; // pieces of clothing, dishes and furniture
  tools: number; // pieces
}

export const HISTORY_KEYS = ["pop", "mood", "food", "logs", "planks", "stone", "goods", "tools"] as const;
export type HistoryKey = (typeof HISTORY_KEYS)[number];

const round1 = (v: number): number => Math.round(v * 10) / 10;

// The row of the day just begun, added once the government is open.
export function recordDay(s: SimState, day: number): SimState {
  if (!s.gov) return s;
  const last = s.history[s.history.length - 1];
  if (last && last.day >= day) return s;
  const hs = Object.values(s.households);
  const st = s.stock;
  const row: HistoryRow = {
    day,
    pop: Object.keys(s.residents).length,
    mood: round1(hs.length > 0 ? hs.reduce((a, h) => a + h.mood, 0) / hs.length : 0),
    food: Math.round(st.food),
    logs: round1(st.logs),
    planks: round1(st.planks),
    stone: round1(st.stone),
    goods: Math.round(st.clothes + st.dishes + st.furniture),
    tools: Math.round(st.tools),
  };
  return { ...s, history: [...s.history, row] };
}

// ---------- the view ----------

export interface PersonView {
  id: number;
  name: string;
  sex: "m" | "f";
  age: number;
  parts: EffectPart[];
  effect: Effect;
}

export interface GovView {
  form: Form;
  settled: boolean;
  formReady: number; // gameMinutes from which the form may change
  term: Term;
  termEnd: number; // republic: gameMinutes the current term ends
  terms: number;
  head: PersonView | null;
  choice: { kind: ChoiceKind; people: PersonView[] };
  parts: EffectPart[]; // the town's whole effect, part by part
  effect: Effect;
}

export function govView(s: SimState): GovView | null {
  const g = s.gov;
  if (!g) return null;
  const person = (id: number, trade?: JobGroup | null): PersonView | null => {
    const r = s.residents[id];
    if (!r) return null;
    const parts = personParts(r, s.gameMinutes, s.buildings, trade);
    return { id, name: nameOf(r), sex: r.sex, age: Math.floor(ageOf(r, s.gameMinutes)), parts, effect: sumParts(parts) };
  };
  const c = choices(s);
  const parts = effectParts(s);
  return {
    form: g.form,
    settled: g.settled,
    formReady: g.formSince + GOV.formCooldown,
    term: g.term,
    termEnd: g.termStart + termMinutes(g.term),
    terms: g.terms,
    head: g.head !== null ? person(g.head, g.trade) : null,
    choice: { kind: c.kind, people: c.ids.map((id) => person(id)).filter((p): p is PersonView => p !== null) },
    parts,
    effect: sumParts(parts),
  };
}

// For the save: a government as it was written, or null.
export function parseGov(v: unknown): Government | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  const id = (x: unknown): number | null => (Number.isInteger(x) && (x as number) > 0 ? (x as number) : null);
  if (!num(o.since) || !isForm(o.form) || !num(o.formSince) || !num(o.headSince) || !num(o.termStart)) return null;
  const groups = Object.keys(TRADE_EFFECT);
  return {
    since: o.since,
    form: o.form,
    settled: typeof o.settled === "boolean" ? o.settled : id(o.head) !== null || id(o.last) !== null, // saves from before the flag: chosen once a head was
    formSince: o.formSince,
    head: id(o.head),
    headSince: o.headSince,
    trade: typeof o.trade === "string" && groups.includes(o.trade) ? (o.trade as JobGroup) : null,
    last: id(o.last),
    term: isTerm(o.term) ? o.term : 4,
    termStart: o.termStart,
    terms: Number.isInteger(o.terms) && (o.terms as number) >= 1 ? (o.terms as number) : 1,
    candidates: Array.isArray(o.candidates) ? o.candidates.filter((x): x is number => id(x) !== null).slice(0, GOV.candidates) : [],
  };
}

export function parseHistory(v: unknown): HistoryRow[] {
  if (!Array.isArray(v)) return [];
  const out: HistoryRow[] = [];
  for (const r of v) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (!Number.isInteger(o.day) || (out.length > 0 && (o.day as number) <= out[out.length - 1].day)) continue;
    const row = { day: o.day as number } as HistoryRow;
    let ok = true;
    for (const k of HISTORY_KEYS) {
      const x = o[k];
      if (typeof x !== "number" || !Number.isFinite(x) || x < 0) ok = false;
      else row[k] = x;
    }
    if (ok) out.push(row);
  }
  return out;
}
