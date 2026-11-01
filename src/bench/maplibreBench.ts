import type * as maplibregl from "maplibre-gl";
import { city } from "../simClient";
import { reliefOn } from "../map/relief";
import { SCENES, toMapLibre, townScene, type BenchScene } from "./scenes";
import { QueryRing } from "./queryRing";
import { summarize, type BenchResult } from "./stats";

// Benchmark runner for the current MapLibre map (docs/PLAN-engine.md, N0). DEV only: it reaches into MapLibre
// privates (`map._render`, `map.painter.context.gl`) to bracket exactly one MapLibre frame with CPU and GPU
// timers. Nothing here is imported by production code.

export type Variant = "full" | "base";
export interface BenchOptions {
  scenes?: string[]; // scene ids, or ["all"]; default all
  variants?: Variant[]; // default both
  log?: boolean;
}

const WIDTH = 1280;
const HEIGHT = 720;
const WARMUP_MS = 2000;
const IDLE_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Wait until tiles are loaded and the map is idle. Continuous repaint (animated custom layers) can keep 'idle' from
// ever firing, so "tiles and style loaded for a second" counts as settled too.
function settle(map: maplibregl.Map): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let stable = 0;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      map.off("idle", onIdle);
      clearInterval(poll);
      clearTimeout(timer);
      resolve(ok);
    };
    const onIdle = () => finish(true);
    map.on("idle", onIdle);
    map.triggerRepaint();
    const poll = setInterval(() => {
      stable = map.areTilesLoaded() ? stable + 1 : 0;
      if (stable >= 5) finish(true);
    }, 200);
    const timer = setTimeout(() => finish(false), IDLE_TIMEOUT_MS);
  });
}

// "base": hide our custom layers (three.js: models, trees, water, fields, smoke, clouds, shadows) and the game's
// GeoJSON overlays; keep MapLibre's base style, hillshade and terrain.
function hideGameLayers(map: maplibregl.Map): () => void {
  const undo: (() => void)[] = [];
  for (const id of map.getLayersOrder()) {
    const layer = map.getLayer(id) as any;
    if (!layer) continue;
    if (layer.type === "custom") {
      // Private API: custom layers have no layout properties, but MapLibre skips a layer whose isHidden() is true.
      const own = Object.prototype.hasOwnProperty.call(layer, "isHidden");
      const prev = layer.isHidden;
      layer.isHidden = () => true;
      undo.push(() => {
        if (own) layer.isHidden = prev;
        else delete layer.isHidden;
      });
    } else if (layer.source && map.getSource(layer.source)?.type === "geojson") {
      const prev = map.getLayoutProperty(id, "visibility");
      map.setLayoutProperty(id, "visibility", "none");
      undo.push(() => map.setLayoutProperty(id, "visibility", prev ?? "visible"));
    }
  }
  map.triggerRepaint();
  return () => undo.forEach((f) => f());
}

// Wraps map._render (private) and records, per MapLibre frame: CPU ms and a GPU timer query.
class FrameProbe {
  cpu: number[] = [];
  ring: QueryRing<WebGLQuery> | null = null;
  recording = false;
  private readonly orig: (t: number) => unknown;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: any;

  constructor(private readonly map: any) {
    this.gl = map.painter.context.gl;
    this.ext = this.gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.orig = map._render;
    const self = this;
    map._render = function (this: unknown, t: number) {
      return self.frame(this, t);
    };
    if (this.ext) {
      const gl = this.gl;
      const ext = this.ext;
      this.ring = new QueryRing<WebGLQuery>(
        (q) => {
          if (gl.getParameter(ext.GPU_DISJOINT_EXT)) return "lost";
          if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return "pending";
          return (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        },
        (q) => gl.deleteQuery(q),
      );
    }
  }

  get gpuAvailable(): boolean {
    return this.ring !== null;
  }

  private frame(self: unknown, t: number): unknown {
    if (!this.recording) return this.orig.call(self, t);
    const { gl, ext, ring } = this;
    ring?.drain();
    const q = ring ? gl.createQuery() : null;
    if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    const t0 = performance.now();
    const res = this.orig.call(self, t);
    this.cpu.push(performance.now() - t0);
    if (q) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      ring!.add(q);
    }
    return res;
  }

  // Results arrive a few frames late: give the last queries time to resolve.
  async finish(): Promise<number[] | null> {
    this.recording = false;
    if (!this.ring) return null;
    for (let i = 0; i < 20 && this.ring.pending; i++) {
      await sleep(50);
      this.ring.drain();
    }
    this.ring.flush();
    return this.ring.samples;
  }

