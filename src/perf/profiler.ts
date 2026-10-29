export interface PerfSummary {
  durationMs: number;
  frames: number;
  fps: number;
  frameMs: { avg: number; p50: number; p95: number; p99: number; max: number };
  longFrames: { over16: number; over33: number; over50: number; over100: number };
  longTasks: { count: number; totalMs: number; maxMs: number };
  memory?: { usedMB: number; totalMB: number; limitMB: number };
}

type Sample = { t: number; dt: number };
const pct = (a: number[], p: number) => a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : 0;
const mb = (n: number) => Math.round((n / 1048576) * 10) / 10;

export class PerfProfiler {
  private running = false;
  private start = 0;
  private last = 0;
  private raf = 0;
  private frames: Sample[] = [];
  private longTasks: number[] = [];
  private observer?: PerformanceObserver;

  startCapture(): void {
    if (this.running) return;
    this.running = true;
    this.start = this.last = performance.now();
    this.frames = [];
    this.longTasks = [];
    if ("PerformanceObserver" in window) {
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) this.longTasks.push(e.duration);
        });
        this.observer.observe({ type: "longtask", buffered: true });
      } catch { /* unsupported browser */ }
    }
    const tick = (t: number) => {
      if (!this.running) return;
      const dt = t - this.last;
      this.last = t;
      if (dt > 0 && dt < 2000) this.frames.push({ t, dt });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopCapture(): PerfSummary {
    if (!this.running) return this.summary();
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.observer = undefined;
    return this.summary();
  }

  reset(): void {
    this.stopCapture();
    this.frames = [];
    this.longTasks = [];
    this.start = performance.now();
  }

  summary(): PerfSummary {
    const now = performance.now();
    const values = this.frames.map((x) => x.dt).sort((a,b) => a-b);
    const sum = values.reduce((a,b) => a+b, 0);
    const durationMs = Math.max(0, now - this.start);
    const avg = values.length ? sum / values.length : 0;
    const lt = this.longTasks;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize:number; totalJSHeapSize:number; jsHeapSizeLimit:number } }).memory;
    return {
      durationMs: Math.round(durationMs),
      frames: values.length,
      fps: avg ? Math.round((1000 / avg) * 10) / 10 : 0,
      frameMs: { avg: Math.round(avg*100)/100, p50: pct(values,.5), p95: pct(values,.95), p99: pct(values,.99), max: values.at(-1) ?? 0 },
      longFrames: { over16: values.filter(x=>x>16.7).length, over33: values.filter(x=>x>33.3).length, over50: values.filter(x=>x>50).length, over100: values.filter(x=>x>100).length },
      longTasks: { count: lt.length, totalMs: Math.round(lt.reduce((a,b)=>a+b,0)), maxMs: Math.round(Math.max(0,...lt)) },
      ...(memory ? { memory: { usedMB: mb(memory.usedJSHeapSize), totalMB: mb(memory.totalJSHeapSize), limitMB: mb(memory.jsHeapSizeLimit) } } : {}),
    };
  }
}

export const perfProfiler = new PerfProfiler();

export async function measure<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
  performance.mark(name + ":start");
  try { return await fn(); }
  finally {
    performance.mark(name + ":end");
    performance.measure(name, name + ":start", name + ":end");
  }
}
