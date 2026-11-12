import { buildView, clampState, defaultCamera, liftEyeAboveGround, rayDir, type CameraState, type CameraView } from "./camera/camera";
import { pickGround } from "./camera/pick";
import { transformPoint } from "./camera/projection";
import { FrameUniforms, type Highlight } from "./frame/frameUniforms";
import { motionTime } from "../map/graphicsSettings";
import { HiZ } from "./frame/hiz";
import { enuAt, geodeticToEcef, sub, type Geodetic, type Vec3 } from "./geo/ellipsoid";
import { DEPTH_FORMAT, fitCanvas, initGpu, SAMPLE_COUNT, type Gpu, type RenderTarget } from "./gpu/device";
import { GpuTimer } from "./gpu/timer";
import { OverlayRaster } from "./overlay/overlayRaster";
import { ShadowMap } from "./shadow/shadowMap";
import { Sky } from "./sky/sky";
import type { WeatherGpu } from "./sky/weather";
import { EXAGGERATION, Terrain } from "./terrain/terrain";

// The engine on one canvas: device, the main pass with MSAA and one reversed-Z depth
// buffer, terrain, sky and whatever else registers to draw, plus the camera questions the game asks (pick, project).
// Content kinds add themselves as Drawables.

export interface Drawable {
  occluder?: boolean; // drawn before the Hi-Z build (terrain-like solid geometry that hides what lies behind it)
  transparent?: boolean; // blended without depth writes: drawn after the sky, which would otherwise paint over it
  update?(view: CameraView, engine: Engine): void;
  compute?(encoder: GPUCommandEncoder): void; // GPU work the draw depends on (culling, scatter), before the main pass
  draw(pass: GPURenderPassEncoder): void;
  drawShadow?(pass: GPURenderPassEncoder, shadow: ShadowMap): void; // casts into the sun's shadow map (depth only)
  shadowVersion?: number; // changes whenever what drawShadow draws changed (the map is re-rendered then)
  afterSubmit?(): void; // the frame's commands are on the queue (timer read-backs)
  wantsHiZ?(): boolean; // its compute tests against the occluders' depth pyramid this frame (asked after update)
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
  readonly overlay: OverlayRaster;
  readonly frameU: FrameUniforms;
  readonly timer: GpuTimer | null;
  readonly drawables: Drawable[] = [];
  readonly hiz: HiZ;
  readonly shadow: ShadowMap;
  light: (s: CameraState) => Light = defaultLight;
  lodTint = false;
  // The canvas's size in CSS px, kept by a ResizeObserver. Asking the canvas for it (clientWidth) forces the page's
  // style and layout to be worked out on the spot, and a frame asked a dozen times: after any change of the interface
  // (the clock, a label that moved) the first asker paid for a whole layout, in the middle of the frame.
  width = 1;
  height = 1;
  highlight: Highlight | null = null; // a class of ground tinted for a tool (frame/frameUniforms.ts HIGHLIGHT)
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
    this.shadow = new ShadowMap(device);
    this.frameU = new FrameUniforms(device, this.shadow);
    this.overlay = new OverlayRaster(device);
    this.terrain = new Terrain(device, this.target, this.frameU.layout, device.limits.maxTextureArrayLayers, this.overlay);
    this.sky = new Sky(device, this.target, this.frameU.layout);
    this.hiz = new HiZ(device);
    this.timer = gpu.timestamps ? new GpuTimer(device) : null;
    if (this.timer) this.timer.onSample = (ms) => this.gpuListeners.forEach((f) => f(ms));
    this.width = Math.max(1, canvas.clientWidth);
    this.height = Math.max(1, canvas.clientHeight);
    // A resize is seen after the frame's layout, before it is painted: drawn again at once, the canvas never shows a
    // frame stretched to its new size.
    new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      const w = Math.max(1, Math.round(box.width));
      const h = Math.max(1, Math.round(box.height));
      if (w === this.width && h === this.height) return;
      this.width = w;
      this.height = h;
      if (this.running) this.frame(performance.now());
    }).observe(canvas);
  }

  get device(): GPUDevice {
    return this.gpu.device;
  }

  get weather(): WeatherGpu {
    return this.frameU.weather;
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
  groundZoomAt = (lat: number, lng: number): number => this.terrain.groundZoomAt(lat, lng);
  get groundVersion(): number {
    return this.terrain.groundVersion;
  }

  // Ground metres per CSS px at the camera target (the scale a web map's zoom implies: view/view.ts mppAtZoom).
  metersPerPixel(): number {
    const s = this.state;
    return (2 * s.distance * Math.tan((s.fovY * Math.PI) / 360)) / this.height;
  }

  // Whether the drawn ground hides a point (h as drawn) from the eye: the ray towards it meets the ground first. The last
  // stretch before the point is not tested, so a point on a slope is not hidden by the slope it stands on.
  behindTerrain(lat: number, lng: number, h: number): boolean {
    const v = this.view;
    if (!v) return false;
    const d = sub(geodeticToEcef(lat, lng, h), v.eye);
    const len = Math.hypot(d[0], d[1], d[2]);
    const stop = len - Math.max(20, 0.02 * len);
    if (stop <= 0) return false;
    const hit = pickGround(v.eye, [d[0] / len, d[1] / len, d[2] / len], this.groundAt, stop);
    if (!hit) return false;
    const q = sub(geodeticToEcef(hit.lat, hit.lng, hit.h), v.eye);
    return Math.hypot(q[0], q[1], q[2]) < stop;
  }

  // Ground under a CSS pixel of the canvas, or null for sky.
  pick(x: number, y: number): Geodetic | null {
    const v = this.view;
    if (!v) return null;
    const nx = (x / this.width) * 2 - 1;
    const ny = 1 - (y / this.height) * 2;
    return pickGround(v.eye, rayDir(v, nx, ny), this.groundAt);
  }

  // CSS pixel of a point on the planet (h as drawn), or null when it is behind the camera.
  project(lat: number, lng: number, h: number): [number, number] | null {
    const v = this.view;
    if (!v) return null;
    const [x, y, , w] = transformPoint(v.viewProj, sub(geodeticToEcef(lat, lng, h), v.eye));
    if (w <= 0) return null;
    return [((x / w + 1) / 2) * this.width, ((1 - y / w) / 2) * this.height];
  }

  private frame(now: number): void {
    const t0 = performance.now();
    for (const f of [...this.beforeFrameListeners]) f(now);
    const { device, context } = this.gpu;
    const canvas = this.canvas;
    if (fitCanvas(canvas, this.width, this.height) || !this.depth) {
      this.color?.destroy();
      this.depth?.destroy();
      const size = [canvas.width, canvas.height];
      this.color = device.createTexture({ label: "msaa color", size, format: this.target.format, sampleCount: SAMPLE_COUNT, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      this.depth = device.createTexture({ label: "depth", size, format: DEPTH_FORMAT, sampleCount: SAMPLE_COUNT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.hiz.fit(this.depth); // before the drawables' updates read its size
    }
    const s = this.state;
    // The target rides on the drawn ground; heights that arrive while streaming ease in instead of jumping.
    const g = this.terrain.groundAt(s.lat, s.lng);
    if (g !== null) {
      s.h = this.snapHeight || Math.abs(g - s.h) > 0.2 * s.distance ? g : s.h + (g - s.h) * 0.2;
      this.snapHeight = false;
    }
    clampState(s);
    liftEyeAboveGround(s, this.groundAt);
    const view = buildView(s, this.width, this.height, this.groundAt);
    this.view = view;
    this.overlay.update(s, this.metersPerPixel());
    this.terrain.casterReach = this.shadow.reach(view);
    this.terrain.update(view);
    for (const d of this.drawables) d.update?.(view, this);
    const light = this.light(s);
    const t = this.terrain;
    const casters = [t.groundVersion, t.stats.selectionHash, t.stats.nodes, ...this.drawables.map((d) => d.shadowVersion ?? 0)];
    const castShadows = this.shadow.update(view, light.sun, casters);
    this.frameU.write(view, { sun: light.sun, sunIntensity: light.intensity, exaggeration: EXAGGERATION, lodTint: this.lodTint, time: motionTime(), highlight: this.highlight });

    const encoder = device.createCommandEncoder({ label: "frame" });
    // The timer spans the shadow pass (when it runs), the occluders and the main pass.
    const times = this.timer?.passWrites();
    const begin = times && { querySet: times.querySet, beginningOfPassWriteIndex: times.beginningOfPassWriteIndex };
    // The sun's shadow map first, when what it is baked from changed: every receiver below
    // samples it. The forest casts the instances its scatter made last frame (scene/forest.ts drawShadow).
    if (castShadows) {
      const shadowPass = this.shadow.beginPass(encoder, begin);
      shadowPass.setBindGroup(0, this.frameU.castBindGroup);
      this.terrain.drawShadow(shadowPass, this.shadow);
      for (const d of this.drawables) d.drawShadow?.(shadowPass, this.shadow);
      shadowPass.end();
    }
    // Occluders first, then the Hi-Z of their depth, the GPU culling passes that test against it, and everything else
    // on top of the same colour and depth.
    const colorView = this.color!.createView();
    const depthView = this.depth.createView();
    const occluders = encoder.beginRenderPass({
      label: "occluders",
      colorAttachments: [{ view: colorView, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: { view: depthView, depthClearValue: 0, depthLoadOp: "clear", depthStoreOp: "store" },
      timestampWrites: castShadows ? undefined : begin,
    });
    occluders.setBindGroup(0, this.frameU.bindGroup);
    this.terrain.draw(occluders);
    for (const d of this.drawables) if (d.occluder) d.draw(occluders);
    occluders.end();
    // The pyramid is a compute pass over every level of the depth: built only for a frame something culls against it.
    if (this.drawables.some((d) => d.wantsHiZ?.())) this.hiz.build(encoder, this.depth);
    for (const d of this.drawables) d.compute?.(encoder);
    const pass = encoder.beginRenderPass({
      label: "main",
      colorAttachments: [{ view: colorView, resolveTarget: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "discard" }],
      depthStencilAttachment: { view: depthView, depthLoadOp: "load", depthStoreOp: "discard" },
      timestampWrites: times && { querySet: times.querySet, endOfPassWriteIndex: times.endOfPassWriteIndex },
    });
    pass.setBindGroup(0, this.frameU.bindGroup);
    for (const d of this.drawables) if (!d.occluder && !d.transparent) d.draw(pass);
    this.sky.draw(pass); // only pixels nothing solid covered pay for the sky
    for (const d of this.drawables) if (d.transparent) d.draw(pass);
    pass.end();
    this.timer?.resolveInto(encoder);
    device.queue.submit([encoder.finish()]);
    this.timer?.afterSubmit();
    for (const d of this.drawables) d.afterSubmit?.();

    const interval = this.prevNow ? now - this.prevNow : 0;
    this.prevNow = now;
    const sample = { now, cpu: performance.now() - t0, interval };
    for (const f of [...this.frameListeners]) f(sample);
  }
}
