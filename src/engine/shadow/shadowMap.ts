import type { CameraView } from "../camera/camera";
import { dot, normalize, type Vec3 } from "../geo/ellipsoid";
import { ShadowCache, shadowCovers, shadowFade, shadowFrame, shadowMatrix, shadowRadius, steppedSun, type ShadowFrame } from "./shadowMath";

// The sun's local shadow map (docs/PLAN-shadows.md section 3): one depth texture around the camera target, rendered
// from the sun by the casters' own depth-only pipelines (SHADOW_DEPTH) and sampled by the receivers through
// shadow.wgsl. It is re-rendered only when what it was baked from changed (shadowMath.ts ShadowCache); a still camera
// costs no shadow pass.

export type ShadowQuality = "off" | "low" | "high";
export const SHADOW_SIZES: Record<Exclude<ShadowQuality, "off">, number> = { low: 1024, high: 2048 };

// The depth state of every caster's shadow pipeline: plain depth, 0 nearest the sun (shadowMath.ts shadowMatrix).
export const SHADOW_DEPTH: GPUDepthStencilState = { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" };

export class ShadowMap {
  quality: ShadowQuality = "high";
  view: GPUTextureView; // the map, replaced when the quality changes its size
  readonly sampler: GPUSampler;
  readonly dummyView: GPUTextureView; // stands in for the map in group 0 while the map itself is being drawn
  readonly proj = new Float64Array(16); // camera-relative ECEF -> shadow clip, this frame
  fade = 0; // 0: no shadows this frame
  generation = 0; // bumped when the texture is replaced (group 0 is rebuilt)
  private texture: GPUTexture | null = null;
  private frame: ShadowFrame | null = null;
  private sun: Vec3 | null = null;
  private readonly cache = new ShadowCache();

  constructor(private readonly device: GPUDevice) {
    // Lit where the receiver is no farther from the sun than the nearest caster.
    this.sampler = device.createSampler({ label: "shadow", compare: "less-equal", magFilter: "linear", minFilter: "linear" });
    const dummy = device.createTexture({ label: "shadow dummy", size: [1, 1], format: "depth32float", usage: GPUTextureUsage.TEXTURE_BINDING });
    this.dummyView = dummy.createView();
    this.view = this.resize(SHADOW_SIZES.high);
  }

  get size(): number {
    return this.texture?.width ?? 1;
  }

  // Metres per texel this frame, for the receivers' bias.
  get texel(): number {
    return this.frame?.texel ?? 1;
  }

  get version(): number {
    return this.cache.version;
  }

  // This frame's projection and fade; true when the map must be re-rendered. `casters` are the versions of what draws
  // into it (terrain pages, town meshes, the forest's instances).
  update(view: CameraView, sun: Vec3, casters: readonly number[]): boolean {
    if (this.quality === "off") {
      this.fade = 0;
      return false;
    }
    const size = SHADOW_SIZES[this.quality];
    if (size !== this.size) this.view = this.resize(size);
    this.fade = shadowFade(view.eyeAboveGround, dot(sun, normalize(view.target)));
    if (this.fade <= 0) return false;
    this.sun = steppedSun(this.sun, sun);
    const f = (this.frame = shadowFrame(this.sun, view.target, shadowRadius(Math.hypot(view.eye[0] - view.target[0], view.eye[1] - view.target[1], view.eye[2] - view.target[2])), size));
    shadowMatrix(f, view.eye, this.proj);
    // The casters are culled for the camera (terrain selection, forest scatter), so the view is part of the key.
    const e = view.eye;
    const fw = view.forward;
    const r = (v: number, q: number) => Math.round(v / q);
    return this.cache.stale([...f.origin, ...this.sun, f.radius, size, r(e[0], 0.01), r(e[1], 0.01), r(e[2], 0.01), r(fw[0], 1e-5), r(fw[1], 1e-5), r(fw[2], 1e-5), ...casters]);
  }

  // Whether a caster's bounding sphere (absolute ECEF) reaches into this frame's map.
  covers(center: Vec3, radius: number): boolean {
    return this.frame !== null && shadowCovers(this.frame, center, radius);
  }

  // The shadow pass: the caller sets group 0 to the frame's cast group, draws the casters and ends it.
  beginPass(encoder: GPUCommandEncoder, timestampWrites?: GPURenderPassTimestampWrites): GPURenderPassEncoder {
    return encoder.beginRenderPass({
      label: "shadow",
      timestampWrites,
      colorAttachments: [],
      depthStencilAttachment: { view: this.view, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
  }

  private resize(size: number): GPUTextureView {
    this.texture?.destroy();
    this.texture = this.device.createTexture({ label: "shadow map", size: [size, size], format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.generation++;
    this.cache.reset();
    return this.texture.createView();
  }
}
