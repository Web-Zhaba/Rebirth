import type { DemRequest, DemResponse } from "../bake/demWorker";
import { keyToTile } from "../geo/mercator";

// DEM request scheduler: each frame the terrain says which pages it wants and how urgent they are; the scheduler
// keeps at most `maxInFlight` fetches running, most urgent first, and queues finished pages for upload. Coarse pages
// go first (lower priority value) so a parent is there to fall back on while children load.

export interface DemPage {
  key: number;
  heights: Float32Array<ArrayBuffer>; // bordered page, raw metres
  blocks: Float32Array<ArrayBuffer>; // per-block min/max (bake/terrarium.ts blockRanges)
  min: number;
  max: number;
}

export class DemStream {
  private worker: Worker;
  private nextId = 1;
  private inFlight = new Map<number, number>(); // request id -> page key
  private inFlightKeys = new Set<number>();
  private failed = new Set<number>();
  private wanted = new Map<number, number>(); // key -> priority, rebuilt every frame
  private ready: DemPage[] = [];
  private readyKeys = new Set<number>();
  fetched = 0;
  failures = 0;
  bakeMs = 0;

  constructor(private readonly maxInFlight = 8) {
    this.worker = new Worker(new URL("../bake/demWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<DemResponse>) => this.done(e.data);
    this.worker.onerror = (e) => console.error("[engine] DEM worker error", e.message);
  }

  beginFrame(): void {
    this.wanted.clear();
  }

  want(key: number, priority: number): void {
    if (this.failed.has(key) || this.inFlightKeys.has(key) || this.readyKeys.has(key)) return;
    const p = this.wanted.get(key);
    if (p === undefined || priority < p) this.wanted.set(key, priority);
  }

  // Launch the most urgent wanted pages.
  pump(): void {
    const free = this.maxInFlight - this.inFlight.size;
    if (free <= 0 || this.wanted.size === 0) return;
    const list = [...this.wanted].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < Math.min(free, list.length); i++) {
      const key = list[i][0];
      const id = this.nextId++;
      this.inFlight.set(id, key);
      this.inFlightKeys.add(key);
      const t = keyToTile(key);
      this.worker.postMessage({ id, z: t.z, x: t.x, y: t.y } satisfies DemRequest);
    }
  }

  // Up to `n` decoded pages for upload, oldest first (the per-frame upload budget lives with the caller).
  take(n: number): DemPage[] {
    const out = this.ready.splice(0, n);
    for (const p of out) this.readyKeys.delete(p.key);
    return out;
  }

  get decoded(): number {
    return this.ready.length;
  }

  isFailed(key: number): boolean {
    return this.failed.has(key);
  }

  isLoading(key: number): boolean {
    return this.inFlightKeys.has(key);
  }

  // Wanted-but-not-started, running and decoded-but-not-uploaded: zero means the view has everything it asked for.
  get pending(): number {
    return this.wanted.size + this.inFlight.size + this.ready.length;
  }

  get running(): number {
    return this.inFlight.size;
  }

  private done(r: DemResponse): void {
    const key = this.inFlight.get(r.id);
    if (key === undefined) return;
    this.inFlight.delete(r.id);
    this.inFlightKeys.delete(key);
    if (r.ok) {
      this.fetched++;
      this.bakeMs += r.ms;
      this.ready.push({ key, heights: r.heights, blocks: r.blocks, min: r.min, max: r.max });
      this.readyKeys.add(key);
    } else {
      // Missing tiles stay missing for the session: no retry storm, the parent page covers the area.
      this.failures++;
      this.failed.add(key);
      console.warn("[engine] DEM tile failed", keyToTile(key), r.status, r.error);
    }
  }

  dispose(): void {
    this.worker.terminate();
  }
}
