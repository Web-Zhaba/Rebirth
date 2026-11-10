import { BUILDINGS, floorsOf, type Materials } from "../sim/buildings";
import { domainName, type DomainId } from "../sim/domains";
import { foundationScale } from "../sim/foundationLots";
import { canPlaceOnFoundation } from "../sim/growth";
import { asItWasTemplate, earlierOfKind, kindName, MONUMENT, nextInsight, repeatFactor, restoreWeightOf, siteDomain, siteTitle, tierContext, tierOf, TYPICAL_SHARE, type Tier } from "../sim/heritage";
import { SPEED } from "../sim/research";
import { SERVICES, isService } from "../sim/services";
import { INSIGHT_BY_ID, lockReason, TECH_BY_ID } from "../sim/tech";
import type { FoundFoundation, FoundState, SimState, StoredArticle } from "../sim/types";
import { decimal, L, plural } from "../i18n";

// Pure view model of the heritage panel (docs/PLAN-restoration.md section 2): what a typed old building is, and what
// bringing it back "as it was" costs and gives. That is ordinary construction of the purpose that matches its old kind;
// any other purpose is put on the foundation from the build bar, without the restoration's bonus.

export const STATE_TEXT: Record<FoundState, string> = {
  restoring: L("Восстанавливается", "Being restored"),
  restored: L("Восстановлена", "Restored"),
  lost: L("Утрачена", "Lost"),
};

export interface HeritageView {
  id: string;
  title: string;
  kind: string; // type name
  domain: DomainId | null;
  domainName: string;
  area: number;
  height: number | null; // m of the old building, when the data has it
  floors: number;
  state: FoundState | null;
  stateText: string | null;
  tier: Tier;
  tierText: string; // what the tier means for this building
  template: string; // the purpose "as it was"
  byZone: boolean; // that purpose grows in a zone: the player paints the zone, no order
  purpose: string; // its name
  effects: string[]; // what the finished building does
  research: string; // «+5 % к скорости: Знание»
  insight: string | null; // the idea it would bring
  cost: { labor: number } & Materials;
  mul: number; // scarcity multiplier
  repeat: { kind: string; factor: number } | null; // a further site of a kind already restored or ordered: its research factor
  canOrder: boolean;
  note: string | null; // why it cannot be ordered now
  article: { title: string; url: string } | null;
}

