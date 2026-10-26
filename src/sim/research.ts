import { addChronicle } from "./chronicle";
import { DOMAIN_IDS, isDomain, type DomainId } from "./domains";
import { countResidents } from "./people";
import { say } from "./production";
import { DAY_MIN } from "./time";
import { eraName, eraTwoMet, INSIGHT_BY_ID, initialProgress, MAX_ERA, MAX_QUEUE, TECH_BY_ID, TECHS, unlockNames, type TechDef } from "./tech";
import type { ProgressState, ResearchView, SimState } from "./types";

// Research (PLAN-research.ru.md section 5): one tech under way and a queue of up to three. Progress is the work done in
// game days, so a speed that changes midway (a school, a restored building) and a long offline catch-up need no special
// handling: every tick adds `speed * dt`.

export const SPEED = { literacy: 0.5, restored: 0.05, restoredCap: 10, max: 2 };

export type ResearchResult = { ok: true; sim: SimState } | { ok: false; reason: string };

const withProgress = (s: SimState, progress: ProgressState): SimState => ({ ...s, progress });
const withResearch = (s: SimState, research: ProgressState["research"]): SimState => withProgress(s, { ...s.progress, research });

// Research speed of a domain: the literate share of the adults, the restored buildings and the "speed" insights; 1..2.
export function researchSpeed(s: Pick<SimState, "progress" | "residents" | "gameMinutes">, domain: DomainId): number {
  const c = countResidents(s.residents, s.gameMinutes);
  const literate = c.adults > 0 ? c.literate / c.adults : 0;
  const idea = s.progress.insights.reduce((m, id) => m + (INSIGHT_BY_ID.get(id)?.speed ?? 0), 0);
  const v = 1 + SPEED.literacy * literate + SPEED.restored * Math.min(SPEED.restoredCap, s.progress.restored[domain] ?? 0) + idea;
  return Math.min(SPEED.max, v);
}

// Game days of work a tech needs, after the best insight held for it.
export function workDays(p: Pick<ProgressState, "insights">, t: TechDef): number {
  let cut = 0;
  for (const id of p.insights) {
    const i = INSIGHT_BY_ID.get(id);
    if (i && i.tech === t.id) cut = Math.max(cut, i.cut);
  }
  return t.days * (1 - cut);
}

// Russian reason the tech cannot be started now, or null.
export function startBlocker(p: ProgressState, t: TechDef): string | null {
  if (p.techs.includes(t.id)) return "Уже изучено";
  if (t.era > p.era) return `Нужна эпоха ${t.era === 2 ? "II" : t.era}`;
  const need = t.requires.find((r) => !p.techs.includes(r));
  if (need) return `Сначала: ${TECH_BY_ID.get(need)?.name ?? need}`;
  return null;
}

const begin = (s: SimState, techId: string): SimState => withResearch(s, { active: { techId, done: 0 }, queue: s.progress.research.queue.filter((q) => q !== techId) });

// The first queued tech that can start does; entries already researched or unknown are dropped on the way.
function startNext(s: SimState): SimState {
  const p = s.progress;
  const queue = p.research.queue.filter((id) => {
    const t = TECH_BY_ID.get(id);
    return t && !p.techs.includes(id);
  });
  const next = queue.find((id) => startBlocker(p, TECH_BY_ID.get(id)!) === null);
  if (next === undefined) return queue.length === p.research.queue.length ? s : withResearch(s, { ...p.research, queue });
  return begin(withResearch(s, { ...p.research, queue }), next);
}

export function startResearch(s: SimState, techId: unknown): ResearchResult {
  const t = typeof techId === "string" ? TECH_BY_ID.get(techId) : undefined;
  if (!t) return { ok: false, reason: "Неизвестная технология" };
  const why = startBlocker(s.progress, t);
  if (why) return { ok: false, reason: why };
  if (s.progress.research.active) return { ok: false, reason: "Идёт другое исследование: поставьте это в очередь или отмените текущее" };
  return { ok: true, sim: begin(s, t.id) };
}

// Queues a tech (starts it at once when nothing is under way and it can start). A tech may wait behind its own prerequisite.
export function queueResearch(s: SimState, techId: unknown): ResearchResult {
  const t = typeof techId === "string" ? TECH_BY_ID.get(techId) : undefined;
  if (!t) return { ok: false, reason: "Неизвестная технология" };
  const p = s.progress;
  if (p.techs.includes(t.id)) return { ok: false, reason: "Уже изучено" };
  if (t.era > p.era) return { ok: false, reason: `Нужна эпоха ${t.era === 2 ? "II" : t.era}` };
  if (p.research.active?.techId === t.id) return { ok: false, reason: "Уже исследуется" };
  if (p.research.queue.includes(t.id)) return { ok: false, reason: "Уже в очереди" };
  if (!p.research.active && startBlocker(p, t) === null) return { ok: true, sim: begin(s, t.id) };
  if (p.research.queue.length >= MAX_QUEUE) return { ok: false, reason: `В очереди не больше ${MAX_QUEUE}` };
  return { ok: true, sim: withResearch(s, { ...p.research, queue: [...p.research.queue, t.id] }) };
}

// Cancels the active research (its progress is lost; the next in the queue starts) or removes a tech from the queue.
export function cancelResearch(s: SimState, techId: unknown): ResearchResult {
  const r = s.progress.research;
  if (r.active && r.active.techId === techId) return { ok: true, sim: startNext(withResearch(s, { ...r, active: null })) };
  if (typeof techId === "string" && r.queue.includes(techId)) return { ok: true, sim: withResearch(s, { ...r, queue: r.queue.filter((q) => q !== techId) }) };
  return { ok: false, reason: "Это исследование уже не идёт" };
}

