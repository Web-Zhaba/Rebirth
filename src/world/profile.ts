import type { TerrainProfile } from "../sim/roads";
import type { Frame } from "./frame";
import { landAt } from "./landcover";
import { terrainAt } from "./terrain";

export const PROFILE_STEP = 10; // m, nominal spacing of samples

// Samples a local segment in equal pieces of about PROFILE_STEP: elevation at the piece
// boundaries, land type at piece midpoints. Tiles are cached, so repeated calls are cheap.
export async function sampleProfile(frame: Frame, a: [number, number], b: [number, number]): Promise<TerrainProfile> {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pieces = Math.max(1, Math.round(length / PROFILE_STEP));
  const at = (f: number) => frame.toLngLat(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
  const elevs: Promise<number>[] = [];
  const lands: ReturnType<typeof landAt>[] = [];
  for (let i = 0; i <= pieces; i++) {
    const [lng, lat] = at(i / pieces);
    elevs.push(terrainAt(lng, lat).then((t) => t.elevation));
  }
  for (let i = 0; i < pieces; i++) {
    const [lng, lat] = at((i + 0.5) / pieces);
    lands.push(landAt(lng, lat));
  }
  const [elev, land] = await Promise.all([Promise.all(elevs), Promise.all(lands)]);
  return { length, land, elev };
}
