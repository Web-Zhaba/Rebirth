import { buildView, clampState, defaultCamera, type CameraState, type CameraView } from "../camera/camera";
import { attachInput } from "../camera/controller";
import { DebugCube } from "../debug/cube";
import { enuAt, type Vec3 } from "../geo/ellipsoid";
import { FrameUniforms } from "../frame/frameUniforms";
import { DEPTH_FORMAT, fitCanvas, initGpu, WebGpuUnavailable } from "../gpu/device";
import { GpuTimer } from "../gpu/timer";
import { Sky } from "../sky/sky";
import { EXAGGERATION, Terrain } from "../terrain/terrain";
import { runBench, type BenchHost, type FrameSample } from "./bench";

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

// Mid-morning sun, fixed relative to the view: south-east and 35 deg up at the camera target.
function sunAt(s: CameraState): Vec3 {
  const az = (120 * Math.PI) / 180;
  const el = (35 * Math.PI) / 180;
  const e = enuAt(s.lat, s.lng);
  const ce = Math.cos(el);
  return [0, 1, 2].map((i) => e.east[i] * Math.sin(az) * ce + e.north[i] * Math.cos(az) * ce + e.up[i] * Math.sin(el)) as Vec3;
}

async function main(): Promise<void> {
  let gpu;
  try {
    gpu = await initGpu(canvas);
  } catch (e) {
    fail(e instanceof WebGpuUnavailable ? `WebGPU недоступен: ${e.message}` : String(e));
    throw e;
  }
  const { device, context, format } = gpu;
  console.info("[engine] adapter:", gpu.info, "timestamps:", gpu.timestamps, "layers:", device.limits.maxTextureArrayLayers);

  const frameU = new FrameUniforms(device);
  const terrain = new Terrain(device, format, DEPTH_FORMAT, frameU.layout, device.limits.maxTextureArrayLayers);
  const sky = new Sky(device, format, DEPTH_FORMAT, frameU.layout);
  const tau = num("tau");
  if (tau) terrain.tau = tau;
  const maxZ = num("maxz");
  if (maxZ !== null) terrain.maxZoom = maxZ;
  const cubeAt = q.get("cube")?.split(",").map(Number);
  const cube = cubeAt && cubeAt.length === 2 && cubeAt.every(Number.isFinite) ? new DebugCube(device, format, DEPTH_FORMAT, frameU.layout, cubeAt[0], cubeAt[1]) : null;

  const state: CameraState = defaultCamera();
  state.lat = num("lat") ?? (cube ? cube.lat : state.lat);
  state.lng = num("lng") ?? (cube ? cube.lng : state.lng);
  state.distance = num("d") ?? (cube ? 20 : state.distance);
  state.heading = num("hd") ?? state.heading;
  state.pitch = num("p") ?? (cube ? 60 : state.pitch);
  clampState(state);
  const orbit = num("orbit") ?? 0;
  const lodTint = q.get("lod") === "1";

  let view: CameraView | null = null;
  attachInput(canvas, { state, view: () => view });

  const timer = gpu.timestamps ? new GpuTimer(device) : null;
  const gpuListeners = new Set<(ms: number) => void>();
  if (timer) timer.onSample = (ms) => gpuListeners.forEach((f) => f(ms));
  const frameListeners = new Set<(s: FrameSample) => void>();

  let depth: GPUTexture | null = null;
  const hud = document.createElement("pre");
  hud.className = "hud";
  document.body.append(hud);
  let hudAt = 0;
  let prevNow = 0;
  let cpuAvg = 0;
  let snapHeight = true;

  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const t0 = performance.now();
    if (fitCanvas(canvas) || !depth) {
      depth?.destroy();
      depth = device.createTexture({ label: "depth", size: [canvas.width, canvas.height], format: DEPTH_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    if (orbit) {
      state.heading += (orbit * Math.max(0, now - prevNow)) / 1000;
      clampState(state);
    }
    // The target rides on the drawn ground; heights that arrive while streaming ease in instead of jumping.
    const g = terrain.groundAt(state.lat, state.lng);
    if (g !== null) {
      state.h = snapHeight || Math.abs(g - state.h) > 0.2 * state.distance ? g : state.h + (g - state.h) * 0.2;
      snapHeight = false;
    }
    view = buildView(state, canvas.clientWidth, canvas.clientHeight, terrain.groundAt);
    terrain.update(view);
    cube?.update(view.eye, cube ? (terrain.groundAt(cube.lat, cube.lng) ?? 0) : 0);
    frameU.write(view, { sun: sunAt(state), sunIntensity: 2.2, exaggeration: EXAGGERATION, lodTint, time: now / 1000 });

    const encoder = device.createCommandEncoder({ label: "frame" });
    const pass = encoder.beginRenderPass({
      label: "main",
      colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "store" },
      timestampWrites: timer?.passWrites(),
    });
    pass.setBindGroup(0, frameU.bindGroup);
    terrain.draw(pass);
    cube?.draw(pass);
    sky.draw(pass);
    pass.end();
    timer?.resolveInto(encoder);
    device.queue.submit([encoder.finish()]);
    timer?.afterSubmit();
    const cpu = performance.now() - t0;

    const interval = prevNow ? now - prevNow : 0;
    prevNow = now;
    cpuAvg = cpuAvg * 0.95 + cpu * 0.05;
    for (const f of [...frameListeners]) f({ now, cpu, interval });

    if (now - hudAt > 250) {
      hudAt = now;
      const s = terrain.stats;
      hud.textContent = [
        `frame ${interval.toFixed(1)} ms  cpu ${cpuAvg.toFixed(2)} ms  gpu ${timer ? timer.last.toFixed(2) + " ms" : "n/a"}`,
        `nodes ${s.nodes} (visited ${s.visited}, max z${s.maxZoom}, built ${s.vertexBuilds})`,
        `pages ${s.pages}/${s.pageLayers}  pending ${s.pending} (in flight ${s.inFlight}, missing ${s.missing})`,
        `lat ${state.lat.toFixed(5)} lng ${state.lng.toFixed(5)} d ${fmtDist(state.distance)} hd ${state.heading.toFixed(0)} p ${state.pitch.toFixed(0)}`,
        `eye ${fmtDist(view.eyeAboveGround)} above ground, near ${view.near.toFixed(2)} m`,
      ].join("\n");
    }
  };
  requestAnimationFrame(frame);

  const host: BenchHost = {
    setCamera: (c) => {
      const jumped = Math.abs(c.lat - state.lat) + Math.abs(c.lng - state.lng) > 0.5;
      Object.assign(state, { lat: c.lat, lng: c.lng, distance: c.distance, heading: c.heading, pitch: c.pitch });
      if (jumped) snapHeight = true;
      clampState(state);
    },
    onFrame: (cb) => {
      frameListeners.add(cb);
      return () => frameListeners.delete(cb);
    },
    onGpu: (cb) => {
      gpuListeners.add(cb);
      return () => gpuListeners.delete(cb);
    },
    settled: () => ({ pending: terrain.stats.pending + terrain.stats.missing, hash: terrain.stats.selectionHash }),
    canvasSize: () => [canvas.width, canvas.height],
    hasGpuTimer: !!timer,
  };
  Object.assign(window, { __engine: { state, terrain, host, device, view: () => view } });
  if (benchWhich) void runBench(host, benchWhich).then((r) => console.info("[bench] done", r));
}

function fmtDist(m: number): string {
  return m >= 10_000 ? `${(m / 1000).toFixed(0)} km` : `${m.toFixed(1)} m`;
}

void main();
