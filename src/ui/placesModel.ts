import { digName, digShares, RECOGNITION, STEP_REWARD, stepsOf } from "../sim/recognition";
import { STREET, streetFoundations, streetProgress } from "../sim/streets";
import type { FoundFeature, FoundPlace, SimState } from "../sim/types";
import { pointInRing } from "../sim/excavation";

// Pure view model of the town panel's places tab: how recognisable each dig's place
// is again, and how far each old street is from getting its name back.

// One straight piece of an old street's line, carrying its street's id: the walk nearestStreet used to repeat for every
// (street, feature) pair, flattened once per view instead (perf/reports/ui.md, placesView).
interface StreetSegment {
  id: string;
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  len2: number;
}

function segmentsOf(streets: readonly FoundPlace[]): StreetSegment[] {
  const out: StreetSegment[] = [];
  for (const t of streets) {
    if (!t.lines) continue;
    for (const l of t.lines)
      for (let i = 1; i < l.length; i++) {
        const [ax, ay] = l[i - 1];
        const dx = l[i][0] - ax;
        const dy = l[i][1] - ay;
        out.push({ id: t.id, ax, ay, dx, dy, len2: dx * dx + dy * dy });
      }
  }
  return out;
}

// The street whose line is nearest to a point, within the reach of its houses. Ties keep the first street in order, as
// the nested walk did.
function nearestStreet(segments: readonly StreetSegment[], x: number, y: number): string | null {
  let best: string | null = null;
  let bd = STREET.reach;
  for (const s of segments) {
    const k = s.len2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * s.dx + (y - s.ay) * s.dy) / s.len2)) : 0;
    const d = Math.hypot(x - s.ax - k * s.dx, y - s.ay - k * s.dy);
    if (d < bd) {
      best = s.id;
      bd = d;
    }
  }
  return best;
}


export interface PlaceRow {
  digId: number;
  name: string;
  share: number; // 0..1 of its foundations' area built on again
  steps: number; // rewards received, 0..4
  next: { at: number; reward: string } | null; // the next threshold (0..1) and what it brings
}

export interface StreetRow {
  id: string;
  name: string;
  houses: number;
  built: number;
  road: number; // 0..1 of the old line under built roads
  restored: boolean;
  numbers: { found: number; total: number }; // house numbers of the street: found in dug houses, of all known
  household: { found: number; total: number }; // its ordinary houses dug: the household of the street
}

export function placesView(s: Pick<SimState, "finds" | "buildings" | "roads" | "progress">): { places: PlaceRow[]; streets: StreetRow[] } {
  const places: PlaceRow[] = [];
  for (const [digId, d] of [...digShares(s)].sort((a, b) => a[0] - b[0])) {
    const steps = Math.max(s.progress.recognised?.[digId] ?? 0, stepsOf(d.share));
    places.push({ digId, name: digName(s.finds, digId), share: d.share, steps, next: steps < RECOGNITION.steps.length ? { at: RECOGNITION.steps[steps], reward: STEP_REWARD[steps] } : null });
  }
  const own = streetFoundations(s.finds.streets, s.finds.foundations);
  // A feature's street is asked once, not once per street that wants its numbers.
  const segments = segmentsOf(s.finds.streets);
  const nearestOf = new Map<FoundFeature, string | null>();
  const streetOf = (f: FoundFeature): string | null => {
    const known = nearestOf.get(f);
    if (known !== undefined) return known;
    const id = nearestStreet(segments, f.x, f.y);
    nearestOf.set(f, id);
    return id;
  };
  const numbers = (s.finds.features ?? []).filter((x) => x.kind === "number");
  const streets: StreetRow[] = [];
  for (const t of s.finds.streets) {
    if (!t.lines) continue;
    const mine = own.get(t.id) ?? [];
    const p = streetProgress(s, t, mine);
    if (p.houses === 0 && t.restored === undefined) continue; // no houses of its own: nothing to bring back
    const plain = mine.filter((f) => !f.cls);
    const nums = numbers.filter((x) => streetOf(x) === t.id);
    const dug = mine.filter((f) => !f.ghost);
    streets.push({
      id: t.id,
      name: t.name,
      houses: p.houses,
      built: p.built,
      road: p.road,
      restored: t.restored !== undefined,
      numbers: { found: nums.filter((x) => dug.some((f) => pointInRing(x.x, x.y, f.ring))).length, total: nums.length },
      household: { found: plain.filter((f) => !f.ghost).length, total: plain.length },
    });
  }
  // nearest to done first, the restored ones last
  const left = (r: StreetRow) => (r.restored ? Infinity : r.houses - r.built + (r.road >= STREET.share ? 0 : 1));
  streets.sort((a, b) => left(a) - left(b) || a.name.localeCompare(b.name));
  return { places, streets };
}
