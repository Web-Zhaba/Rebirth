// placesView before and after the first-wave fix, both implementations in one process on the same town, so the numbers
// do not mix with a parallel change in src/sim/streets.ts (whose caching both share). Also asserts the output is
// identical: the fix is a rename of the walk, not a rule change.
// Run: npx vitest run --config vitest.perf.config.ts perf/bench/ui/places.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { loadFixture, time } from "./fixture";
import { digName, digShares, RECOGNITION, STEP_REWARD, stepsOf } from "../../../src/sim/recognition";
import { pointInRing } from "../../../src/sim/excavation";
import { STREET, streetFoundations, streetProgress } from "../../../src/sim/streets";
import type { FoundPlace, SimState } from "../../../src/sim/types";
import { placesView } from "../../../src/ui/placesModel";

type S = Pick<SimState, "finds" | "buildings" | "roads" | "progress">;

// placesModel.ts as it was before the fix (git HEAD): the nearest street walked again for every (street, feature) pair.
function nearestStreetBefore(streets: readonly FoundPlace[], x: number, y: number): string | null {
  let best: string | null = null;
  let bd = STREET.reach;
  for (const t of streets) {
    if (!t.lines) continue;
    for (const l of t.lines)
      for (let i = 1; i < l.length; i++) {
        const [ax, ay] = l[i - 1];
        const [bx, by] = l[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const k = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const d = Math.hypot(x - ax - k * dx, y - ay - k * dy);
        if (d < bd) [best, bd] = [t.id, d];
      }
  }
  return best;
}

function placesViewBefore(s: S) {
  const places: { digId: number; name: string; share: number; steps: number; next: { at: number; reward: string } | null }[] = [];
  for (const [digId, d] of [...digShares(s)].sort((a, b) => a[0] - b[0])) {
    const steps = Math.max(s.progress.recognised?.[digId] ?? 0, stepsOf(d.share));
    places.push({ digId, name: digName(s.finds, digId), share: d.share, steps, next: steps < RECOGNITION.steps.length ? { at: RECOGNITION.steps[steps], reward: STEP_REWARD[steps] } : null });
  }
  const own = streetFoundations(s.finds.streets, s.finds.foundations);
  const streets = [];
  for (const t of s.finds.streets) {
    if (!t.lines) continue;
    const p = streetProgress(s, t, own.get(t.id) ?? []);
    if (p.houses === 0 && t.restored === undefined) continue;
    const mine = own.get(t.id) ?? [];
    const plain = mine.filter((f) => !f.cls);
    const nums = (s.finds.features ?? []).filter((x) => x.kind === "number" && nearestStreetBefore(s.finds.streets, x.x, x.y) === t.id);
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
  const left = (r: (typeof streets)[number]) => (r.restored ? Infinity : r.houses - r.built + (r.road >= STREET.share ? 0 : 1));
  streets.sort((a, b) => left(a) - left(b) || a.name.localeCompare(b.name));
  return { places, streets };
}

// A smaller old city, one house on every street so the house numbers are counted: the fix has to hold as more streets
// and features turn up, which is where the square hurt.
function scaled(s: S, streetCount: number, featuresPerStreet: number): S {
  const streets = Array.from({ length: streetCount }, (_, i) => ({ id: `s${i}`, name: `Улица ${i}`, kind: "street", digId: 1, at: 0, lines: [[[0, i * 7], [400, i * 7]]] }));
  const foundations = Array.from({ length: streetCount }, (_, i) => ({
    id: `f${i}`,
    ring: [[190, i * 7], [210, i * 7], [210, i * 7 + 20], [190, i * 7 + 20]] as [number, number][],
    area: 400,
    digId: 1,
    at: 0,
  }));
  const features = Array.from({ length: streetCount * featuresPerStreet }, (_, i) => ({ id: `n${i}`, kind: "number" as const, x: (i * 13) % 400, y: (i * 11) % (streetCount * 7), digId: 1 }));
  return { ...s, finds: { ...s.finds, streets, features, foundations } } as S;
}

it("the fixture town: same output, before and after", async () => {
  const f = await loadFixture();
  const st = f.state as S;
  const before = placesViewBefore(st);
  const after = placesView(st);
  expect(after.streets).toEqual(before.streets);
  expect(after.places).toEqual(before.places);
  const row = (name: string, fn: () => unknown) => console.log(`${name.padEnd(30)} ${time(name, fn, { samples: 21 }).median.toFixed(3)} ms`);
  row("placesView before", () => placesViewBefore(st));
  row("placesView after", () => placesView(st));
  console.log(`(40 old streets, ${st.finds.features.length} features, ${st.finds.foundations.length} foundations)`);
}, 300000);

it("the old city grows: the square against one pass per feature", async () => {
  const f = await loadFixture();
  const sizes: [number, number][] = [[10, 2], [20, 2], [40, 2], [80, 2]];
  console.log("\nstreets  features   before ms   after ms");
  for (const [streets, per] of sizes) {
    const st = scaled(f.state as S, streets, per);
    const b = time("before", () => placesViewBefore(st), { samples: 7 }).median;
    const a = time("after", () => placesView(st), { samples: 7 }).median;
    expect(placesView(st).streets).toEqual(placesViewBefore(st).streets);
    console.log(`${String(streets).padEnd(9)}${String(streets * per).padEnd(11)}${b.toFixed(3).padStart(9)}${a.toFixed(3).padStart(11)}`);
  }
}, 300000);
