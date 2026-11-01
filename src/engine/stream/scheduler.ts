// Request scheduling for streamed tiles, without the I/O (so it runs in vitest): the terrain says each frame which keys
// it wants and how urgent they are (lower = sooner); the scheduler keeps at most `maxInFlight` requests running, most
// urgent first, retries transient failures with exponential backoff up to a cap, remembers tiles that do not exist,
// and cancels running requests nobody has wanted for a while (the camera moved on).

export interface RetryPolicy {
  baseMs: number; // delay after the first failure
  maxMs: number; // ceiling for one delay
  maxAttempts: number; // total tries, the first one included
}

export const DEFAULT_RETRY: RetryPolicy = { baseMs: 1000, maxMs: 30_000, maxAttempts: 5 };

// A missing tile is a normal answer (no data there), not an error: the parent page covers the area. S3 answers 403 for
// keys that do not exist when listing is not allowed. Everything else (network, 5xx, 429, timeouts) is worth a retry.
export function isMissing(status: number): boolean {
  return status === 404 || status === 403 || status === 410 || status === 204;
}

// Delay (ms) before the next try after `failures` failed attempts, or null to give up.
export function retryDelay(failures: number, p: RetryPolicy = DEFAULT_RETRY): number | null {
  if (failures >= p.maxAttempts) return null;
  return Math.min(p.maxMs, p.baseMs * 2 ** (failures - 1));
}

export interface SchedulerIo {
  start(id: number, key: number): void;
  cancel(id: number): void;
}

export interface SchedulerOptions {
  maxInFlight: number;
  cancelAfterFrames: number; // a running request not wanted for this many frames is cancelled
  retry: RetryPolicy;
  now: () => number; // ms
}

interface Running {
  key: number;
  lastWanted: number; // frame
}

export type KeyState = "idle" | "running" | "backoff" | "missing" | "failed";

export class RequestScheduler {
  private nextId = 1;
  private frame = 0;
  private running = new Map<number, Running>(); // id -> request
  private runningKeys = new Map<number, number>(); // key -> id
  private wanted = new Map<number, number>(); // key -> priority, rebuilt every frame
  private failures = new Map<number, { count: number; retryAt: number }>();
  private missing = new Set<number>();
  private gaveUp = new Set<number>();
  private readonly opt: SchedulerOptions;
  cancelled = 0;
  retries = 0;

  constructor(
    private readonly io: SchedulerIo,
    opt: Partial<SchedulerOptions> = {},
  ) {
    this.opt = { maxInFlight: 8, cancelAfterFrames: 90, retry: DEFAULT_RETRY, now: () => performance.now(), ...opt };
  }

  beginFrame(): void {
    this.frame++;
    this.wanted.clear();
  }

  state(key: number): KeyState {
    if (this.runningKeys.has(key)) return "running";
    if (this.missing.has(key)) return "missing";
    if (this.gaveUp.has(key)) return "failed";
    if (this.failures.has(key)) return "backoff";
    return "idle";
  }

  // Missing or given up on: the caller should stop waiting for it.
  isDead(key: number): boolean {
    return this.missing.has(key) || this.gaveUp.has(key);
  }

  want(key: number, priority: number): void {
    const id = this.runningKeys.get(key);
    if (id !== undefined) {
      this.running.get(id)!.lastWanted = this.frame;
      return;
    }
    if (this.isDead(key)) return;
    const f = this.failures.get(key);
    if (f && this.opt.now() < f.retryAt) return;
    const p = this.wanted.get(key);
    if (p === undefined || priority < p) this.wanted.set(key, priority);
  }

  // Cancel stale requests, then start the most urgent wanted keys into the free slots.
  pump(): void {
    for (const [id, r] of this.running)
      if (this.frame - r.lastWanted > this.opt.cancelAfterFrames) {
        this.running.delete(id);
        this.runningKeys.delete(r.key);
        this.cancelled++;
        this.io.cancel(id);
      }
    let free = this.opt.maxInFlight - this.running.size;
    // Repeated minimum instead of a sort: free is small (<= maxInFlight), wanted can be hundreds.
    while (free > 0 && this.wanted.size) {
      let best = -1;
      let bestP = Infinity;
      for (const [k, p] of this.wanted)
        if (p < bestP) {
          bestP = p;
          best = k;
        }
      this.wanted.delete(best);
      const id = this.nextId++;
      this.running.set(id, { key: best, lastWanted: this.frame });
      this.runningKeys.set(best, id);
      if (this.failures.has(best)) this.retries++;
      this.io.start(id, best);
      free--;
    }
  }

  // The request finished with data. Returns its key, or undefined if it was cancelled meanwhile.
  succeeded(id: number): number | undefined {
    const r = this.finish(id);
    if (r === undefined) return undefined;
    this.failures.delete(r);
    return r;
  }

  // The request failed with an HTTP status (0 = network). Returns the key's new state, or undefined if cancelled.
  failed(id: number, status: number): KeyState | undefined {
    const key = this.finish(id);
    if (key === undefined) return undefined;
    if (isMissing(status)) {
      this.failures.delete(key);
      this.missing.add(key);
      return "missing";
    }
    const count = (this.failures.get(key)?.count ?? 0) + 1;
    const delay = retryDelay(count, this.opt.retry);
    if (delay === null) {
      this.failures.delete(key);
      this.gaveUp.add(key);
      return "failed";
    }
    this.failures.set(key, { count, retryAt: this.opt.now() + delay });
    return "backoff";
  }

  // Wanted-but-not-started plus running.
  get pending(): number {
    return this.wanted.size + this.running.size;
  }

  get inFlight(): number {
    return this.running.size;
  }

  get missingCount(): number {
    return this.missing.size;
  }

  get failedCount(): number {
    return this.gaveUp.size;
  }

  private finish(id: number): number | undefined {
    const r = this.running.get(id);
    if (!r) return undefined;
    this.running.delete(id);
    this.runningKeys.delete(r.key);
    return r.key;
  }
}