export interface HeritageInput {
  site: Pick<FoundFoundation, "id" | "cls" | "name" | "height" | "area" | "state">;
  sim: Pick<SimState, "finds" | "buildings" | "roads" | "zones" | "progress">;
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

const ZONE_WORD: Record<string, string> = { res: L("жилая", "residential"), craft: L("ремесленная", "craft"), trade: L("торговая", "trade") };

function purposeEffects(id: string): string[] {
  const t = BUILDINGS[id];
  if (id === "restored")
    return [L("Без жителей и рабочих мест", "No residents or jobs"), L(`Дома в ${MONUMENT.radius} м: настроение +${MONUMENT.mood}, стоимость земли +${MONUMENT.land} (до +${MONUMENT.landCap} от всех памятников)`, `Houses within ${MONUMENT.radius} m: mood +${MONUMENT.mood}, land value +${MONUMENT.land} (up to +${MONUMENT.landCap} from all monuments)`)];
  const out = [L(`Работает как «${t.name}»`, `Works as: ${t.name}`)];
  if (t.jobs > 0) out.push(`${t.jobs} ${plural(t.jobs, "рабочее место", "рабочих места", "рабочих мест", "job")}`);
  if (isService(t.id)) out.push(L(`Охват ${SERVICES[t.id].reach} м по дорогам`, `Reach ${SERVICES[t.id].reach} m by road`));
  return out;
}

export function buildHeritageView({ site, sim, mul, articles }: HeritageInput): HeritageView {
  const domain = siteDomain(site.cls);
  const earlier = earlierOfKind(sim, site.cls, site.id);
  const recorded = sim.finds.foundations.some((f) => f.id === site.id);
  const template = asItWasTemplate(site.cls) ?? "restored";
  const t = BUILDINGS[template];
  const floors = floorsOf(site.height);
  // "As it was" builds every old floor at once: the cost of the ring's area times the floors.
  const k = foundationScale(t, site) * floors;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const cost = { labor: Math.max(1, Math.round(t.labor * k)), logs: r1(t.materials.logs * k), planks: r1(t.materials.planks * k), stone: r1(t.materials.stone * k) };
  const base = domain ? (sim.progress.restored[domain] ?? 0) : 0;
  const tier = tierOf(site, tierContext(sim.finds, articles));
  const unique = tier === "unique";
  const w = restoreWeightOf(mul, earlier) * (unique ? 1 : TYPICAL_SHARE);
  const ins = unique && domain && earlier === 0 ? nextInsight(sim.progress, domain) : null; // only the first unique one of a kind brings an idea
  const insight = ins
    ? ins.tech
      ? L(`«${ins.text}»: «${TECH_BY_ID.get(ins.tech)?.name ?? ins.tech}» изучается быстрее на ${Math.round(ins.cut * 100)} %`, `“${ins.text}”: ${TECH_BY_ID.get(ins.tech)?.name ?? ins.tech} is researched ${Math.round(ins.cut * 100)}% faster`)
      : L(`«${ins.text}»: +${Math.round((INSIGHT_BY_ID.get(ins.id)?.speed ?? 0) * 100)} % к скорости всех областей`, `“${ins.text}”: +${Math.round((INSIGHT_BY_ID.get(ins.id)?.speed ?? 0) * 100)}% speed in all fields`)
    : null;
  const state = site.state ?? null;
  let note: string | null = null;
  if (state === "lost") note = L("Постройка утрачена: как было её уже не вернуть", "The building is lost: it cannot come back as it was");
  else if (state === "restoring") note = L(`Строится как было: «${t.name}»`, `Being built as it was: ${t.name}`);
  else if (state === "restored") note = L(`Восстановлена как было: «${t.name}»`, `Restored as it was: ${t.name}`);
  else if (!recorded) note = L("Находка ещё не занесена в записи", "The find is not recorded yet");
  else if (t.zone !== "placed") note = L(`Восстановится как было сам, когда здесь будет ${ZONE_WORD[t.zone]} зона`, `It comes back as it was by itself once a ${ZONE_WORD[t.zone]} zone covers it`);
  else {
    const locked = lockReason(sim, template);
    if (locked) note = L(`Назначение закрыто: ${locked.toLowerCase()}`, `Purpose locked: ${locked.toLowerCase()}`);
    else {
      const ok = canPlaceOnFoundation(sim, t, site.id);
      if (!ok.ok) note = ok.reason;
    }
  }
  return {
    id: site.id,
    title: siteTitle(site),
    kind: kindName(site.cls),
    domain,
    domainName: domain ? domainName(domain) : "—",
    area: site.area,
    height: site.height !== undefined && site.height > 0 ? Math.round(site.height) : null,
    floors,
    state,
    stateText: state ? STATE_TEXT[state] : null,
    tier,
    tierText: unique
      ? L("Единственная в своём роде: идея, глава летописи, действует как памятник", "One of a kind: an idea, a chronicle chapter, works as a monument")
      : L("Типовая постройка: малый вклад в науку, без идеи", "A typical building: a small research contribution, no idea"),
    template,
    byZone: t.zone !== "placed",
    purpose: t.name,
    effects: unique && template !== "restored" ? [...purposeEffects(template), L(`Дома в ${MONUMENT.radius} м: настроение +${MONUMENT.landmarkMood}`, `Houses within ${MONUMENT.radius} m: mood +${MONUMENT.landmarkMood}`)] : purposeEffects(template),
    research: `+${fmt(domain ? speedGain(base, w) : 0)}${L(" % к скорости", "% speed")}: ${domain ? domainName(domain) : "—"}`,
    insight,
    cost,
    mul,
    repeat: earlier > 0 ? { kind: kindName(site.cls), factor: repeatFactor(earlier) } : null,
    canOrder: note === null,
    note,
    article: articleFor(site.name, articles),
  };
}
