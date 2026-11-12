import { addChronicle } from "./chronicle";
import { FOUNDATION_LOT } from "./foundationLots";
import { nextInsight, siteDomain } from "./heritage";
import { say } from "./production";
import { grantInsight } from "./research";
import { INSIGHT_BY_ID } from "./tech";
import type { Finds, ProgressState, SimState } from "./types";
import type { DomainId } from "./domains";
import { L } from "../i18n";

// Recognisability of a dig: the share of its old foundations, by area, that carry a
// finished building again. Rewards go by share, not by count: each threshold brings one, once, and stays, so their number
// is bounded by the digs, not the buildings, and they go to finishing places.

export const RECOGNITION = {
  steps: [0.25, 0.5, 0.75, 1], // shares that bring a reward each
  mood: [0, 1, 1, 2, 2], // mood of the houses in the dig's disc by the steps reached (1: +1, 3: +2)
  full: 0.999, // the last step: every foundation, rounding aside
};

// What each step brings, for the panel.
export const STEP_REWARD: string[] = [
  L("настроение домов в раскопе +1", "mood of the houses in the dig +1"),
  L("идея", "an idea"),
  L("настроение домов в раскопе +2", "mood of the houses in the dig +2"),
  L("идея и глава летописи", "an idea and a chronicle chapter"),
];

export interface DigShare {
  total: number; // m2 of its foundations of a usable size
  restored: number; // m2 of those that carry a finished building
  share: number; // 0..1
}

const cache = new WeakMap<object, WeakMap<object, Map<number, DigShare>>>();

// Share of each dig, by dig id.
export function digShares(s: Pick<SimState, "finds" | "buildings">): Map<number, DigShare> {
  let inner = cache.get(s.finds.foundations);
  if (!inner) cache.set(s.finds.foundations, (inner = new WeakMap()));
  const hit = inner.get(s.buildings);
  if (hit) return hit;
  const built = new Set<string>();
  for (const b of Object.values(s.buildings)) if (b.foundationId && b.state === "active" && b.template !== "excavation") built.add(b.foundationId);
  const out = new Map<number, DigShare>();
  for (const f of s.finds.foundations) {
    if (f.area < FOUNDATION_LOT.minArea) continue;
    let d = out.get(f.digId);
    if (!d) out.set(f.digId, (d = { total: 0, restored: 0, share: 0 }));
    d.total += f.area;
    if (built.has(f.id)) d.restored += f.area;
  }
  for (const d of out.values()) d.share = d.total > 0 ? d.restored / d.total : 0;
  inner.set(s.buildings, out);
  return out;
}

// Steps a share has reached, 0..4.
export const stepsOf = (share: number): number => RECOGNITION.steps.filter((t, i) => share >= (i === RECOGNITION.steps.length - 1 ? RECOGNITION.full : t)).length;

// What a dig is called in the chronicle: its first old street, else its first named place.
export function digName(finds: Pick<Finds, "streets" | "pois">, digId: number): string {
  const street = finds.streets.find((t) => t.digId === digId);
  if (street) return street.name;
  const place = finds.pois.find((p) => p.digId === digId);
  return place ? `«${place.name}»` : L(`раскоп ${digId}`, `dig ${digId}`);
}

// The domain most of the dig's typed foundations feed (by area); build when it has none.
function digDomain(finds: Pick<Finds, "foundations">, digId: number): DomainId {
  const by = new Map<DomainId, number>();
  for (const f of finds.foundations) {
    const d = f.digId === digId ? siteDomain(f.cls) : null;
    if (d) by.set(d, (by.get(d) ?? 0) + f.area);
  }
  let best: DomainId = "build";
  let n = 0;
  for (const [d, a] of by) if (a > n) [best, n] = [d, a];
  return best;
}

// Grants the steps the digs have newly reached (daily). Steps once given stay, whatever is demolished later.
export function recognise(s: SimState): SimState {
  const got = s.progress.recognised ?? {};
  let cur = s;
  for (const [digId, d] of digShares(s)) {
    const now = stepsOf(d.share);
    const had = got[digId] ?? 0;
    if (now <= had) continue;
    const name = digName(s.finds, digId);
    cur = { ...cur, progress: { ...cur.progress, recognised: { ...(cur.progress.recognised ?? {}), [digId]: now } } };
    for (let step = had + 1; step <= now; step++) {
      const pct = Math.round(RECOGNITION.steps[step - 1] * 100);
      const head = step === 4 ? L(`Место узнаётся целиком: ${name}`, `The place is whole again: ${name}`) : L(`Место узнаётся на ${pct} %: ${name}`, `The place is ${pct}% recognisable: ${name}`);
      let tail = L(" — людям там живётся лучше", " — people there feel better");
      if (step === 2 || step === 4) {
        const ins = nextInsight(cur.progress, digDomain(cur.finds, digId));
        tail = "";
        if (ins) {
          cur = grantInsight(cur, ins.id);
          tail = L(` — идея «${INSIGHT_BY_ID.get(ins.id)?.text ?? ins.text}»`, ` — idea “${INSIGHT_BY_ID.get(ins.id)?.text ?? ins.text}”`);
        }
      }
      const disc = cur.finds.revealed.find((r) => r.digId === digId);
      cur = { ...cur, events: say(cur.events, cur.gameMinutes, "heritage", head + tail, disc ? [disc.x, disc.y] : undefined), chronicle: addChronicle(cur.chronicle, cur.gameMinutes, `recognised:${digId}:${step}`, head + tail) };
    }
  }
  return cur;
}

// Mood a house at (x, y) gets from the recognisability of the digs whose discs hold it: the best one counts.
export function districtMood(progress: Pick<ProgressState, "recognised">, finds: Pick<Finds, "revealed">, x: number, y: number): number {
  const got = progress.recognised;
  if (!got) return 0;
  let best = 0;
  for (const r of finds.revealed) {
    const step = got[r.digId] ?? 0;
    if (step > 0 && Math.hypot(x - r.x, y - r.y) <= r.r) best = Math.max(best, RECOGNITION.mood[step]);
  }
  return best;
}
