import { BUILDINGS } from "../sim/buildings";
import { domainName, type DomainId } from "../sim/domains";
import { heritageDomain, kindName, MONUMENT, nextInsight, restoreCost, restoredHeight, restoreWeightOf, siteTitle, workTemplate } from "../sim/heritage";
import { restoreBlocker } from "../sim/heritageGeo";
import { SPEED } from "../sim/research";
import { SERVICES, isService } from "../sim/services";
import { INSIGHT_BY_ID, TECH_BY_ID } from "../sim/tech";
import type { FoundFoundation, FoundState, RestoreMode, SimState, StoredArticle } from "../sim/types";

// Pure view model of the heritage panel (PLAN-research.ru.md section 7): what a typed old building is, what its
// restoration costs and gives in each mode, and why a mode is closed.

export const STATE_TEXT: Record<FoundState, string> = {
  restoring: "Восстанавливается",
  restored: "Восстановлена",
  lost: "Утрачена",
};

export interface ModeOption {
  mode: RestoreMode;
  label: string;
  available: boolean;
  why: string | null; // Russian reason it is closed
  effects: string[]; // what the finished building does
  research: string; // «+5 % к скорости: Знание»
  insight: string | null; // the idea it would bring
}

export interface HeritageView {
  id: string;
  title: string;
  kind: string; // Russian type name
  domain: DomainId | null;
  domainName: string;
  area: number;
  height: number;
  state: FoundState | null;
  stateText: string | null;
  cost: { labor: number; logs: number; planks: number; stone: number };
  mul: number; // scarcity multiplier
  options: ModeOption[];
  canOrder: boolean;
  note: string | null; // why nothing can be ordered at all
  article: { title: string; url: string } | null;
}

export interface HeritageInput {
  site: Pick<FoundFoundation, "id" | "cls" | "name" | "height" | "area" | "state">;
  sim: Pick<SimState, "finds" | "buildings" | "roads" | "progress">;
  mul: number;
  articles: readonly StoredArticle[];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/ё/g, "е");

// The article of the notebook whose title is the site's name.
export function articleFor(name: string | undefined, articles: readonly StoredArticle[]): { title: string; url: string } | null {
  if (!name) return null;
  const n = norm(name);
  const a = articles.find((x) => norm(x.title) === n);
  return a ? { title: a.title, url: a.url } : null;
}

const fmt = (v: number): string => (Math.round(v * 10) / 10).toString().replace(".", ",");

// «+N % к скорости: <домен>» for a restoration of weight `w` in the domain, with the research speed's cap counted.
export function speedGain(restored: number, w: number): number {
  return (Math.min(SPEED.restoredCap, restored + w) - Math.min(SPEED.restoredCap, restored)) * SPEED.restored * 100;
}

function workEffects(cls: string | undefined): string[] {
  const id = workTemplate(cls);
  const t = id ? BUILDINGS[id] : undefined;
  if (!t) return [];
  const out = [`Работает как «${t.name}»`];
  if (t.jobs > 0) out.push(`${t.jobs} ${t.jobs === 1 ? "рабочее место" : "рабочих места"}`);
  if (isService(t.id)) out.push(`Охват ${SERVICES[t.id].reach} м по дорогам`);
  return out;
}

export function buildHeritageView({ site, sim, mul, articles }: HeritageInput): HeritageView {
  const domain = heritageDomain(site.cls);
  const recorded = sim.finds.foundations.some((f) => f.id === site.id);
  const open = (mode: RestoreMode): string | null => (recorded ? restoreBlocker(sim, site.id, mode) : "Находка ещё не занесена в записи");
  const base = domain ? (sim.progress.restored[domain] ?? 0) : 0;
  const ins = domain ? nextInsight(sim.progress, domain) : null;
  const insightText = ins
    ? ins.tech
      ? `«${ins.text}»: «${TECH_BY_ID.get(ins.tech)?.name ?? ins.tech}» изучается быстрее на ${Math.round(ins.cut * 100)} %`
      : `«${ins.text}»: +${Math.round((INSIGHT_BY_ID.get(ins.id)?.speed ?? 0) * 100)} % к скорости всех областей`
    : null;
  const mk = (mode: RestoreMode): ModeOption => {
    const why = open(mode);
    const w = restoreWeightOf(mode, mul);
    const effects =
      mode === "monument"
        ? ["Без рабочих мест", `Дома в ${MONUMENT.radius} м: настроение +${MONUMENT.mood}, стоимость земли +${MONUMENT.land} (до +${MONUMENT.landCap} от всех памятников)`]
        : workEffects(site.cls);
    return {
      mode,
      label: mode === "monument" ? "Памятник" : "В деле",
      available: why === null,
      why,
      effects,
      research: `+${fmt(domain ? speedGain(base, w) : 0)} % к скорости: ${domain ? domainName(domain) : "—"}`,
      insight: insightText,
    };
  };
  const options = [mk("monument"), mk("working")];
  const canOrder = options.some((o) => o.available);
  const state = site.state ?? null;
  return {
    id: site.id,
    title: siteTitle(site),
    kind: kindName(site.cls),
    domain,
    domainName: domain ? domainName(domain) : "—",
    area: site.area,
    height: Math.round(restoredHeight(site.height, BUILDINGS[workTemplate(site.cls) ?? "restored"].height)), // as the sim sizes it
    state,
    stateText: state ? STATE_TEXT[state] : null,
    cost: restoreCost(site.area),
    mul,
    options,
    canOrder,
    note: canOrder ? null : (options[0].why ?? options[1].why),
    article: articleFor(site.name, articles),
  };
}
