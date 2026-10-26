import type { DomainId } from "./domains";
import type { ProgressState, RoadKind, SimState } from "./types";

// The technology tree and the eras (PLAN-research.ru.md sections 4-6, 9). Static: none of it is saved, only
// `SimState.progress` (the ids of what is researched). sim/research.ts holds the rules that move it.

// What a technology changes besides its unlock keys. Fractions are added up over the researched techs: 0.1 = +10 %.
export interface TechModifiers {
  fieldYield?: number; // yield of the fields
  workshopOutput?: number; // output of the workshops (craft zone)
  buildSpeed?: number; // construction progress
  bridgeSpan?: Partial<Record<RoadKind, number>>; // metres added to the span limit of a bridge kind (roads.ts effectiveSpans)
}

export interface TechDef {
  id: string;
  era: 1 | 2; // needs this era to start
  domain: DomainId;
  name: string;
  days: number; // base research time, game days
  requires: string[];
  unlocks: string[]; // unlock keys: template ids, "zone:craft", "zone:trade", "upgrade", "road:stone"...
  modifiers?: TechModifiers;
  description: string;
}

// An idea found in an old building (stage H2 grants them): it cuts the time of its tech by `cut`, or, with no tech,
// adds `speed` to the research speed of every domain. Insights of one tech do not stack: the best one counts.
export interface InsightDef {
  id: string;
  domain: DomainId;
  tech: string | null;
  cut: number; // share of the research time
  speed?: number;
  text: string;
}

export const ERAS: { id: number; name: string }[] = [
  { id: 1, name: "Поселение" },
  { id: 2, name: "Деревня" },
];
export const eraName = (era: number): string => ERAS.find((e) => e.id === era)?.name ?? "";
export const MAX_ERA = ERAS.length;

// Era II opens at this many residents and researched era I techs.
export const ERA_TWO = { pop: 100, techs: 12 };

export const MAX_QUEUE = 3;

