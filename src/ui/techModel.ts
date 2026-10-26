import { DOMAINS, domainName, type DomainId } from "../sim/domains";
import { ERA_TWO, ERAS, eraName, INSIGHTS, MAX_QUEUE, TECH_BY_ID, TECHS, UNLOCK_NAME, type TechDef, type TechModifiers } from "../sim/tech";
import type { ProgressState, ResearchView, RoadKind } from "../sim/types";

// Pure view model of the tech panel: node states, times, what a tech opens, the era II conditions, the queue.

export type NodeState = "done" | "active" | "queued" | "available" | "locked";

export const STATE_LABEL: Record<NodeState, string> = {
  done: "Изучено",
  active: "Исследуется",
  queued: "В очереди",
  available: "Доступно",
  locked: "Закрыто",
};

export interface TechInput {
  progress: ProgressState;
  research: ResearchView;
  pop: number; // residents
}

export interface TechNode {
  id: string;
  name: string;
  era: number;
  domain: DomainId;
  state: NodeState;
  statusText: string; // the state as one line of text: «Исследуется, 40 %», «Закрыто: нужна технология Ремёсла»
  reason: string | null; // why a closed node is closed
  description: string;
  baseDays: number;
  days: number; // days of work still to do at the current speed (the whole tech unless it is under way)
  share: number; // 0..1, only while under way
  queuePos: number | null; // 1-based
  requires: { id: string; name: string; done: boolean }[];
  opens: string[]; // unlock names and modifier lines
  insight: { text: string; cut: number } | null; // the best insight held for it
  canStart: boolean;
  canQueue: boolean;
  canCancel: boolean;
}

export interface EraProgress {
  pop: number;
  popNeed: number;
  techs: number;
  techsNeed: number;
  met: boolean;
}

export interface TechLane {
  era: number;
  name: string;
  open: boolean; // the era is reached
  conditions: EraProgress | null; // while a closed era has conditions
  domains: { id: DomainId; name: string; nodes: TechNode[] }[]; // only domains with a tech in this era
}

export interface TechView {
  era: number;
  eraName: string;
  speeds: { id: DomainId; name: string; speed: number }[];
  active: TechNode | null;
  queue: { node: TechNode; waits: string | null }[]; // waits: the prerequisite (or era) it is waiting for
  lanes: TechLane[];
  nodes: Map<string, TechNode>;
  idle: boolean; // nothing under way
  techsDone: number;
  techsTotal: number;
}

export const eraLabel = (era: number): string => (era === 2 ? "II" : era === 1 ? "I" : String(era));

const SPAN_NAME: Record<RoadKind, string> = { path: "тропа", dirt: "грунтовая дорога", footbridge: "канатный мостик", bridge: "свайный мост", stone: "каменная дорога", stonebridge: "каменный мост" };
const pct = (n: number): string => `${Math.round(n * 100)} %`;

// What a tech does besides the unlock keys, as player lines.
export function modifierLines(m: TechModifiers | undefined): string[] {
  const out: string[] = [];
  if (!m) return out;
  if (m.fieldYield) out.push(`урожай полей +${pct(m.fieldYield)}`);
  if (m.workshopOutput) out.push(`выработка мастерских +${pct(m.workshopOutput)}`);
  if (m.buildSpeed) out.push(`стройка быстрее на ${pct(m.buildSpeed)}`);
  for (const [k, v] of Object.entries(m.bridgeSpan ?? {})) if (v) out.push(`${SPAN_NAME[k as RoadKind] ?? k}: пролёт +${v} м`);
  return out;
}

export const opensOf = (t: TechDef): string[] => [...t.unlocks.map((k) => UNLOCK_NAME[k] ?? k), ...modifierLines(t.modifiers)];

// «1 дн.», «2,5 дн.», «меньше дня».
export function formatDays(d: number): string {
  if (d < 0.1) return "меньше дня";
  const r = d >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
  return `${String(r).replace(".", ",")} дн.`;
}

export const eraProgress = (pop: number, p: Pick<ProgressState, "techs">): EraProgress => {
  const techs = p.techs.filter((id) => TECH_BY_ID.get(id)?.era === 1).length;
  return { pop, popNeed: ERA_TWO.pop, techs, techsNeed: ERA_TWO.techs, met: pop >= ERA_TWO.pop && techs >= ERA_TWO.techs };
};

