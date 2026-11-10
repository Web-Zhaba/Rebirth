import { addChronicle } from "./chronicle";
import { earlierOfKind, nextInsight, restoreWeightOf, scarcity, siteDomain, siteTitle } from "./heritage";
import { say } from "./production";
import { grantInsight } from "./research";
import { INSIGHT_BY_ID } from "./tech";
import type { Building, FoundFoundation, SimState } from "./types";
import { L } from "../i18n";

// Restoring an old building "as it was" (docs/PLAN-restoration.md section 2): ordinary construction on an old foundation
// whose purpose matches its known old kind (`Building.asItWas`). This module keeps its consequences: the site is being
// restored once ordered, restored once finished (research, an idea, a chronicle line) and lost once demolished.

const withFoundation = (s: SimState, id: string, patch: Partial<FoundFoundation>): SimState => ({
  ...s,
  finds: { ...s.finds, foundations: s.finds.foundations.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
});

// A building "as it was" has just been planned on its foundation: the site is being restored.
export function orderRestoration(s: SimState, b: Building): SimState {
  if (!b.asItWas || !b.foundationId) return s;
  return withFoundation(s, b.foundationId, { state: "restoring" });
}

// Every building "as it was" that has just been finished counts: the foundation is restored, the domain's research
// grows by the scarcity-weighted share, an insight comes. Driven by the state (not a diff), so admin finishing works too.
export function completeRestorations(s: SimState): SimState {
  let cur = s;
  for (const b of Object.values(s.buildings)) {
    if (!b.asItWas || !b.foundationId || b.state !== "active") continue;
    const f = cur.finds.foundations.find((x) => x.id === b.foundationId);
    if (!f || f.state !== "restoring") continue;
    const domain = siteDomain(f.cls);
    const earlier = earlierOfKind(cur, f.cls, f.id, b.id);
    const weight = restoreWeightOf(scarcity(cur.finds), earlier);
    let progress = cur.progress;
    if (domain) progress = { ...progress, restored: { ...progress.restored, [domain]: (progress.restored[domain] ?? 0) + weight } };
    const ins = domain && earlier === 0 ? nextInsight(progress, domain) : null; // only the first of a kind brings an idea
    cur = withFoundation({ ...cur, progress, buildings: { ...cur.buildings, [b.id]: { ...b, restoreWeight: weight } } }, f.id, { state: "restored" });
    if (ins) cur = grantInsight(cur, ins.id);
    const name = siteTitle(f);
    const text = `${L("Восстановлено", "Restored")}: ${name}${ins ? ` — ${L("идея", "idea")} «${INSIGHT_BY_ID.get(ins.id)?.text ?? ins.text}»` : ""}`;
    cur = { ...cur, events: say(cur.events, cur.gameMinutes, "heritage", text, [b.lot.cx, b.lot.cy]), chronicle: addChronicle(cur.chronicle, cur.gameMinutes, `heritage:${f.id}`, text) };
  }
  return cur;
}

// A building "as it was" is demolished: the site is lost for good, its weight leaves the research.
export function loseSite(s: SimState, gone: Building): SimState {
  if (!gone.asItWas || !gone.foundationId) return s;
  const f = s.finds.foundations.find((x) => x.id === gone.foundationId);
  if (!f || f.state === "lost" || !f.state) return s;
  let out = withFoundation(s, f.id, { state: "lost" });
  const domain = siteDomain(f.cls);
  const w = gone.restoreWeight ?? 0;
  if (domain && w > 0) {
    const left = Math.max(0, (out.progress.restored[domain] ?? 0) - w);
    const restored = { ...out.progress.restored };
    if (left > 1e-9) restored[domain] = Math.round(left * 100) / 100;
    else delete restored[domain];
    out = { ...out, progress: { ...out.progress, restored } };
  }
  return { ...out, chronicle: addChronicle(out.chronicle, out.gameMinutes, `heritage-lost:${f.id}`, L(`Утрачено: ${siteTitle(f)}`, `Lost: ${siteTitle(f)}`)) };
}
