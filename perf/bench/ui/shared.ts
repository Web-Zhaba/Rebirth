// Shared bits of the UI benchmarks: the tool cards of the build bar, and life data of the size the worker sends.
import { toolInfo, CATEGORIES } from "../../../src/ui/buildMenu";
import type { Rest, Trip } from "../../../src/map/life";

/** The build bar's hover cards: one per tool of every category (BuildBar.tsx `Card`, the same call per tool). */
export function buildMenuTools(): string[] {
  const out: string[] = [];
  for (const c of CATEGORIES) for (const t of c.tools) out.push(toolInfo(t).label);
  return out;
}

/** A day of life as sim/life.ts posts it for a town of `residents`: one commute and one evening walk for most of them. */
export function lifeOf(residents: number, seed = 7): { trips: Trip[]; rests: Rest[] } {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const trips: Trip[] = [];
  const rests: Rest[] = [];
  for (let i = 0; i < residents; i++) {
    const who = i + 1;
    const home: [number, number] = [rand() * 3000, (rand() > 0.5 ? 1 : -1) * (10 + rand() * 20)];
    const job: [number, number] = [rand() * 3000, (rand() > 0.5 ? 1 : -1) * (10 + rand() * 20)];
    const walk = (pts: [number, number][], depart: number, purpose: "work" | "home" | "tavern"): void => {
      trips.push({ id: trips.length + 1, kind: "walk", pts, depart, speed: 60, who, sex: i % 2 ? "f" : "m", age: 20 + (i % 50), purpose });
    };
    walk([home, [(home[0] + job[0]) / 2, (home[1] + job[1]) / 2], job], 7 * 60 + Math.floor(rand() * 60), "work");
    if (i % 2 === 0) walk([job, home], 18 * 60 + Math.floor(rand() * 90), "home");
    if (i % 3 === 0) walk([home, job], 19 * 60 + Math.floor(rand() * 120), "tavern");
    rests.push({ who, sex: i % 2 ? "f" : "m", age: 20 + (i % 50), home: i % 5 === 0 ? home : null, work: { at: job, from: 7 * 60, to: 17 * 60 } });
  }
  return { trips, rests };
}
