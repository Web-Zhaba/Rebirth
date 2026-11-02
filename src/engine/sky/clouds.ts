import type { CameraView } from "../camera/camera";
import type { Drawable, Engine } from "../engine";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import { MAX_LIGHT_STEPS, MAX_MARCH_STEPS } from "../../map/clouds/constants";
import { FLASH_MAX } from "../../map/clouds/lightning";
import { mixHex, PALETTE } from "../../ui/palette";
import cloudsWgsl from "./clouds.wgsl?raw";

// The cloud volume of the globe views (docs/PLAN-engine.md N7, port of the old three.js cloud layer): `compute` ray-marches
// the shell into a low-resolution target when the game says the picture changed, `draw` composites the cached target
// over the frame after the sky. The game decides what to draw and when to march again (view/engine/weather.ts).

const UNIFORM_FLOATS = 12 + FLASH_MAX * 4;

export interface CloudPass {
  rBase: number; // shell radii, planet = 1
  rTop: number;
  fade: number; // 1 far out .. 0 close up
  orbit: number; // 1 on the whole-globe views
  steps: number;
  lightSteps: number;
  detail: boolean;
  scale: number; // target size relative to the drawing buffer
  flashes: Float32Array; // FLASH_MAX vec4: cube-frame direction, intensity
  flashCount: number;
  march: boolean; // the cached target is stale
}

const hex = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const vec3 = (v: number[]) => `vec3f(${v.map((x) => x.toFixed(4)).join(", ")})`;

// Palette greys of the old shader: ink-blue is `info` pulled toward `ink` and desaturated.
function inkBlue(): number[] {
  const m = hex(mixHex(PALETTE.info, PALETTE.ink, 0.35));
  const l = 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2];
  return m.map((v) => v * 0.6 + l * 0.4);
}

export class Clouds implements Drawable {
  readonly transparent = true;
  pass: CloudPass | null = null; // null: nothing to draw this frame
  marches = 0; // dev counter
  private uniform: GPUBuffer;
  private data = new Float32Array(UNIFORM_FLOATS);
  private marchLayout: GPUBindGroupLayout;
  private compLayout: GPUBindGroupLayout;
  private marchPipe: GPURenderPipeline;
  private compPipe: GPURenderPipeline;
  private marchGroup: GPUBindGroup;
  private compGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler;
  private target: GPUTexture | null = null;
  private made = false; // the target holds a march
  private marchNow = false;

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    private readonly frameGroup: () => GPUBindGroup,
    detail: GPUTexture,
  ) {
    this.uniform = device.createBuffer({ label: "clouds", size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ label: "clouds", magFilter: "linear", minFilter: "linear" });
    const vf = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    this.marchLayout = device.createBindGroupLayout({
      label: "cloud march",
      entries: [
        { binding: 0, visibility: vf, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "3d" } },
      ],
    });
    this.compLayout = device.createBindGroupLayout({
      label: "cloud composite",
      entries: [
        { binding: 0, visibility: vf, buffer: { type: "uniform" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    this.marchGroup = device.createBindGroup({
      layout: this.marchLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: detail.createView() },
      ],
    });
    const module = createShader(device, "clouds", cloudsWgsl, {
      FLASH_MAX,
      MAX_STEPS: MAX_MARCH_STEPS,
      MAX_LIGHT: MAX_LIGHT_STEPS,
      LIT: vec3(hex(PALETTE.paperRaised)),
      SHADE: vec3(inkBlue()),
      NIGHT: vec3(hex(mixHex(PALETTE.dusk, PALETTE.paperRaised, 0.74))),
      WARM: vec3(hex(PALETTE.warn)),
      RAIN: vec3(hex(PALETTE.pencil)),
      ICE: vec3(hex(PALETTE.mapIce)),
    });
    this.marchPipe = device.createRenderPipeline({
      label: "cloud march",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, this.marchLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "march", targets: [{ format: "rgba16float" }] },
      primitive: { topology: "triangle-list" },
    });
    const premul: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    this.compPipe = device.createRenderPipeline({
      label: "cloud composite",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, this.compLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "composite", targets: [{ format: target.format, blend: premul }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "always" },
      multisample: { count: target.sampleCount },
    });
  }

  update(_view: CameraView, engine: Engine): void {
    const p = this.pass;
    this.marchNow = false;
    if (!p) return;
    const w = Math.max(1, Math.round(engine.canvas.width * p.scale));
    const h = Math.max(1, Math.round(engine.canvas.height * p.scale));
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.destroy();
      this.target = this.device.createTexture({ label: "clouds", size: [w, h], format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.compGroup = this.device.createBindGroup({
        layout: this.compLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniform } },
          { binding: 2, resource: this.target.createView() },
          { binding: 3, resource: this.sampler },
        ],
      });
      this.made = false;
    }
    this.marchNow = p.march || !this.made;
    const d = this.data;
    d.set([p.rBase, p.rTop, p.fade, p.orbit], 0);
    d.set([p.steps, p.lightSteps, p.detail ? 1 : 0, p.flashCount], 4);
    d.set([1 / w, 1 / h, 0, 0], 8);
    d.set(p.flashes.subarray(0, FLASH_MAX * 4), 12);
    this.device.queue.writeBuffer(this.uniform, 0, d);
  }

  compute(encoder: GPUCommandEncoder): void {
    if (!this.pass || !this.marchNow || !this.target) return;
    const pass = encoder.beginRenderPass({
      label: "cloud march",
      colorAttachments: [{ view: this.target.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(this.marchPipe);
    pass.setBindGroup(0, this.frameGroup());
    pass.setBindGroup(1, this.marchGroup);
    pass.draw(3);
    pass.end();
    this.made = true;
    this.marches++;
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.pass || !this.made || !this.compGroup) return;
    pass.setPipeline(this.compPipe);
    pass.setBindGroup(1, this.compGroup);
    pass.draw(3);
  }

  // The cached march no longer matches anything (the game turned the clouds off).
  forget(): void {
    this.made = false;
  }
}
