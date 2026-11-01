import { clampState } from "../camera/camera";
import { createCameraControl } from "../camera/controller";
import { DebugCube } from "../debug/cube";
import { Engine } from "../engine";
import { WebGpuUnavailable } from "../gpu/device";
import { runBench, type BenchHost } from "./bench";

// N0 spike (docs/PLAN-engine.md section 5): globe terrain on raw WebGPU, camera, precision cube and benchmark. Dev page:
// /next.html. URL: lat, lng, d (distance m), hd (heading), p (pitch), cube=lat,lng, orbit=deg/s, tau, lod=1,
// bench=all|<scene id>.

const q = new URLSearchParams(location.search);
const num = (k: string): number | null => {
  const v = q.get(k);
  return v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
};

const canvas = document.getElementById("view") as HTMLCanvasElement;
const benchWhich = q.get("bench");
if (benchWhich) {
  // Fixed CSS size so runs compare across machines and with the MapLibre benchmark.
  canvas.style.width = "1280px";
  canvas.style.height = "720px";
}

function fail(msg: string): void {
  const d = document.createElement("div");
  d.className = "fail";
  d.textContent = msg;
  document.body.append(d);
}

async function main(): Promise<void> {
  let engine: Engine;
  try {
    engine = await Engine.create(canvas);
  } catch (e) {
    fail(e instanceof WebGpuUnavailable ? `WebGPU недоступен: ${e.message}` : String(e));
    throw e;
  }
  const { device } = engine;
  console.info("[engine] adapter:", engine.gpu.info, "timestamps:", engine.gpu.timestamps, "layers:", device.limits.maxTextureArrayLayers);

  const terrain = engine.terrain;
  const tau = num("tau");
  if (tau) terrain.tau = tau;
  const maxZ = num("maxz");
  if (maxZ !== null) terrain.maxZoom = maxZ;
  const cubeAt = q.get("cube")?.split(",").map(Number);
  const cube = cubeAt && cubeAt.length === 2 && cubeAt.every(Number.isFinite) ? new DebugCube(device, engine.target, engine.frameU.layout, cubeAt[0], cubeAt[1]) : null;
  if (cube) engine.drawables.push({ update: (v) => cube.update(v.eye, terrain.groundAt(cube.lat, cube.lng) ?? 0), draw: (pass) => cube.draw(pass) });

  const state = engine.state;
  state.lat = num("lat") ?? (cube ? cube.lat : state.lat);
  state.lng = num("lng") ?? (cube ? cube.lng : state.lng);
  state.distance = num("d") ?? (cube ? 20 : state.distance);
  state.heading = num("hd") ?? state.heading;
  state.pitch = num("p") ?? (cube ? 60 : state.pitch);
  clampState(state);
  const orbit = num("orbit") ?? 0;
  engine.lodTint = q.get("lod") === "1";
  const camera = createCameraControl(engine);

  const hud = document.createElement("pre");
  hud.className = "hud";
  document.body.append(hud);
  let hudAt = 0;
  let cpuAvg = 0;
  engine.onFrame(({ now, cpu, interval }) => {
    if (orbit) {
      state.heading += (orbit * interval) / 1000;
      clampState(state);
    }
    cpuAvg = cpuAvg * 0.95 + cpu * 0.05;
    if (now - hudAt < 250) return;
    hudAt = now;
    const s = terrain.stats;
    const v = engine.view!;
    hud.textContent = [
      `frame ${interval.toFixed(1)} ms  cpu ${cpuAvg.toFixed(2)} ms  gpu ${engine.timer ? engine.timer.last.toFixed(2) + " ms" : "n/a"}`,
      `nodes ${s.nodes} (visited ${s.visited}, max z${s.maxZoom}, built ${s.vertexBuilds})`,
      `pages ${s.pages}/${s.pageLayers}  pending ${s.pending} (in flight ${s.inFlight}, missing ${s.missing})`,
      `lat ${state.lat.toFixed(5)} lng ${state.lng.toFixed(5)} d ${fmtDist(state.distance)} hd ${state.heading.toFixed(0)} p ${state.pitch.toFixed(0)}`,
      `eye ${fmtDist(v.eyeAboveGround)} above ground, near ${v.near.toFixed(2)} m`,
    ].join("\n");
  });
  engine.start();

  const host: BenchHost = {
    setCamera: (c) => {
      const jumped = Math.abs(c.lat - state.lat) + Math.abs(c.lng - state.lng) > 0.5;
      Object.assign(state, { lat: c.lat, lng: c.lng, distance: c.distance, heading: c.heading, pitch: c.pitch });
      if (jumped) engine.snapToGround();
      clampState(state);
    },
    onFrame: (cb) => engine.onFrame(cb),
    onGpu: (cb) => engine.onGpu(cb),
    settled: () => ({ pending: terrain.stats.pending + terrain.stats.missing, hash: terrain.stats.selectionHash }),
    canvasSize: () => [canvas.width, canvas.height],
    hasGpuTimer: !!engine.timer,
  };
  Object.assign(window, { __engine: { engine, camera, state, terrain, host, device, view: () => engine.view } });
  if (benchWhich) void runBench(host, benchWhich).then((r) => console.info("[bench] done", r));
}

function fmtDist(m: number): string {
  return m >= 10_000 ? `${(m / 1000).toFixed(0)} km` : `${m.toFixed(1)} m`;
}

void main();