// Chain order of the tree = the order of the plan table.
export const TECHS: TechDef[] = [
  // ----- era I «Поселение» -----
  { id: "carpentry", era: 1, domain: "build", name: "Плотницкое дело", days: 3, requires: [], unlocks: ["sawpit"], description: "Пилить брёвна на доски: лесопилка." },
  { id: "storage", era: 1, domain: "farm", name: "Хранение запасов", days: 3, requires: [], unlocks: ["barn"], description: "Склады для зерна и припасов." },
  { id: "foraging", era: 1, domain: "farm", name: "Лесной промысел", days: 3, requires: [], unlocks: ["hunter", "forager"], description: "Охота и сбор в лесу." },
  { id: "stonework", era: 1, domain: "build", name: "Работа с камнем", days: 9, requires: ["carpentry"], unlocks: ["quarry"], description: "Добыча и обработка камня: карьер." },
  { id: "crafts", era: 1, domain: "craft", name: "Ремёсла", days: 9, requires: ["carpentry"], unlocks: ["zone:craft"], description: "Мастерские: ремесленная зона." },
  { id: "fishing", era: 1, domain: "farm", name: "Рыболовство", days: 9, requires: [], unlocks: ["fisher"], description: "Лов рыбы: рыболовный причал." },
  { id: "gardening", era: 1, domain: "farm", name: "Огородничество", days: 9, requires: ["storage"], unlocks: ["garden"], description: "Грядки у дома: огород." },
  { id: "trade", era: 1, domain: "trade", name: "Торговля", days: 15, requires: ["crafts"], unlocks: ["zone:trade", "market"], description: "Обмен с соседями: торговая зона и рынок." },
  { id: "orchards", era: 1, domain: "farm", name: "Садоводство", days: 15, requires: ["gardening"], unlocks: ["orchard"], description: "Плодовые деревья: сад." },
  { id: "faith", era: 1, domain: "care", name: "Общие обряды", days: 15, requires: ["stonework"], unlocks: ["chapel"], description: "Место для общих собраний и обрядов: храм." },
  { id: "threefield", era: 1, domain: "farm", name: "Трёхполье", days: 15, requires: ["gardening"], unlocks: [], modifiers: { fieldYield: 0.1 }, description: "Севооборот: урожай полей выше на 10 %." },
  { id: "healing", era: 1, domain: "care", name: "Врачевание", days: 21, requires: ["faith"], unlocks: ["healer"], description: "Уход за больными: лечебница." },
  { id: "housing", era: 1, domain: "build", name: "Просторное жильё", days: 21, requires: ["crafts", "stonework"], unlocks: ["upgrade"], description: "Дома можно расширять." },
  { id: "guildwork", era: 1, domain: "craft", name: "Цеховое дело", days: 21, requires: ["crafts", "trade"], unlocks: [], modifiers: { workshopOutput: 0.1 }, description: "Мастера делятся приёмами: выработка мастерских выше на 10 %." },
  { id: "joinery", era: 1, domain: "build", name: "Столярное дело", days: 21, requires: ["housing"], unlocks: [], modifiers: { buildSpeed: 0.1, bridgeSpan: { bridge: 15 } }, description: "Стройка быстрее на 10 %, свайный мост перекрывает на 15 м больше." },
  // ----- era II «Деревня» -----
  { id: "paving", era: 2, domain: "build", name: "Мощение", days: 24, requires: ["stonework"], unlocks: ["road:stone"], description: "Каменная дорога: берёт уклон круче грунтовой." },
  { id: "stonebridge", era: 2, domain: "build", name: "Каменные мосты", days: 30, requires: ["paving"], unlocks: ["road:stonebridge"], description: "Каменный мост через воду." },
  { id: "trusses", era: 2, domain: "build", name: "Стропильные фермы", days: 30, requires: ["stonebridge", "joinery"], unlocks: [], modifiers: { bridgeSpan: { bridge: 15, stonebridge: 40 } }, description: "Мосты перекрывают больший пролёт: свайный +15 м, каменный +40 м." },
  { id: "cellars", era: 2, domain: "farm", name: "Погреба", days: 18, requires: ["storage"], unlocks: ["cellar"], description: "Запасы хранятся дольше: погреб." },
  { id: "beekeeping", era: 2, domain: "farm", name: "Пчеловодство", days: 18, requires: ["orchards"], unlocks: ["apiary"], description: "Мёд и воск: пасека." },
  { id: "letters", era: 2, domain: "learn", name: "Грамота", days: 24, requires: ["faith"], unlocks: ["school"], description: "Учить детей чтению и счёту: школа." },
];

export const INSIGHTS: InsightDef[] = [
  { id: "carpenter-corner", domain: "build", tech: "carpentry", cut: 0.4, text: "Плотницкий угол" },
  { id: "masonry", domain: "build", tech: "stonework", cut: 0.3, text: "Каменная кладка" },
  { id: "dry-barn", domain: "farm", tech: "storage", cut: 0.4, text: "Сухой амбар" },
  { id: "grafting", domain: "farm", tech: "orchards", cut: 0.3, text: "Привой" },
  { id: "one-roof", domain: "craft", tech: "crafts", cut: 0.3, text: "Мастерская под одной крышей" },
  { id: "firing", domain: "craft", tech: "guildwork", cut: 0.3, text: "Обжиг" },
  { id: "fair-row", domain: "trade", tech: "trade", cut: 0.3, text: "Ярмарочный ряд" },
  { id: "ledger", domain: "trade", tech: "guildwork", cut: 0.3, text: "Счётная книга" },
  { id: "primer", domain: "learn", tech: "letters", cut: 0.4, text: "Азбука" },
  { id: "bookmaking", domain: "learn", tech: null, cut: 0, speed: 0.1, text: "Книжное дело" },
  { id: "vault", domain: "care", tech: "faith", cut: 0.3, text: "Свод" },
  { id: "herbal", domain: "care", tech: "healing", cut: 0.3, text: "Травник" },
];

export const TECH_BY_ID = new Map(TECHS.map((t) => [t.id, t]));
export const INSIGHT_BY_ID = new Map(INSIGHTS.map((i) => [i.id, i]));
export const techOf = (id: string): TechDef | undefined => TECH_BY_ID.get(id);

