import { digName, digShares, RECOGNITION, STEP_REWARD, stepsOf } from "../sim/recognition";
import { STREET, streetFoundations, streetProgress } from "../sim/streets";
import type { SimState } from "../sim/types";

// Pure view model of the town panel's places tab (docs/PLAN-restoration.md section 4): how recognisable each dig's place
// is again, and how far each old street is from getting its name back.

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
}

export function placesView(s: Pick<SimState, "finds" | "buildings" | "roads" | "progress">): { places: PlaceRow[]; streets: StreetRow[] } {
  const places: PlaceRow[] = [];
  for (const [digId, d] of [...digShares(s)].sort((a, b) => a[0] - b[0])) {
    const steps = Math.max(s.progress.recognised?.[digId] ?? 0, stepsOf(d.share));
    places.push({ digId, name: digName(s.finds, digId), share: d.share, steps, next: steps < RECOGNITION.steps.length ? { at: RECOGNITION.steps[steps], reward: STEP_REWARD[steps] } : null });
  }
  const own = streetFoundations(s.finds.streets, s.finds.foundations);
  const streets: StreetRow[] = [];
  for (const t of s.finds.streets) {
    if (!t.lines) continue;
    const p = streetProgress(s, t, own.get(t.id) ?? []);
    if (p.houses === 0 && t.restored === undefined) continue; // no houses of its own: nothing to bring back
    streets.push({ id: t.id, name: t.name, houses: p.houses, built: p.built, road: p.road, restored: t.restored !== undefined });
  }
  // nearest to done first, the restored ones last
  const left = (r: StreetRow) => (r.restored ? Infinity : r.houses - r.built + (r.road >= STREET.share ? 0 : 1));
  streets.sort((a, b) => left(a) - left(b) || a.name.localeCompare(b.name));
  return { places, streets };
}
