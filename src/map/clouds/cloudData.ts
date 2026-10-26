import type { FromCloudWorker, ToCloudWorker } from "./cloudWorker";

// Main-thread client of the cloud worker: weather cubes and noise volumes as plain buffers (no three.js).

export type CubeResult = Extract<FromCloudWorker, { t: "cube" }>;
export type NoiseResult = { base: ArrayBuffer; detail: ArrayBuffer };

interface Pending {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const cubeJobs = new Map<string, Promise<CubeResult>>();
let noise: Promise<NoiseResult> | null = null;

function start(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL("./cloudWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (e: MessageEvent<FromCloudWorker>) => {
    const m = e.data;
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.t === "error") p.reject(new Error(m.message));
    else if (m.t === "noise") (p.resolve as (v: NoiseResult) => void)({ base: m.base, detail: m.detail });
    else (p.resolve as (v: CubeResult) => void)(m);
  };
  worker = w;
  return w;
}

function call<T>(msg: ToCloudWorker): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    pending.set(msg.id, { resolve: resolve as (v: never) => void, reject });
    start().postMessage(msg);
  });
}

// Duplicate requests for the same (t0, seed, phase, size) share one job and one result.
export function requestCube(t0: number, seed: number, phase: number, size: number): Promise<CubeResult> {
  const key = `${t0}|${seed}|${phase}|${size}`;
  let job = cubeJobs.get(key);
  if (!job) {
    job = call<CubeResult>({ t: "cube", id: nextId++, t0, seed, phase, size });
    cubeJobs.set(key, job);
    const done = () => cubeJobs.delete(key);
    job.then(done, done);
  }
  return job;
}

// Built once per session; a failed attempt is retried by the next call.
export function requestNoise(): Promise<NoiseResult> {
  if (!noise) {
    noise = call<NoiseResult>({ t: "noise", id: nextId++ });
    noise.catch(() => (noise = null));
  }
  return noise;
}

export function dispose(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("disposed"));
  pending.clear();
  cubeJobs.clear();
  noise = null;
}