// What each unlock key is called in the reward lines.
export const UNLOCK_NAME: Record<string, string> = {
  sawpit: "лесопилка",
  barn: "склад",
  quarry: "карьер",
  fisher: "рыболовный причал",
  garden: "огород",
  hunter: "охотничий пост",
  cellar: "погреб",
  forager: "сбор в лесу",
  orchard: "сад",
  apiary: "пасека",
  market: "рынок",
  chapel: "храм",
  school: "школа",
  healer: "лечебница",
  "zone:craft": "ремесленная зона",
  "zone:trade": "торговая зона",
  upgrade: "расширение домов",
  "road:stone": "каменная дорога",
  "road:stonebridge": "каменный мост",
};
export const ALL_UNLOCKS = Object.keys(UNLOCK_NAME);

// The technology that opens each unlock key.
export const UNLOCK_TECH: Record<string, TechDef> = {};
for (const t of TECHS) for (const k of t.unlocks) UNLOCK_TECH[k] = t;

export const unlockNames = (keys: string[]): string => keys.map((k) => UNLOCK_NAME[k] ?? k).join(", ");

// ---------- the graph ----------

// Problems of a tech list (empty when it is a sound tree): duplicate ids, unknown prerequisites, an era below a
// prerequisite's, a cycle, an unlock key opened twice.
export function validateTechs(techs: readonly TechDef[] = TECHS): string[] {
  const out: string[] = [];
  const byId = new Map<string, TechDef>();
  for (const t of techs) {
    if (byId.has(t.id)) out.push(`duplicate id ${t.id}`);
    byId.set(t.id, t);
  }
  const keys = new Map<string, string>();
  for (const t of techs) {
    for (const r of t.requires) {
      const p = byId.get(r);
      if (!p) out.push(`${t.id}: unknown prerequisite ${r}`);
      else if (p.era > t.era) out.push(`${t.id}: era ${t.era} below the era of ${r}`);
    }
    for (const k of t.unlocks) {
      const other = keys.get(k);
      if (other) out.push(`unlock ${k} opened by ${other} and ${t.id}`);
      keys.set(k, t.id);
    }
  }
  const state = new Map<string, 1 | 2>(); // 1 on the path, 2 done
  const visit = (id: string): boolean => {
    const st = state.get(id);
    if (st === 2) return false;
    if (st === 1) return true;
    state.set(id, 1);
    const cyc = (byId.get(id)?.requires ?? []).some((r) => byId.has(r) && visit(r));
    state.set(id, 2);
    return cyc;
  };
  for (const t of techs) if (visit(t.id)) out.push(`cycle through ${t.id}`);
  return out;
}

// Every prerequisite of the techs, themselves included.
export function withPrerequisites(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const add = (id: string) => {
    const t = TECH_BY_ID.get(id);
    if (!t || out.has(id)) return;
    out.add(id);
    t.requires.forEach(add);
  };
  for (const id of ids) add(id);
  return out;
}

// ---------- progress ----------

export const initialProgress = (): ProgressState => ({ era: 1, techs: [], research: { active: null, queue: [] }, insights: [], restored: {} });
// Every tech researched, the last era: for plain sim states in tests and tools that do not play the tree.
export const allResearched = (): ProgressState => ({ ...initialProgress(), era: MAX_ERA, techs: TECHS.map((t) => t.id) });

// Every unlock open but no modifier researched: plain sim states in tests whose numbers assume the base economy.
export const allUnlocked = (): ProgressState => ({ ...allResearched(), techs: TECHS.filter((t) => t.unlocks.length > 0).map((t) => t.id) });

export const hasTech = (p: Pick<ProgressState, "techs">, id: string): boolean => p.techs.includes(id);

// The researched tech opens the key.
export const isUnlocked = (p: Pick<ProgressState, "techs">, key: string): boolean => {
  const t = UNLOCK_TECH[key];
  return !!t && p.techs.includes(t.id);
};

// The unlock key of a build-bar tool or template id, or null when it is available from the start.
export function unlockKeyOf(tool: string): string | null {
  if (tool === "craft" || tool === "trade") return `zone:${tool}`;
  if (tool === "stone" || tool === "stonebridge") return `road:${tool}`;
  return Object.hasOwn(UNLOCK_NAME, tool) && !tool.startsWith("zone:") && !tool.startsWith("road:") && tool !== "upgrade" ? tool : null;
}
export const zoneKey = (z: string): string | null => (z === "res" ? null : `zone:${z}`);

