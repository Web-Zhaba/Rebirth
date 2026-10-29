import type maplibregl from "maplibre-gl";
import { perfProfiler, type PerfSummary } from "./profiler";
import { reliefOn } from "../map/relief";
import { forest3dOn, water3dOn, fields3dOn, smoke3dOn, motionOn } from "../map/graphicsSettings";
import { cloudsOn } from "../map/clouds/settings";

export interface BenchmarkCaseResult {
  id: string;
  label: string;
  durationMs: number;
  metrics: PerfSummary;
  delta: { fps: number; p95Ms: number; p99Ms: number; slow33: number };
  measures: Record<string, { count: number; avgMs: number; p95Ms: number; maxMs: number; totalMs: number }>;
  diagnostics: Record<string, unknown>;
  mapRender: { count: number; avgIntervalMs: number; p95IntervalMs: number; maxIntervalMs: number };
}

export interface BenchmarkSuiteResult {
  capturedAt: string;
  userAgent: string;
  location: { lat: number; lng: number; zoom: number; pitch: number; bearing: number };
  config: { warmupMs: number; settleMs: number; captureMs: number };
  environment: { hardwareConcurrency: number; deviceMemoryGB?: number; devicePixelRatio: number; viewport: [number, number]; screen: [number, number] };
  cases: BenchmarkCaseResult[];
  ranking: { id: string; label: string; fpsGain: number; p95GainMs: number }[];
}

type Switches = {
  relief: boolean;
  forest: boolean;
  water: boolean;
  fields: boolean;
  smoke: boolean;
  motion: boolean;
  clouds: boolean;
  models: boolean;
};

const MODEL_LAYERS = ["building-models", "building-lamps"] as const;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const round = (n: number) => Math.round(n * 100) / 100;
const pct = (a: number[], p: number) => a.length ? a[Math.min(a.length - 1, Math.floor((a.length - 1) * p))] : 0;

function summarizeMeasures(): BenchmarkCaseResult["measures"] {
  const groups = new Map<string, number[]>();
  for (const e of performance.getEntriesByType("measure")) {
    const a = groups.get(e.name) ?? [];
    a.push(e.duration);
    groups.set(e.name, a);
  }
  return Object.fromEntries([...groups].map(([name, values]) => {
    const s = [...values].sort((a,b) => a-b);
    const total = s.reduce((a,b) => a+b, 0);
    return [name, { count: s.length, avgMs: round(total / s.length), p95Ms: round(pct(s,.95)), maxMs: round(s.at(-1) ?? 0), totalMs: round(total) }];
  }));
}

function diagnostics(): Record<string, unknown> {
  const w = window as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const name of ["treeStats","modelStats","waterStats","fieldStats","cloudStats","shadowStats","landscapeStats"]) {
    const fn = w[name];
    if (typeof fn === "function") {
      try { out[name] = (fn as () => unknown)(); } catch { /* diagnostic only */ }
    }
  }
  return out;
}

function modelVisibility(map: maplibregl.Map): Record<string,string | undefined> {
  return Object.fromEntries(MODEL_LAYERS.map((id) => [id, map.getLayer(id) ? (map.getLayoutProperty(id, "visibility") as string | undefined) : undefined]));
}

