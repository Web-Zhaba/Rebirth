import { buildView, clampState, defaultCamera, rayDir, type CameraState, type CameraView } from "./camera/camera";
import { pickGround } from "./camera/pick";
import { transformPoint } from "./camera/projection";
import { FrameUniforms } from "./frame/frameUniforms";
import { enuAt, geodeticToEcef, sub, type Geodetic, type Vec3 } from "./geo/ellipsoid";
import { DEPTH_FORMAT, fitCanvas, initGpu, SAMPLE_COUNT, type Gpu, type RenderTarget } from "./gpu/device";
import { GpuTimer } from "./gpu/timer";
import { Sky } from "./sky/sky";
import { EXAGGERATION, Terrain } from "./terrain/terrain";

// The engine on one canvas (docs/PLAN-engine.md section 4): device, the main pass with MSAA and one reversed-Z depth
// buffer, terrain, sky and whatever else registers to draw, plus the camera questions the game asks (pick, project).
// Content kinds (N3+) add themselves as Drawables.

export interface Drawable {
  update?(view: CameraView, engine: Engine): void;
  draw(pass: GPURenderPassEncoder): void;
}

export interface FrameSample {
  now: number;
  cpu: number; // ms spent building and submitting this frame
  interval: number; // ms since the previous frame
}

export interface Light {
  sun: Vec3; // unit ECEF direction towards the sun
  intensity: number;
}

// Mid-morning sun, fixed relative to the camera target: south-east and 35 deg up. Lighting from the game clock
// replaces it.
export const SUN_INTENSITY = 2.2;

export function defaultLight(s: CameraState): Light {
  const az = (120 * Math.PI) / 180;
  const el = (35 * Math.PI) / 180;
  const e = enuAt(s.lat, s.lng);
  const ce = Math.cos(el);
  return { sun: [0, 1, 2].map((i) => e.east[i] * Math.sin(az) * ce + e.north[i] * Math.cos(az) * ce + e.up[i] * Math.sin(el)) as Vec3, intensity: SUN_INTENSITY };
}

export class Engine {
  readonly state: CameraState = defaultCamera();
  view: CameraView | null = null;
  readonly target: RenderTarget;
  readonly terrain: Terrain;
  readonly frameU: FrameUniforms;
  readonly timer: GpuTimer | null;
  readonly drawables: Drawable[] = [];
  light: (s: CameraState) => Light = defaultLight;
  lodTint = false;
  private readonly sky: Sky;
  private readonly frameListeners = new Set<(s: FrameSample) => void>();
  private readonly beforeFrameListeners = new Set<(now: number) => void>();
  private readonly gpuListeners = new Set<(ms: number) => void>();
  private color: GPUTexture | null = null;
  private depth: GPUTexture | null = null;
  private snapHeight = true;
  private prevNow = 0;
  private running = false;

  static async create(canvas: HTMLCanvasElement): Promise<Engine> {
    return new Engine(canvas, await initGpu(canvas));
  }

  private constructor(
    readonly canvas: HTMLCanvasElement,
    readonly gpu: Gpu,
  ) {
    const { device, format } = gpu;
    this.target = { format, depthFormat: DEPTH_FORMAT, sampleCount: SAMPLE_COUNT };
    this.frameU = new FrameUniforms(device);
    this.terrain = new Terrain(device, this.target, this.frameU.layout, device.limits.maxTextureArrayLayers);
    this.sky = new Sky(device, this.target, this.frameU.layout);
    this.timer = gpu.timestamps ? new GpuTimer(device) : null;
    if (this.timer) this.timer.onSample = (ms) => this.gpuListeners.forEach((f) => f(ms));
  }

  get device(): GPUDevice {
    return this.gpu.device;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  // The camera jumped far: take the ground height under the new target at once instead of easing to it.
  snapToGround(): void {
    this.snapHeight = true;
  }

  onFrame(cb: (s: FrameSample) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  // Called at the start of every frame with the timestamp, before the camera state is read (input smoothing, flights).
  onBeforeFrame(cb: (now: number) => void): () => void {
    this.beforeFrameListeners.add(cb);
    return () => this.beforeFrameListeners.delete(cb);
  }

  onGpu(cb: (ms: number) => void): () => void {
    this.gpuListeners.add(cb);
    return () => this.gpuListeners.delete(cb);
  }

  groundAt = (lat: number, lng: number): number | null => this.terrain.groundAt(lat, lng);

  // Ground under a CSS pixel of the canvas, or null for sky.
  pick(x: number, y: number): Geodetic | null {
    const v = this.view;
    if (!v) return null;
    const nx = (x / Math.max(1, this.canvas.clientWidth)) * 2 - 1;
    const ny = 1 - (y / Math.max(1, this.canvas.clientHeight)) * 2;
    return pickGround(v.eye, rayDir(v, nx, ny), this.groundAt);
  }

  // CSS pixel of a point on the planet (h as drawn), or null when it is behind the camera.
  project(lat: number, lng: number, h: number): [number, number] | null {
    const v = this.view;
    if (!v) return null;
    const [x, y, , w] = transformPoint(v.viewProj, sub(geodeticToEcef(lat, lng, h), v.eye));
    if (w <= 0) return null;
    return [((x / w + 1) / 2) * this.canvas.clientWidth, ((1 - y / w) / 2) * this.canvas.clientHeight];
  }

  private frame(now: number): void {
    const t0 = performance.now();
    for (const f of [...this.beforeFrameListeners]) f(now);
    const { device, context } = this.gpu;
    const canvas = this.canvas;
    if (fitCanvas(canvas) || !this.depth) {
      this.color?.destroy();
      this.depth?.destroy();
      const size = [canvas.width, canvas.height];
      this.color = device.createTexture({ label: "msaa color", size, format: this.target.format, sampleCount: SAMPLE_COUNT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.depth = device.createTexture({ label: "depth", size, format: DEPTH_FORMAT, sampleCount: SAMPLE_COUNT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    const s = this.state;
    // The target rides on the drawn ground; heights that arrive while streaming ease in instead of jumping.
    const g = this.terrain.groundAt(s.lat, s.lng);
    if (g !== null) {
      s.h = this.snapHeight || Math.abs(g - s.h) > 0.2 * s.distance ? g : s.h + (g - s.h) * 0.2;
      this.snapHeight = false;
    }
    clampState(s);
    const view = buildView(s, canvas.clientWidth, canvas.clientHeight, this.groundAt);
    this.view = view;
    this.terrain.update(view);
    for (const d of this.drawables) d.update?.(view, this);
    const light = this.light(s);
    this.frameU.write(view, { sun: light.sun, sunIntensity: light.intensity, exaggeration: EXAGGERATION, lodTint: this.lodTint, time: now / 1000 });

    const encoder = device.createCommandEncoder({ label: "frame" });
    const pass = encoder.beginRenderPass({
      label: "main",
      colorAttachments: [{ view: this.color!.createView(), resolveTarget: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "discard" }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "discard" },
      timestampWrites: this.timer?.passWrites(),
    });
    pass.setBindGroup(0, this.frameU.bindGroup);
    this.terrain.draw(pass);
    for (const d of this.drawables) d.draw(pass);
    this.sky.draw(pass); // last: only pixels nothing else covered pay for the sky
    pass.end();
    this.timer?.resolveInto(encoder);
    device.queue.submit([encoder.finish()]);
    this.timer?.afterSubmit();

    const interval = this.prevNow ? now - this.prevNow : 0;
    this.prevNow = now;
    const sample = { now, cpu: performance.now() - t0, interval };
    for (const f of [...this.frameListeners]) f(sample);
  }
}
