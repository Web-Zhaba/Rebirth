import { landOver } from "../sim/clearing";
import type { TerrainProfile } from "../sim/roads";
import type { Clearing } from "../sim/types";
import type { Frame } from "./frame";
import { landAt } from "./landcover";
import { terrainAt } from "./terrain";

export const PROFILE_STEP = 10; // m, nominal spacing of samples

// Samples a local segment in equal pieces of about PROFILE_STEP: elevation at the piece
// boundaries, land type at piece midpoints. Tiles are cached, so repeated calls are cheap.
export async function sampleProfile(frame: Frame, a: [number, number], b: [number, number], clearings: readonly Clearing[] = []): Promise<TerrainProfile> {
  return samplePathProfile(frame, [a, b], clearings);
}

// Samples a polyline (a curved road) in equal pieces of about PROFILE_STEP along its arc length.
export async function samplePathProfile(frame: Frame, pts: readonly [number, number][], clearings: readonly Clearing[] = []): Promise<TerrainProfile> {
  const clean: [number, number][] = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) clean.push([p[0], p[1]]);
  }
  if (clean.length < 2) return { length: 0, land: [], elev: [] };
  const cum = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + Math.hypot(clean[i][0] - clean[i - 1][0], clean[i][1] - clean[i - 1][1]));
  const length = cum[cum.length - 1];
  if (length < 1e-6) return { length: 0, land: [], elev: [] };
  const pieces = Math.max(1, Math.round(length / PROFILE_STEP));
  let seg = 1;
  const local = (d: number): [number, number] => {
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const a = clean[seg - 1];
    const b = clean[seg];
    const span = cum[seg] - cum[seg - 1];
    const t = span < 1e-9 ? 0 : (d - cum[seg - 1]) / span;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const elevs: Promise<number>[] = [];
  const lands: ReturnType<typeof landAt>[] = [];
  for (let i = 0; i <= pieces; i++) {
    const [lng, lat] = frame.toLngLat(...local((length * i) / pieces));
    elevs.push(terrainAt(lng, lat).then((t) => t.elevation));
  }
  seg = 1;
  for (let i = 0; i < pieces; i++) {
    const [x, y] = local((length * (i + 0.5)) / pieces);
    const [lng, lat] = frame.toLngLat(x, y);
    lands.push(landAt(lng, lat).then((l) => landOver(l, x, y, clearings))); // cleared forest is meadow
  }
  const [elev, land] = await Promise.all([Promise.all(elevs), Promise.all(lands)]);
  return { length, land, elev };
}
