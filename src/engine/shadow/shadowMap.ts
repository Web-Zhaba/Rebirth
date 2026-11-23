import type { ShadowQuality } from "../../map/graphicsSettings";
import type { CameraView } from "../camera/camera";
import { dot, normalize, type Vec3 } from "../geo/ellipsoid";
import { cascadeSplits, MAX_CASCADES, ShadowCache, shadowCovers, shadowFade, shadowFrame, shadowMatrix, shadowStart, sliceSphere, steadyRadius, sunTolerance, type ShadowFrame } from "./shadowMath";

// The sun's cascaded shadow maps: a depth texture array, a layer per slice of the view
// (shadow/shadowMath.ts), rendered from the sun by the casters' own depth-only pipelines (SHADOW_DEPTH) and sampled by
// the receivers through shadow.wgsl. A layer is re-rendered only when what it was baked from changed: a still camera
// costs no shadow pass, and a moving sun re-renders a cascade only once its shadows would slide by a fraction of its
// texel, so the far, coarse cascades follow the clock far less often than the near one. The two nearest are
// re-rendered on the frame they go stale; the farther ones take turns, one of them a frame.

export const SHADOW_SETUP: Record<Exclude<ShadowQuality, "off">, { size: number; cascades: number; far: number }> = {
  low: { size: 1024, cascades: 3, far: 2500 },
  high: { size: 2048, cascades: 4, far: 5000 },
};

