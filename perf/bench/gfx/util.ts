// Shared timing harness for the renderer microbenchmarks (perf/bench/gfx).
// perf/ is outside tsconfig: these files exist for `npx vitest run perf/bench/gfx/<file>.test.ts` only.
//
// Every number is a median of `runs` >= 5 batches, each batch `reps` repetitions, after a warmup of `warmMs`. Other
// agents share this checkout, so absolute numbers are inflated by CPU contention: compare cases inside one table and
// scale by the per-frame call counts instead of trusting a single figure.

export interface Stat {
  name: string;
  median: number; // ms per operation
  min: number; // ms per operation, fastest batch
  runs: number;
  note: string;
}

const rows: Stat[] = [];
const now = () => performance.now();

export interface Opts {
  runs?: number;
  reps?: number;
  warmMs?: number;
  note?: string;
}

// Median ms per single `fn()` call.
export function measure(name: string, fn: () => void, opts: Opts = {}): Stat {
  const runs = Math.max(5, opts.runs ?? 7);
  const reps = opts.reps ?? 20;
  const warmUntil = now() + (opts.warmMs ?? 40);
  do fn();
  while (now() < warmUntil);
  const samples: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = now();
    for (let i = 0; i < reps; i++) fn();
    samples.push((now() - t0) / reps);
  }
  samples.sort((a, b) => a - b);
  const stat: Stat = { name, median: samples[samples.length >> 1], min: samples[0], runs, note: opts.note ?? "" };
  rows.push(stat);
  return stat;
}

// A number that takes a whole operation some ms: fewer reps, still >= 5 runs.
export function measureSlow(name: string, fn: () => void, opts: Opts = {}): Stat {
  return measure(name, fn, { reps: 1, warmMs: 0, ...opts });
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const num = (v: number) => (v >= 100 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(4) : v.toFixed(6));

// Prints the rows collected so far as an aligned table and clears them.
export function table(title: string, footnote = ""): void {
  const w1 = Math.max(...rows.map((r) => r.name.length), 8);
  console.log(`\n== ${title}`);
  console.log(`${pad("case", w1)}  ${pad("median ms", 10)}  ${pad("min ms", 9)}  runs  note`);
  console.log("-".repeat(w1 + 44));
  for (const r of rows) console.log(`${pad(r.name, w1)}  ${pad(num(r.median), 10)}  ${pad(num(r.min), 9)}  ${String(r.runs).padEnd(4)}  ${r.note}`);
  if (footnote) console.log(footnote);
  rows.length = 0;
}

// Deterministic pseudo-random numbers: the same polygons on every run.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A closed ring of `n` vertices in a jittered circle: a town block, a field, a forest patch.
export function ring(n: number, r: number, cx = 0, cy = 0, rnd: () => number = rng(1)): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.82 + 0.36 * rnd());
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

export function flat(ringPts: readonly [number, number][]): number[] {
  const out: number[] = [];
  for (const [x, y] of ringPts) out.push(x, y);
  return out;
}
