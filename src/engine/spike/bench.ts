import { SCENES, type BenchCamera, type BenchScene } from "../../bench/scenes";
import { summarize, type BenchResult } from "../../bench/stats";

// N0 benchmark on the spike: the shared scenes of src/bench/scenes.ts, on a 1280 x 720 CSS px canvas. Per scene:
// jump to t = 0, wait for the terrain to settle (no DEM pending, selection unchanged for a while; 30 s cap), warm up
// for 2 s, then fly the path for scene.seconds recording CPU, rAF interval and GPU pass time.

export interface FrameSample {
  now: number; // rAF timestamp
  cpu: number; // ms spent building and submitting the frame
  interval: number; // ms since the previous rAF
}

export interface BenchHost {
  setCamera(c: BenchCamera): void;
  onFrame(cb: (s: FrameSample) => void): () => void;
  onGpu(cb: (ms: number) => void): () => void;
  settled(): { pending: number; hash: number };
  canvasSize(): [number, number];
  hasGpuTimer: boolean;
}

const SETTLE_FRAMES = 30;
const SETTLE_TIMEOUT = 30_000;
const WARMUP = 2_000;

const nextFrame = (host: BenchHost) =>
  new Promise<FrameSample>((resolve) => {
    const off = host.onFrame((s) => {
      off();
      resolve(s);
    });
  });

async function settle(host: BenchHost): Promise<boolean> {
  const t0 = performance.now();
  let stable = 0;
  let last = -1;
  while (performance.now() - t0 < SETTLE_TIMEOUT) {
    await nextFrame(host);
    const s = host.settled();
    stable = s.pending === 0 && s.hash === last ? stable + 1 : 0;
    last = s.hash;
    if (stable >= SETTLE_FRAMES) return true;
  }
  return false;
}

export async function runScene(host: BenchHost, scene: BenchScene, variant = "terrain"): Promise<BenchResult> {
  host.setCamera(scene.at(0));
  const settled = await settle(host);
  if (!settled) console.warn(`[bench] ${scene.id}: terrain did not settle in ${SETTLE_TIMEOUT / 1000} s, measuring anyway`);
  const w0 = performance.now();
  while (performance.now() - w0 < WARMUP) await nextFrame(host);

  const cpu: number[] = [];
  const interval: number[] = [];
  const gpu: number[] = [];
  let measuring = true;
  const offGpu = host.onGpu((ms) => {
    if (measuring) gpu.push(ms);
  });
  const start = performance.now();
  const ms = scene.seconds * 1000;
  let first = true;
  await new Promise<void>((resolve) => {
    const off = host.onFrame((s) => {
      const t = (s.now - start) / ms;
      if (!first) {
        cpu.push(s.cpu);
        interval.push(s.interval);
      }
      first = false;
      if (t >= 1) {
        off();
        resolve();
        return;
      }
      host.setCamera(scene.at(Math.max(0, t)));
    });
  });
  // GPU results trail by a few frames.
  await new Promise((r) => setTimeout(r, 150));
  measuring = false;
  offGpu();
  return {
    engine: "next",
    scene: scene.id,
    variant,
    canvas: host.canvasSize(),
    gpu: host.hasGpuTimer && gpu.length ? summarize(gpu) : null,
    cpu: summarize(cpu),
    interval: summarize(interval),
  };
}

export async function runBench(host: BenchHost, which: string): Promise<BenchResult[]> {
  const scenes = which === "all" ? SCENES : SCENES.filter((s) => s.id === which);
  if (!scenes.length) throw new Error(`unknown bench scene: ${which}`);
  const results: BenchResult[] = [];
  for (const s of scenes) {
    console.info(`[bench] ${s.id}: ${s.label}`);
    results.push(await runScene(host, s));
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  console.table(
    results.map((b) => ({
      scene: b.scene,
      frames: b.cpu.frames,
      "gpu med": b.gpu ? r(b.gpu.median) : null,
      "gpu p95": b.gpu ? r(b.gpu.p95) : null,
      "cpu med": r(b.cpu.median),
      "cpu p95": r(b.cpu.p95),
      "interval med": r(b.interval.median),
      "interval p95": r(b.interval.p95),
    })),
  );
  (window as unknown as { __benchResult: BenchResult[] }).__benchResult = results;
  return results;
}