// Russian reason a tool or template is closed, or null when it can be used.
export function lockReason(s: { progress: Pick<ProgressState, "techs" | "era"> }, tool: string): string | null {
  const key = unlockKeyOf(tool);
  if (!key || isUnlocked(s.progress, key)) return null;
  const t = UNLOCK_TECH[key];
  return t.era > s.progress.era ? `Эпоха ${t.era === 2 ? "II" : t.era}` : `Технология: ${t.name}`;
}

// ---------- modifiers ----------

type Techs = Pick<ProgressState, "techs"> | undefined;
const sumMod = (p: Techs, f: (m: TechModifiers) => number | undefined): number => {
  let n = 0;
  for (const id of p?.techs ?? []) n += f(TECH_BY_ID.get(id)?.modifiers ?? {}) ?? 0;
  return n;
};
export const fieldYieldMul = (p: Techs): number => 1 + sumMod(p, (m) => m.fieldYield);
export const workshopMul = (p: Techs): number => 1 + sumMod(p, (m) => m.workshopOutput);
export const buildSpeedMul = (p: Techs): number => 1 + sumMod(p, (m) => m.buildSpeed);
// Metres the researched techs add to the span limit of a bridge kind.
export const bridgeSpanBonus = (p: Techs, kind: RoadKind): number => sumMod(p, (m) => m.bridgeSpan?.[kind]);

// Yield potential of the fields: the weather's crop times the techs' yield.
export const cropOf = (s: { weather?: { crop: number }; progress?: Techs }): number => (s.weather?.crop ?? 1) * fieldYieldMul(s.progress);

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

// What each goal of the old chain paid, for saves written before the research (the goals themselves are gone).
const LEGACY_GOAL_UNLOCKS: Record<string, string[]> = {
  izbas2: ["sawpit", "barn", "cellar", "hunter", "forager"],
  logs20: ["quarry", "zone:craft"],
  sow2: ["fisher", "garden"],
  pop25: ["zone:trade", "market", "apiary"],
  harvest: ["chapel", "orchard"],
  pop50: ["school", "healer"],
  craft5: ["upgrade"],
};

// Unlock keys an old save's `goals` record had paid (its unlock list plus what its done goals pay); empty without one.
export function paidUnlocks(goals: unknown): string[] {
  if (typeof goals !== "object" || goals === null) return [];
  const g = goals as Record<string, unknown>;
  const out = new Set<string>();
  if (Array.isArray(g.unlocks)) for (const k of g.unlocks) if (typeof k === "string") out.add(k);
  if (Array.isArray(g.done)) for (const id of g.done) if (typeof id === "string") for (const k of LEGACY_GOAL_UNLOCKS[id] ?? []) out.add(k);
  return [...out].filter((k) => k in UNLOCK_NAME);
}

export const eraTwoMet = (s: { residents: Record<number, unknown>; progress: Pick<ProgressState, "techs"> }): boolean =>
  Object.keys(s.residents).length >= ERA_TWO.pop && s.progress.techs.filter((id) => TECH_BY_ID.get(id)?.era === 1).length >= ERA_TWO.techs;

// Progress for a town loaded without any: the techs whose unlocks are all paid or proven by the buildings, and any tech
// one of whose unlocks stands built (so nothing built is ever closed), with every prerequisite; the era by its
// condition. Silent: no chronicle line, no toast.
export function migrateProgress(s: Pick<SimState, "buildings" | "zones" | "residents">, goals?: unknown): ProgressState {
  const proven = new Set(provenUnlocks(s));
  const known = new Set([...proven, ...paidUnlocks(goals)]);
  const hit = TECHS.filter((t) => t.unlocks.length > 0 && (t.unlocks.every((k) => known.has(k)) || t.unlocks.some((k) => proven.has(k)))).map((t) => t.id);
  const all = withPrerequisites(hit);
  const techs = TECHS.filter((t) => all.has(t.id)).map((t) => t.id);
  const p: ProgressState = { ...initialProgress(), techs };
  return eraTwoMet({ residents: s.residents, progress: p }) ? { ...p, era: 2 } : p;
}
