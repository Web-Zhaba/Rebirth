import { addChronicle } from "./chronicle";
import { heritageDomain, nextInsight, restoreWeightOf, scarcity, siteTitle } from "./heritage";
import { restoreBlocker, restoredBuilding } from "./heritageGeo";
import { say } from "./production";
import { grantInsight } from "./research";
import { INSIGHT_BY_ID } from "./tech";
import type { Building, FoundFoundation, SimState } from "./types";

// Restoring an old typed building (PLAN-research.ru.md section 7): the order, the finish and the loss.

export type RestoreResult = { ok: true; sim: SimState } | { ok: false; reason: string };

const withFoundation = (s: SimState, id: string, patch: Partial<FoundFoundation>): SimState => ({
  ...s,
  finds: { ...s.finds, foundations: s.finds.foundations.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
});

// The order: a planned building of the foundation's real shape, built by the artel like any placed building.
export function restoreSite(s: SimState, siteId: unknown, mode: unknown): RestoreResult {
  if (typeof siteId !== "string") return { ok: false, reason: "Некорректная постройка" };
  if (mode !== "monument" && mode !== "working") return { ok: false, reason: "Некорректное назначение" };
  const why = restoreBlocker(s, siteId, mode);
  if (why) return { ok: false, reason: why };
  const f = s.finds.foundations.find((x) => x.id === siteId)!;
  const id = s.nextBuildingId;
  const b = restoredBuilding(f, mode, s.roads, id, s.gameMinutes);
  if (!b) return { ok: false, reason: "Нужна дорога" };
  return { ok: true, sim: withFoundation({ ...s, nextBuildingId: id + 1, buildings: { ...s.buildings, [id]: b } }, siteId, { state: "restoring" }) };
}

// Every restored building that has just been finished counts: the foundation is restored, the domain's research
// grows by the scarcity-weighted share, an insight comes. Driven by the state (not a diff), so admin finishing works too.
export function completeRestorations(s: SimState): SimState {
  let cur = s;
  for (const b of Object.values(s.buildings)) {
    if (!b.siteId || b.state !== "active" || b.upgrade || (b.restoreMode !== "monument" && b.restoreMode !== "working")) continue;
    const f = cur.finds.foundations.find((x) => x.id === b.siteId);
    if (!f || f.state !== "restoring") continue;
    const domain = heritageDomain(f.cls);
    const weight = restoreWeightOf(b.restoreMode, scarcity(cur.finds));
    let progress = cur.progress;
    if (domain) progress = { ...progress, restored: { ...progress.restored, [domain]: (progress.restored[domain] ?? 0) + weight } };
    const ins = domain ? nextInsight(progress, domain) : null;
    cur = withFoundation({ ...cur, progress, buildings: { ...cur.buildings, [b.id]: { ...b, restoreWeight: weight } } }, f.id, { state: "restored" });
    if (ins) cur = grantInsight(cur, ins.id);
    const name = siteTitle(f);
    const text = `Восстановлено: ${name}${ins ? ` — идея «${INSIGHT_BY_ID.get(ins.id)?.text ?? ins.text}»` : ""}`;
    cur = { ...cur, events: say(cur.events, cur.gameMinutes, "heritage", text, [b.lot.cx, b.lot.cy]), chronicle: addChronicle(cur.chronicle, cur.gameMinutes, `heritage:${f.id}`, text) };
  }
  return cur;
}

// A restoring or restored building is demolished: the site is lost for good, its weight leaves the research.
export function loseSite(s: SimState, gone: Building): SimState {
  if (!gone.siteId) return s;
  const f = s.finds.foundations.find((x) => x.id === gone.siteId);
  if (!f || f.state === "lost") return s;
  let out = withFoundation(s, f.id, { state: "lost" });
  const domain = heritageDomain(f.cls);
  const w = gone.restoreWeight ?? 0;
  if (domain && w > 0) {
    const left = Math.max(0, (out.progress.restored[domain] ?? 0) - w);
    const restored = { ...out.progress.restored };
    if (left > 1e-9) restored[domain] = Math.round(left * 100) / 100;
    else delete restored[domain];
    out = { ...out, progress: { ...out.progress, restored } };
  }
  return { ...out, chronicle: addChronicle(out.chronicle, out.gameMinutes, `heritage-lost:${f.id}`, `Утрачено: ${siteTitle(f)}`) };
}