// The badge of the «Наука» button: a tech finished since the panel was last opened, or the science stands idle.
export type TechBadge = "done" | "idle" | null;
export function techBadge(seenCount: number | null, techsCount: number, idle: boolean): TechBadge {
  if (seenCount !== null && techsCount > seenCount) return "done";
  return idle ? "idle" : null;
}
export const BADGE_TEXT: Record<Exclude<TechBadge, null>, string> = { done: "готово", idle: "простаивает" };

// Days of work after the best insight held for the tech (the same rule as workDays in sim/research.ts, which the UI
// does not import: it pulls in the whole sim).
const workOf = (p: Pick<ProgressState, "insights">, t: TechDef): number =>
  t.days * (1 - Math.max(0, ...INSIGHTS.filter((i) => i.tech === t.id && p.insights.includes(i.id)).map((i) => i.cut)));

export function buildTechView(inp: TechInput): TechView {
  const { progress: p, research: r } = inp;
  const activeId = r.active?.techId ?? null;

  const make = (t: TechDef): TechNode => {
    const done = p.techs.includes(t.id);
    const isActive = activeId === t.id;
    const qi = p.research.queue.indexOf(t.id);
    const eraBlocked = t.era > p.era;
    const missing = t.requires.map((id) => TECH_BY_ID.get(id)).filter((x): x is TechDef => !!x && !p.techs.includes(x.id));
    const blocker = done ? null : eraBlocked ? "era" : missing.length ? "tech" : null;
    const state: NodeState = done ? "done" : isActive ? "active" : qi >= 0 ? "queued" : blocker ? "locked" : "available";
    const speed = r.speeds[t.domain] ?? 1;
    const need = workOf(p, t);
    const share = isActive && r.active ? r.active.share : 0;
    const days = isActive && r.active ? r.active.etaMinutes / 1440 : need / speed;
    const reason = state === "locked" ? (eraBlocked ? `нужна эпоха ${eraLabel(t.era)}` : missing.length ? `нужна технология ${missing.map((x) => x.name).join(", ")}` : null) : null;
    const insight = INSIGHTS.filter((i) => i.tech === t.id && p.insights.includes(i.id)).sort((a, b) => b.cut - a.cut)[0];
    const statusText =
      state === "done" ? "Изучено"
      : state === "active" ? `Исследуется, ${Math.floor(share * 100)} %`
      : state === "queued" ? `В очереди, №${qi + 1}`
      : state === "locked" ? `Закрыто${reason ? `: ${reason}` : ""}`
      : `Доступно, ${formatDays(days)}`;
    const startable = !r.active && blocker === null;
    return {
      id: t.id,
      name: t.name,
      era: t.era,
      domain: t.domain,
      state,
      statusText,
      reason,
      description: t.description,
      baseDays: t.days,
      days,
      share,
      queuePos: qi >= 0 ? qi + 1 : null,
      requires: t.requires.map((id) => ({ id, name: TECH_BY_ID.get(id)?.name ?? id, done: p.techs.includes(id) })),
      opens: opensOf(t),
      insight: insight ? { text: insight.text, cut: insight.cut } : null,
      canStart: startable,
      canQueue: !done && !isActive && qi < 0 && !eraBlocked && !startable && p.research.queue.length < MAX_QUEUE,
      canCancel: isActive || qi >= 0,
    };
  };

  const nodes = new Map<string, TechNode>(TECHS.map((t) => [t.id, make(t)]));
  const lanes: TechLane[] = ERAS.map((e) => ({
    era: e.id,
    name: e.name,
    open: e.id <= p.era,
    conditions: e.id === 2 && p.era < 2 ? eraProgress(inp.pop, p) : null,
    domains: DOMAINS.map((d) => ({ id: d.id, name: domainName(d.id), nodes: TECHS.filter((t) => t.era === e.id && t.domain === d.id).map((t) => nodes.get(t.id)!) })).filter((d) => d.nodes.length > 0),
  }));
  return {
    era: p.era,
    eraName: eraName(p.era),
    speeds: DOMAINS.map((d) => ({ id: d.id, name: d.name, speed: r.speeds[d.id] ?? 1 })),
    active: activeId ? (nodes.get(activeId) ?? null) : null,
    queue: p.research.queue
      .map((id) => nodes.get(id))
      .filter((n): n is TechNode => !!n)
      .map((node) => ({ node, waits: node.era > p.era ? `эпоха ${eraLabel(node.era)}` : (node.requires.find((q) => !q.done)?.name ?? null) })),
    lanes,
    nodes,
    idle: r.active === null,
    techsDone: p.techs.length,
    techsTotal: TECHS.length,
  };
}