  dispose(): void {
    (this.map as any)._render = this.orig;
  }
}

type Row = BenchResult & { note?: string };

async function runScene(map: maplibregl.Map, scene: BenchScene, variant: Variant, reliefForced: boolean): Promise<Row> {
  const probe = new FrameProbe(map);
  const restore = variant === "base" ? hideGameLayers(map) : null;
  const notes: string[] = [];
  try {
    map.jumpTo(toMapLibre(scene.at(0), HEIGHT));
    if (!(await settle(map))) notes.push("settle timeout");
    // Warm-up with the same motion, not measured.
    const warmStart = performance.now();
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        map.jumpTo(toMapLibre(scene.at(Math.min(1, (now - warmStart) / (scene.seconds * 1000))), HEIGHT));
        if (now - warmStart >= WARMUP_MS) resolve();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    map.jumpTo(toMapLibre(scene.at(0), HEIGHT));
    await sleep(100);

    const intervals: number[] = [];
    probe.recording = true;
    const start = performance.now();
    let last = start;
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        intervals.push(now - last);
        last = now;
        const t = (now - start) / (scene.seconds * 1000);
        if (t >= 1) return resolve();
        map.jumpTo(toMapLibre(scene.at(t), HEIGHT));
        map.triggerRepaint();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    const gpu = await probe.finish();
    const canvas = map.getCanvas();
    const out: Row = {
      engine: "maplibre",
      scene: scene.id,
      variant,
      canvas: [canvas.width, canvas.height],
      gpu: gpu && gpu.length ? summarize(gpu) : null,
      cpu: summarize(probe.cpu),
      interval: summarize(intervals.slice(1)),
    };
    if (!probe.gpuAvailable) notes.push("no EXT_disjoint_timer_query_webgl2");
    else if (probe.ring!.lost) notes.push(`${probe.ring!.lost} gpu samples lost`);
    if (reliefForced) notes.push("relief forced on");
    if (notes.length) out.note = notes.join("; ");
    return out;
  } finally {
    probe.recording = false;
    probe.dispose();
    restore?.();
  }
}

export async function runMapLibreBench(map: maplibregl.Map, opts: BenchOptions = {}): Promise<BenchResult[]> {
  const variants = opts.variants ?? ["full", "base"];
  const scenes: BenchScene[] = [...SCENES];
  const c = city.value;
  if (c) scenes.push(townScene(c.lat, c.lng));
  const ids = opts.scenes;
  const wanted = ids && ids.length && !ids.includes("all") ? scenes.filter((s) => ids.includes(s.id)) : scenes;

  await sleep(2000); // let the attach* functions finish adding their layers
  const container = map.getContainer();
  const saved = { width: container.style.width, height: container.style.height, flex: container.style.flex };
  const camBefore = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  const reliefBefore = reliefOn.peek();
  const results: Row[] = [];
  try {
    container.style.width = `${WIDTH}px`;
    container.style.height = `${HEIGHT}px`;
    container.style.flex = "none";
    map.resize();
    // Relief is a player setting (localStorage); set the signal only, so the saved choice is untouched.
    if (!reliefBefore) {
      reliefOn.value = true;
      await sleep(500);
    }
    for (const scene of wanted) {
      for (const variant of variants) {
        const r = await runScene(map, scene, variant, !reliefBefore);
        results.push(r);
        if (opts.log !== false) console.log("[bench]", JSON.stringify(r));
      }
    }
  } finally {
    reliefOn.value = reliefBefore;
    container.style.width = saved.width;
    container.style.height = saved.height;
    container.style.flex = saved.flex;
    map.resize();
    map.jumpTo(camBefore);
  }
  const f = (n: number | undefined) => (n === undefined ? "-" : n.toFixed(2));
  console.table(
    results.map((r) => ({
      scene: r.scene,
      variant: r.variant,
      canvas: r.canvas.join("x"),
      "gpu med": f(r.gpu?.median),
      "gpu p95": f(r.gpu?.p95),
      "cpu med": f(r.cpu.median),
      "cpu p95": f(r.cpu.p95),
      "int med": f(r.interval.median),
      "int p95": f(r.interval.p95),
      frames: r.cpu.frames,
      note: r.note ?? "",
    })),
  );
  (window as any).__benchResult = results;
  return results;
}