function finish(s: SimState, t: TechDef): SimState {
  const p = s.progress;
  const text = `Изучено: ${t.name}${t.unlocks.length ? ` (открыто: ${unlockNames(t.unlocks)})` : ""}`;
  const progress: ProgressState = {
    ...p,
    techs: [...p.techs, t.id],
    research: { ...p.research, active: null },
    insights: p.insights.filter((id) => INSIGHT_BY_ID.get(id)?.tech !== t.id), // used up
  };
  const done: SimState = { ...s, progress, events: say(s.events, s.gameMinutes, "tech", text), chronicle: addChronicle(s.chronicle, s.gameMinutes, `tech:${t.id}`, text) };
  return startNext(done);
}

// One tick of `dt` game minutes. With nothing under way a waiting queue gets its start.
export function researchStep(s: SimState, dt: number): SimState {
  const a = s.progress.research.active;
  if (!a) return s.progress.research.queue.length > 0 ? startNext(s) : s;
  const t = TECH_BY_ID.get(a.techId);
  if (!t || s.progress.techs.includes(t.id)) return startNext(withResearch(s, { ...s.progress.research, active: null }));
  const done = a.done + (researchSpeed(s, t.domain) * dt) / DAY_MIN;
  if (done >= workDays(s.progress, t)) return finish(s, t);
  return withResearch(s, { ...s.progress.research, active: { techId: t.id, done } });
}

function enterEra(s: SimState, era: number): SimState {
  const text = `Новая эпоха: ${eraName(era)}`;
  return { ...withProgress(s, { ...s.progress, era }), events: say(s.events, s.gameMinutes, "era", text), chronicle: addChronicle(s.chronicle, s.gameMinutes, `era:${era}`, text) };
}

// Daily: era II opens once, when its conditions hold.
export function eraStep(s: SimState): SimState {
  return s.progress.era < MAX_ERA && eraTwoMet(s) ? enterEra(s, s.progress.era + 1) : s;
}

// Admin: the next era at once.
export const nextEra = (s: SimState): SimState => (s.progress.era < MAX_ERA ? enterEra(s, s.progress.era + 1) : s);

// Admin: every tech researched, the research under way dropped.
export const researchAll = (s: SimState): SimState => {
  const have = new Set(s.progress.techs);
  return withProgress(s, { ...s.progress, era: MAX_ERA, techs: [...s.progress.techs, ...TECHS.filter((t) => !have.has(t.id)).map((t) => t.id)], research: { active: null, queue: [] }, insights: [] });
};

// An insight of an old building (stage H2 grants them). Its tech researched already, it burns with a message; one held
// already is not given twice.
export function grantInsight(s: SimState, id: string): SimState {
  const i = INSIGHT_BY_ID.get(id);
  const p = s.progress;
  if (!i || p.insights.includes(id)) return s;
  if (i.tech && p.techs.includes(i.tech)) return { ...s, events: say(s.events, s.gameMinutes, "tech", `Идея «${i.text}» уже известна`) };
  return withProgress(s, { ...p, insights: [...p.insights, id] });
}

// ---------- the main thread's view ----------

export function researchView(s: SimState): ResearchView {
  const p = s.progress;
  const speeds = Object.fromEntries(DOMAIN_IDS.map((d) => [d, researchSpeed(s, d)])) as Record<DomainId, number>;
  let active: ResearchView["active"] = null;
  const a = p.research.active;
  const t = a && TECH_BY_ID.get(a.techId);
  if (a && t) {
    const need = workDays(p, t);
    const left = Math.max(0, need - a.done);
    active = { techId: t.id, share: Math.min(1, a.done / need), etaMinutes: (left / speeds[t.domain]) * DAY_MIN };
  }
  return { active, queue: p.research.queue, speeds, era: p.era, eraTwoMet: eraTwoMet(s) };
}

// ---------- saves ----------

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// A saved progress record, repaired entry by entry; null when there is none (the caller migrates).
export function parseProgress(v: unknown): ProgressState | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const out = initialProgress();
  const list = (x: unknown): string[] => (Array.isArray(x) ? x.filter((e): e is string => typeof e === "string") : []);
  out.techs = [...new Set(list(r.techs))].filter((id) => TECH_BY_ID.has(id));
  out.insights = [...new Set(list(r.insights))].filter((id) => INSIGHT_BY_ID.has(id));
  out.era = Number.isInteger(r.era) ? Math.min(MAX_ERA, Math.max(1, r.era as number)) : 1;
  const res = typeof r.research === "object" && r.research !== null && !Array.isArray(r.research) ? (r.research as Record<string, unknown>) : {};
  const a = res.active;
  if (typeof a === "object" && a !== null) {
    const { techId, done } = a as Record<string, unknown>;
    if (typeof techId === "string" && TECH_BY_ID.has(techId) && !out.techs.includes(techId) && isNum(done) && done >= 0) out.research.active = { techId, done };
  }
  out.research.queue = [...new Set(list(res.queue))].filter((id) => TECH_BY_ID.has(id) && !out.techs.includes(id) && id !== out.research.active?.techId).slice(0, MAX_QUEUE);
  if (typeof r.restored === "object" && r.restored !== null && !Array.isArray(r.restored)) {
    for (const [k, n] of Object.entries(r.restored)) if (isDomain(k) && isNum(n) && n > 0) out.restored[k] = Math.min(1000, n);
  }
  return out;
}
