import type { Engine } from "../../engine/engine";
import { lngLatToTile, tileKey } from "../../engine/geo/mercator";
import { DEM_MAX_ZOOM } from "../../engine/terrain/heightPages";

// Meshes seated once on the engine's CPU ground (town models, ruins, fields) take their heights from the finest DEM page
// resident at that moment, and right after a load that is a coarse stand-in (z0-z2) far off the drawn ground. This
// remembers how fine the ground was under the seated points and says when the final ground has come, to seat them
// again. Every point of one z11 tile is answered from the same page, so one point per tile is enough. Those z11 pages
// are asked for and held in the pool (HeightPages.hold) whatever the camera does, and the seat waits for all of them
// before it calls for a new seating: re-seating on each finer page as it came, or as pages came and went with the
// camera, rebuilt the whole town (over a second for a large revealed old city) several times over.
export class GroundSeat {
  private at: [number, number][] = []; // lat, lng
  private zoom: number[] = [];
  private keys: number[] = [];

  constructor(private readonly engine: Engine) {}

  // The points the mesh will stand on: their z11 pages are wanted and held from now on.
  cover(points: Iterable<readonly [number, number]>): void {
    const one = new Map<number, [number, number]>();
    for (const [lat, lng] of points) {
      const f = lngLatToTile(lng, lat, DEM_MAX_ZOOM);
      const k = tileKey(DEM_MAX_ZOOM, Math.floor(f.x), Math.floor(f.y));
      if (!one.has(k)) one.set(k, [lat, lng]);
    }
    const pages = this.engine.terrain.pages;
    for (const k of one.keys()) pages.hold(k);
    for (const k of this.keys) pages.release(k);
    this.keys = [...one.keys()];
    this.at = [...one.values()];
  }

  // Every z11 page under the cover has come (or does not exist upstream): the ground will not get finer.
  settled(): boolean {
    const { pages, stream } = this.engine.terrain;
    return this.keys.every((k) => pages.has(k) || stream.isFailed(k));
  }

  // The mesh was seated on the ground there is now.
  seated(): void {
    this.zoom = this.at.map(([lat, lng]) => this.engine.groundZoomAt(lat, lng));
  }

  // The final ground is in and is finer than the mesh was seated on.
  finer(): boolean {
    return this.settled() && this.at.some(([lat, lng], i) => this.engine.groundZoomAt(lat, lng) > this.zoom[i]);
  }
}