function setModels(map: maplibregl.Map, on: boolean): void {
  for (const id of MODEL_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  map.triggerRepaint();
}

function apply(map: maplibregl.Map, s: Switches): void {
  reliefOn.value = s.relief;
  forest3dOn.value = s.forest;
  water3dOn.value = s.water;
  fields3dOn.value = s.fields;
  smoke3dOn.value = s.smoke;
  motionOn.value = s.motion;
  cloudsOn.value = s.clouds;
  setModels(map, s.models);
  map.triggerRepaint();
}

export async function runBenchmarkSuite(
  map: maplibregl.Map,
  onProgress?: (text: string, index: number, total: number) => void,
  cfg: { warmupMs?: number; settleMs?: number; captureMs?: number } = {},
): Promise<BenchmarkSuiteResult> {
  const warmupMs = cfg.warmupMs ?? 2500;
  const settleMs = cfg.settleMs ?? 1800;
  const captureMs = cfg.captureMs ?? 7000;
  const original: Switches = {
    relief: reliefOn.peek(),
    forest: forest3dOn.peek(),
    water: water3dOn.peek(),
    fields: fields3dOn.peek(),
    smoke: smoke3dOn.peek(),
    motion: motionOn.peek(),
    clouds: cloudsOn.peek(),
    models: MODEL_LAYERS.every((id) => !map.getLayer(id) || map.getLayoutProperty(id,"visibility") !== "none"),
  };
  const modelOriginal = modelVisibility(map);
  const base = { ...original };
  const cases: { id:string; label:string; switches:Switches }[] = [
    { id:"baseline", label:"Baseline (current settings)", switches:{...base} },
    { id:"no-relief", label:"Relief off", switches:{...base, relief:false} },
    { id:"no-forest", label:"3D forest off", switches:{...base, forest:false} },
    { id:"no-water", label:"3D water off", switches:{...base, water:false} },
    { id:"no-fields", label:"3D fields off", switches:{...base, fields:false} },
    { id:"no-smoke", label:"Smoke off", switches:{...base, smoke:false} },
    { id:"no-motion", label:"Decorative motion off", switches:{...base, motion:false} },
    { id:"no-clouds", label:"Clouds + shadows off", switches:{...base, clouds:false} },
    { id:"no-models", label:"Building/road 3D models off", switches:{...base, models:false} },
    { id:"terrain-only-ish", label:"Relief with 3D extras off", switches:{...base, forest:false, water:false, fields:false, smoke:false, clouds:false, models:false, motion:false} },
    { id:"flat-minimal", label:"Relief + 3D extras off", switches:{...base, relief:false, forest:false, water:false, fields:false, smoke:false, clouds:false, models:false, motion:false} },
  ];

  const results: BenchmarkCaseResult[] = [];
  try {
    onProgress?.("Warm-up",0,cases.length);
    apply(map, base);
    await sleep(warmupMs);

    for (let i=0;i<cases.length;i++) {
      const c = cases[i];
      onProgress?.(`Settling: ${c.label}`,i,cases.length);
      apply(map,c.switches);
      await sleep(settleMs);
      performance.clearMeasures();
      performance.clearMarks();
      perfProfiler.reset();
      const renderTimes:number[] = [];
      let lastRender = 0;
      const onRender = () => {
        const t = performance.now();
        if (lastRender) renderTimes.push(t - lastRender);
        lastRender = t;
      };
      map.on("render", onRender);
      perfProfiler.startCapture();
      onProgress?.(`Capturing: ${c.label}`,i,cases.length);
      await sleep(captureMs);
      const metrics = perfProfiler.stopCapture();
      map.off("render", onRender);
      const renderSorted=[...renderTimes].sort((a,b)=>a-b);
      const renderTotal=renderSorted.reduce((a,b)=>a+b,0);
      const baseline = results[0]?.metrics ?? metrics;
      results.push({
        id:c.id,
        label:c.label,
        durationMs:captureMs,
        metrics,
        delta:{
          fps:round(metrics.fps-baseline.fps),
          p95Ms:round(baseline.frameMs.p95-metrics.frameMs.p95),
          p99Ms:round(baseline.frameMs.p99-metrics.frameMs.p99),
          slow33:baseline.longFrames.over33-metrics.longFrames.over33,
        },
        measures:summarizeMeasures(),
        diagnostics:diagnostics(),
        mapRender:{
          count:renderTimes.length + (lastRender ? 1 : 0),
          avgIntervalMs:round(renderSorted.length ? renderTotal/renderSorted.length : 0),
          p95IntervalMs:round(pct(renderSorted,.95)),
          maxIntervalMs:round(renderSorted.at(-1) ?? 0),
        },
      });
    }
  } finally {
    reliefOn.value = original.relief;
    forest3dOn.value = original.forest;
    water3dOn.value = original.water;
    fields3dOn.value = original.fields;
    smoke3dOn.value = original.smoke;
    motionOn.value = original.motion;
    cloudsOn.value = original.clouds;
    for (const [id,v] of Object.entries(modelOriginal)) if (map.getLayer(id)) map.setLayoutProperty(id,"visibility",v ?? "visible");
    map.triggerRepaint();
  }

  const center = map.getCenter();
  return {
    capturedAt:new Date().toISOString(),
    userAgent:navigator.userAgent,
    location:{lat:center.lat,lng:center.lng,zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()},
    config:{warmupMs,settleMs,captureMs},
    environment:{
      hardwareConcurrency:navigator.hardwareConcurrency || 0,
      ...(("deviceMemory" in navigator) ? { deviceMemoryGB:(navigator as Navigator & {deviceMemory:number}).deviceMemory } : {}),
      devicePixelRatio:window.devicePixelRatio,
      viewport:[window.innerWidth,window.innerHeight],
      screen:[window.screen.width,window.screen.height],
    },
    cases:results,
    ranking:results.slice(1).map(r=>({id:r.id,label:r.label,fpsGain:r.delta.fps,p95GainMs:r.delta.p95Ms})).sort((a,b)=>b.p95GainMs-a.p95GainMs || b.fpsGain-a.fpsGain),
  };
}
