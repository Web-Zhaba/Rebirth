import { isCleared, landOver } from "../sim/clearing";
import type { Clearing, Site } from "../sim/types";
import type { Frame } from "./frame";
import { landAt, type Land } from "./landcover";

export const SITE_STEP = 28; // m between land samples

export type LandSampler = (x: number, y: number) => Promise<Land>;

export const NO_SITE: Site = { forest: 0, water: 0, rock: 0 };

// Sample points of a square grid that fall inside the circle (always at least the centre).
export function sitePoints(cx: number, cy: number, radius: number, step = SITE_STEP): [number, number][] {
  const n = Math.floor(radius / step);
  const pts: [number, number][] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (Math.hypot(i * step, j * step) <= radius) pts.push([cx + i * step, cy + j * step]);
    }
  }
  return pts.length > 0 ? pts : [[cx, cy]];
}

// Shares 0..1 of forest, water and rock-or-sand among the samples.
export function sharesOf(lands: readonly Land[]): Site {
  if (lands.length === 0) return { ...NO_SITE };
  let forest = 0;
  let water = 0;
  let rock = 0;
  for (const l of lands) {
    if (l === "forest") forest++;
    else if (l === "water") water++;
    else if (l === "rock" || l === "sand") rock++;
  }
  return { forest: forest / lands.length, water: water / lands.length, rock: rock / lands.length };
}

export async function sampleSite(cx: number, cy: number, radius: number, sampler: LandSampler, step = SITE_STEP): Promise<Site> {
  const lands = await Promise.all(sitePoints(cx, cy, radius, step).map(([x, y]) => sampler(x, y)));
  return sharesOf(lands);
}

// ---------- cache for the placement tool ----------

const cache = new Map<string, { site?: Site; promise: Promise<Site> }>();
// The count of finished clearings is part of the key: a new one changes the land.
const keyOf = (cx: number, cy: number, radius: number, clearings: readonly Clearing[]) =>
  `${Math.round(cx * 2)},${Math.round(cy * 2)},${radius},${clearings.filter(isCleared).length}`;

// Already measured shares for this lot, or null while unknown.
export function cachedSite(cx: number, cy: number, radius: number, clearings: readonly Clearing[] = []): Site | null {
  return cache.get(keyOf(cx, cy, radius, clearings))?.site ?? null;
}

// Measures (once per lot) and caches the shares; never blocks, failures are not cached.
export function siteAt(f: Frame, cx: number, cy: number, radius: number, clearings: readonly Clearing[] = []): Promise<Site> {
  const key = keyOf(cx, cy, radius, clearings);
  const hit = cache.get(key);
  if (hit) return hit.promise;
  const sampler: LandSampler = (x, y) => {
    const [lng, lat] = f.toLngLat(x, y);
    return landAt(lng, lat).then((l) => landOver(l, x, y, clearings));
  };
  const entry: { site?: Site; promise: Promise<Site> } = {
    promise: sampleSite(cx, cy, radius, sampler).then(
      (site) => {
        entry.site = site;
        return site;
      },
      (e) => {
        cache.delete(key);
        throw e;
      },
    ),
  };
  cache.set(key, entry);
  return entry.promise;
}