// The depth state of every caster's shadow pipeline: plain depth, 0 nearest the sun (shadowMath.ts shadowMatrix).
export const SHADOW_DEPTH: GPUDepthStencilState = { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" };

const CASTER_RANGE = 4000; // m around the camera target where terrain out of view still casts (terrain.ts casterReach)

interface Cascade {
  frame: ShadowFrame | null; // what its layer holds
  sun: Vec3 | null; // the sun it was rendered with
  radius: number; // the steady radius (shadowMath.ts steadyRadius)
  centre: Vec3; // this frame's: the sphere around its slice (absolute ECEF)
  start: number; // view depth (m) the cascade starts serving from
  readonly cache: ShadowCache;
}

export class ShadowMap {
  quality: ShadowQuality = "high";
  view: GPUTextureView; // every layer, replaced when the quality changes the size or the count
  readonly sampler: GPUSampler;
  readonly dummyView: GPUTextureView; // stands in for the maps in group 0 while they are being drawn
  readonly proj = new Float64Array(16 * MAX_CASCADES); // camera-relative ECEF -> each cascade's clip, this frame
  fade = 0; // 0: no shadows this frame
  far = 0; // m from the eye where the shadows end
  count = 0; // cascades in use this frame
  reach = 0; // m around the camera target where terrain out of view casts
  generation = 0; // bumped when the texture is replaced (group 0 is rebuilt)
  current = 0; // the cascade the shadow pass is drawing
  private texture: GPUTexture | null = null;
  private layers: GPUTextureView[] = [];
  private readonly cascades: Cascade[] = Array.from({ length: MAX_CASCADES }, () => ({ frame: null, sun: null, radius: 0, centre: [0, 0, 0], start: 0, cache: new ShadowCache() }));
  private tick = 0;

  constructor(private readonly device: GPUDevice) {
    // Lit where the receiver is no farther from the sun than the nearest caster.
    this.sampler = device.createSampler({ label: "shadow", compare: "less-equal", magFilter: "linear", minFilter: "linear" });
    const dummy = device.createTexture({ label: "shadow dummy", size: [1, 1, 1], format: "depth32float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummyView = dummy.createView({ dimension: "2d-array" });
    this.view = this.resize(SHADOW_SETUP.high.size, SHADOW_SETUP.high.cascades);
  }

  get size(): number {
    return this.texture?.width ?? 1;
  }

  // Metres per texel of cascade `i` as its layer holds it, for the receivers' bias.
  texel(i: number): number {
    return this.cascades[i].frame?.texel ?? 1;
  }

  // The cascade being drawn: its texel, where it starts serving (view depth) and the sun it is drawn for.
  get castTexel(): number {
    return this.texel(this.current);
  }

  get castStart(): number {
    return this.cascades[this.current].start;
  }

  castSun(i: number): Vec3 {
    return this.cascades[i].sun ?? [0, 0, 1];
  }

  // Before the casters are chosen: this frame's fade, the cascades' spheres along the view and the terrain's caster
  // reach.
  fit(view: CameraView, sun: Vec3): void {
    this.count = 0;
    this.reach = 0;
    if (this.quality === "off") {
      this.fade = 0;
      return;
    }
    const setup = SHADOW_SETUP[this.quality];
    if (setup.size !== this.size || setup.cascades !== this.layers.length) this.view = this.resize(setup.size, setup.cascades);
    this.fade = shadowFade(view.eyeAboveGround, dot(sun, normalize(view.target)), setup.size);
    if (this.fade <= 0) return;
    const e = view.eye;
    const f = view.forward;
    const u = normalize(e);
    const tanY = view.tanHalfY;
    const tanX = tanY * view.aspect;
    // the bottom edge of the view, per metre of depth: forward - up * tan(half fov y)
    const down = -((f[0] - view.up[0] * tanY) * u[0] + (f[1] - view.up[1] * tanY) * u[1] + (f[2] - view.up[2] * tanY) * u[2]);
    const splits = cascadeSplits(shadowStart(view.eyeAboveGround, down, view.near, setup.far), setup.far, setup.cascades);
    const t = view.target;
    let reach = 0;
    for (let i = 0; i < setup.cascades; i++) {
      const c = this.cascades[i];
      const s = sliceSphere(splits[i], splits[i + 1], tanX, tanY);
      c.radius = steadyRadius(s.radius, c.radius);
      c.centre = [e[0] + f[0] * s.depth, e[1] + f[1] * s.depth, e[2] + f[2] * s.depth];
      c.start = splits[i];
      reach = Math.max(reach, Math.hypot(c.centre[0] - t[0], c.centre[1] - t[1], c.centre[2] - t[2]) + c.radius);
    }
    this.count = setup.cascades;
    this.far = setup.far;
    this.reach = Math.min(CASTER_RANGE, reach);
  }

  // This frame's matrices, and the cascades to re-render now. `casters` are the versions of what draws into them
  // (terrain pages, town meshes, the forest's instances).
  update(view: CameraView, sun: Vec3, casters: readonly number[]): number[] {
    const due: number[] = [];
    if (!this.count) return due;
    this.tick++;
    const size = this.size;
    // The casters are culled for the camera (terrain selection, forest scatter), so the view is part of the key.
    const e = view.eye;
    const fw = view.forward;
    const r = (v: number, q: number) => Math.round(v / q);
    const viewKey = [r(e[0], 0.01), r(e[1], 0.01), r(e[2], 0.01), r(fw[0], 1e-5), r(fw[1], 1e-5), r(fw[2], 1e-5)];
    for (let i = 0; i < this.count; i++) {
      const c = this.cascades[i];
      const tolerance = sunTolerance((2 * c.radius) / size, dot(sun, normalize(c.centre)));
      const s = c.sun && angle(c.sun, sun) <= tolerance ? c.sun : sun;
      const f = shadowFrame(s, c.centre, c.radius, size);
      const inputs = [...f.origin, ...s, f.radius, size, ...viewKey, ...casters];
      if (!c.frame || (!c.cache.matches(inputs) && (i < 2 || this.tick % 2 === i % 2))) {
        c.frame = f;
        c.sun = s;
        c.cache.store(inputs);
        due.push(i);
      }
      shadowMatrix(c.frame, e, this.proj.subarray(i * 16, i * 16 + 16));
    }
    return due;
  }

  // Whether a caster's bounding sphere (absolute ECEF) reaches into the cascade being drawn.
  covers(center: Vec3, radius: number): boolean {
    const f = this.cascades[this.current].frame;
    return f !== null && shadowCovers(f, center, radius);
  }

  // The shadow pass of cascade `i`: the caller sets group 0 to that cascade's cast group, draws the casters and ends it.
  beginPass(encoder: GPUCommandEncoder, i: number, timestampWrites?: GPURenderPassTimestampWrites): GPURenderPassEncoder {
    this.current = i;
    return encoder.beginRenderPass({
      label: `shadow ${i}`,
      timestampWrites,
      colorAttachments: [],
      depthStencilAttachment: { view: this.layers[i], depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
  }

  private resize(size: number, count: number): GPUTextureView {
    this.texture?.destroy();
    this.texture = this.device.createTexture({ label: "shadow maps", size: [size, size, count], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.layers = Array.from({ length: count }, (_, i) => this.texture!.createView({ dimension: "2d", baseArrayLayer: i, arrayLayerCount: 1 }));
    this.generation++;
    for (const c of this.cascades) {
      c.frame = null;
      c.sun = null;
      c.radius = 0;
      c.cache.reset();
    }
    return this.texture.createView({ dimension: "2d-array" });
  }
}

// The angle (rad) between two unit vectors, exact for small ones.
function angle(a: Vec3, b: Vec3): number {
  return 2 * Math.asin(Math.min(1, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2));
}
