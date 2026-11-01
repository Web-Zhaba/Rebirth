import type { DemRequest, DemResponse } from "../bake/demWorker";
import { keyToTile } from "../geo/mercator";
import { RequestScheduler } from "./scheduler";

// DEM streaming: the scheduler (scheduler.ts) decides what to fetch, the bake worker fetches and decodes, finished
// pages queue here for upload. Coarse pages go first (lower priority value) so a parent is there to fall back on while
// children load. Transient failures retry with backoff; missing tiles and given-up ones are left to the parent page.

export interface DemPage {
  key: number;
  heights: Float32Array<ArrayBuffer>; // bordered page, raw metres
  blocks: Float32Array<ArrayBuffer>; // per-block min/max (bake/terrarium.ts blockRanges)
  min: number;
  max: number;
}

const MAX_READY = 32; // decoded pages held back while the page pool is full

export class DemStream {
  private worker: Worker;
  private readonly sched: RequestScheduler;
  private ready: DemPage[] = [];
  private readyKeys = new Set<number>();
  fetched = 0;
  failures = 0;
  bakeMs = 0;

  constructor(maxInFlight = 8) {
    this.worker = new Worker(new URL("../bake/demWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<DemResponse>) => this.done(e.data);
    this.worker.onerror = (e) => console.error("[engine] DEM worker error", e.message);
    this.sched = new RequestScheduler(
      {
        start: (id, key) => {
          const t = keyToTile(key);
          this.worker.postMessage({ type: "load", id, z: t.z, x: t.x, y: t.y } satisfies DemRequest);
        },
        cancel: (id) => this.worker.postMessage({ type: "cancel", id } satisfies DemRequest),
      },
      { maxInFlight },
    );
  }

  beginFrame(): void {
    this.sched.beginFrame();
  }

  want(key: number, priority: number): void {
    if (this.readyKeys.has(key)) return;
    this.sched.want(key, priority);
  }

  pump(): void {
    this.sched.pump();
  }

  // Up to `n` decoded pages for upload, oldest first (the per-frame upload budget lives with the caller).
  take(n: number): DemPage[] {
    const out = this.ready.splice(0, n);
    for (const p of out) this.readyKeys.delete(p.key);
    return out;
  }

  // Decoded pages the caller could not place (pool full): keep a few for a later frame instead of fetching them again;
  // beyond that they are dropped and fetched again if still wanted.
  putBack(pages: DemPage[]): void {
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i];
      if (this.readyKeys.has(p.key) || this.ready.length >= MAX_READY) continue;
      this.ready.unshift(p);
      this.readyKeys.add(p.key);
    }
  }

  get decoded(): number {
    return this.ready.length;
  }

  // Missing upstream or given up on after retries: stop waiting, the parent page stands in.
  isFailed(key: number): boolean {
    return this.sched.isDead(key);
  }

  isLoading(key: number): boolean {
    return this.sched.state(key) === "running";
  }

  // Wanted-but-not-started, running and decoded-but-not-uploaded: zero means the view has everything it asked for.
  get pending(): number {
    return this.sched.pending + this.ready.length;
  }

  get running(): number {
    return this.sched.inFlight;
  }

  get stats(): { missing: number; failed: number; cancelled: number; retries: number } {
    return { missing: this.sched.missingCount, failed: this.sched.failedCount, cancelled: this.sched.cancelled, retries: this.sched.retries };
  }

  private done(r: DemResponse): void {
    if (r.ok) {
      const key = this.sched.succeeded(r.id);
      if (key === undefined) return; // cancelled meanwhile
      this.fetched++;
      this.bakeMs += r.ms;
      this.ready.push({ key, heights: r.heights, blocks: r.blocks, min: r.min, max: r.max });
      this.readyKeys.add(key);
      return;
    }
    if (r.status === -1) return; // our own cancel
    const state = this.sched.failed(r.id, r.status);
    if (state === undefined || state === "missing") return;
    this.failures++;
    if (state === "failed") console.warn("[engine] DEM tile given up after retries", r.status, r.error);
  }

  dispose(): void {
    this.worker.terminate();
  }
}
