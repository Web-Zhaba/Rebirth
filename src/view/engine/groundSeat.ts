import type { Engine } from "../../engine/engine";
import { lngLatToTile, tileKey } from "../../engine/geo/mercator";
import { DEM_MAX_ZOOM } from "../../engine/terrain/heightPages";

// Meshes seated once on the engine's CPU ground (town models, ruins, fields) take their heights from the finest DEM page
// resident at that moment, and right after a load that is a coarse stand-in (z0-z2) far off the drawn ground. This
// remembers how fine the ground was under the seated points and says when finer pages have come, to seat them again.
// Every point of one z11 tile is answered from the same page, so one point per tile is enough.
export class GroundSeat {
  private at: [number, number][] = []; // lat, lng
  private zoom: number[] = [];

  constructor(private readonly engine: Engine) {}

  seated(points: Iterable<readonly [number, number]>): void {
    const one = new Map<number, [number, number]>();
    for (const [lat, lng] of points) {
      const f = lngLatToTile(lng, lat, DEM_MAX_ZOOM);
      const k = tileKey(DEM_MAX_ZOOM, Math.floor(f.x), Math.floor(f.y));
      if (!one.has(k)) one.set(k, [lat, lng]);
    }
    this.at = [...one.values()];
    this.zoom = this.at.map(([lat, lng]) => this.engine.groundZoomAt(lat, lng));
  }

  finer(): boolean {
    return this.at.some(([lat, lng], i) => this.engine.groundZoomAt(lat, lng) > this.zoom[i]);
  }
}
