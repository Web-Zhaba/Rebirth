// Bookkeeping for asynchronous GPU timer queries: a query is issued during frame N and its result is only
// available a few frames later. Pure logic; the GL calls are injected so it can be tested without a context.

export type QueryPoll = "pending" | "lost" | number; // number = elapsed ms

export class QueryRing<Q> {
  private open: Q[] = [];
  readonly samples: number[] = [];
  lost = 0; // queries whose result was discarded (GPU_DISJOINT, or never answered)

  constructor(
    private readonly poll: (q: Q) => QueryPoll,
    private readonly release: (q: Q) => void,
    private readonly maxOpen = 16,
  ) {}

  add(q: Q): void {
    this.open.push(q);
    // A driver that never answers must not grow the list without bound.
    while (this.open.length > this.maxOpen) {
      this.release(this.open.shift()!);
      this.lost++;
    }
  }

  // Collect finished queries in issue order; stop at the first one still pending so the order is kept.
  drain(): void {
    while (this.open.length) {
      const r = this.poll(this.open[0]);
      if (r === "pending") return;
      this.release(this.open.shift()!);
      if (r === "lost") this.lost++;
      else this.samples.push(r);
    }
  }

  get pending(): number {
    return this.open.length;
  }

  // Collect what is ready and give up on the rest.
  flush(): void {
    this.drain();
    for (const q of this.open.splice(0)) {
      this.release(q);
      this.lost++;
    }
  }
}
