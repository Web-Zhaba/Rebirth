import { BUILDINGS } from "../sim/buildings";
import { domainName, type DomainId } from "../sim/domains";
import { earlierOfKind, kindName, MONUMENT, nextInsight, repeatFactor, restoreCost, restoredHeight, restoreWeightOf, siteDomain, siteTitle, workTemplate } from "../sim/heritage";
import { restoreBlocker } from "../sim/heritageGeo";
import { SPEED } from "../sim/research";
import { SERVICES, isService } from "../sim/services";
import { INSIGHT_BY_ID, TECH_BY_ID } from "../sim/tech";
import type { FoundFoundation, FoundState, RestoreMode, SimState, StoredArticle } from "../sim/types";
import { decimal, L, plural } from "../i18n";

// Pure view model of the heritage panel (PLAN-research.ru.md section 7): what a typed old building is, what its
// restoration costs and gives in each mode, and why a mode is closed.

export const STATE_TEXT: Record<FoundState, string> = {
  restoring: L("Восстанавливается", "Being restored"),
  restored: L("Восстановлена", "Restored"),
  lost: L("Утрачена", "Lost"),
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
  repeat: { kind: string; factor: number } | null; // a further site of a kind already restored or ordered: its research factor
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

const fmt = (v: number): string => decimal((Math.round(v * 10) / 10).toString());

// «+N % к скорости: <домен>» for a restoration of weight `w` in the domain, with the research speed's cap counted.
export function speedGain(restored: number, w: number): number {
  return (Math.min(SPEED.restoredCap, restored + w) - Math.min(SPEED.restoredCap, restored)) * SPEED.restored * 100;
}

function workEffects(cls: string | undefined): string[] {
  const id = workTemplate(cls);
  const t = id ? BUILDINGS[id] : undefined;
  if (!t) return [];
  const out = [L(`Работает как «${t.name}»`, `Works as: ${t.name}`)];
  if (t.jobs > 0) out.push(`${t.jobs} ${plural(t.jobs, "рабочее место", "рабочих места", "рабочих мест", "job")}`);
  if (isService(t.id)) out.push(L(`Охват ${SERVICES[t.id].reach} м по дорогам`, `Reach ${SERVICES[t.id].reach} m by road`));
  return out;
}

export function buildHeritageView({ site, sim, mul, articles }: HeritageInput): HeritageView {
  const domain = siteDomain(site.cls);
  const earlier = earlierOfKind(sim, site.cls, site.id);
  const recorded = sim.finds.foundations.some((f) => f.id === site.id);
  const open = (mode: RestoreMode): string | null => (recorded ? restoreBlocker(sim, site.id, mode) : L("Находка ещё не занесена в записи", "The find is not recorded yet"));
  const base = domain ? (sim.progress.restored[domain] ?? 0) : 0;
  const ins = domain && earlier === 0 ? nextInsight(sim.progress, domain) : null; // only the first of a kind brings an idea
  const insightText = ins
    ? ins.tech
      ? L(`«${ins.text}»: «${TECH_BY_ID.get(ins.tech)?.name ?? ins.tech}» изучается быстрее на ${Math.round(ins.cut * 100)} %`, `“${ins.text}”: ${TECH_BY_ID.get(ins.tech)?.name ?? ins.tech} is researched ${Math.round(ins.cut * 100)}% faster`)
      : L(`«${ins.text}»: +${Math.round((INSIGHT_BY_ID.get(ins.id)?.speed ?? 0) * 100)} % к скорости всех областей`, `“${ins.text}”: +${Math.round((INSIGHT_BY_ID.get(ins.id)?.speed ?? 0) * 100)}% speed in all fields`)
    : null;
  const mk = (mode: RestoreMode): ModeOption => {
    const why = open(mode);
    const w = restoreWeightOf(mode, mul, earlier);
    const effects =
      mode === "monument"
        ? [L("Без рабочих мест", "No jobs"), L(`Дома в ${MONUMENT.radius} м: настроение +${MONUMENT.mood}, стоимость земли +${MONUMENT.land} (до +${MONUMENT.landCap} от всех памятников)`, `Houses within ${MONUMENT.radius} m: mood +${MONUMENT.mood}, land value +${MONUMENT.land} (up to +${MONUMENT.landCap} from all monuments)`)]
        : workEffects(site.cls);
    return {
      mode,
      label: mode === "monument" ? L("Памятник", "Monument") : L("В деле", "In use"),
      available: why === null,
      why,
      effects,
      research: `+${fmt(domain ? speedGain(base, w) : 0)}${L(" % к скорости", "% speed")}: ${domain ? domainName(domain) : "—"}`,
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
    repeat: earlier > 0 ? { kind: kindName(site.cls), factor: repeatFactor(earlier) } : null,
    options,
    canOrder,
    note: canOrder ? null : (options[0].why ?? options[1].why),
    article: articleFor(site.name, articles),
  };
}
