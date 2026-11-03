import type { CameraView } from "../camera/camera";
import type { Vec3 } from "../geo/ellipsoid";
import frameWgsl from "./frame.wgsl?raw";
import shadowWgsl from "../shadow/shadow.wgsl?raw";
import type { ShadowMap } from "../shadow/shadowMap";
import { registerWgsl } from "../gpu/wgsl";
import { WeatherGpu } from "../sky/weather";

registerWgsl("frame", frameWgsl);
registerWgsl("shadow", shadowWgsl);

// Bind group 0 for every pass: the Frame uniform of frame.wgsl, the weather of sky/weather.wgsl (its textures are
// replaced when the weather cubes change size or swap, so the group is rebuilt then) and the sun's shadow map of
// shadow/shadow.wgsl. The shadow pass itself binds `castBindGroup`, the same with a stand-in for the map it draws into.

const FLOATS = 16 + 7 * 4 + 16 + 4;

export interface FrameParams {
  sun: Vec3;
  sunIntensity: number;
  exaggeration: number;
  lodTint: boolean;
  time: number;
  highlight: Highlight | null;
}

// What the ground can be tinted by, for a tool that cares about it (the old map's context fills): its class from the
// drape's cover and water.
export const HIGHLIGHT = { wood: 1, water: 2, wetOrWater: 3 } as const;

export interface Highlight {
  mode: (typeof HIGHLIGHT)[keyof typeof HIGHLIGHT];
  colour: Vec3; // display colour
  opacity: number;
}

export class FrameUniforms {
  readonly layout: GPUBindGroupLayout;
  readonly weather: WeatherGpu;
  private buffer: GPUBuffer;
  private data = new Float32Array(FLOATS);
  private group: GPUBindGroup | null = null;
  private castGroup: GPUBindGroup | null = null;
  private groupGeneration = "";

  constructor(
    private readonly device: GPUDevice,
    private readonly shadow: ShadowMap,
  ) {
    const all = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
    this.layout = device.createBindGroupLayout({
      label: "frame",
      entries: [
        { binding: 0, visibility: all, buffer: { type: "uniform" } },
        { binding: 1, visibility: all, buffer: { type: "uniform" } },
        { binding: 2, visibility: all, texture: { viewDimension: "cube" } },
        { binding: 3, visibility: all, texture: { viewDimension: "cube" } },
        { binding: 4, visibility: all, texture: { viewDimension: "3d" } },
        { binding: 5, visibility: all, sampler: {} },
        { binding: 6, visibility: all, texture: { sampleType: "depth" } },
        { binding: 7, visibility: all, sampler: { type: "comparison" } },
      ],
    });
    this.buffer = device.createBuffer({ label: "frame", size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.weather = new WeatherGpu(device);
  }

  get bindGroup(): GPUBindGroup {
    this.refresh();
    return this.group!;
  }

  get castBindGroup(): GPUBindGroup {
    this.refresh();
    return this.castGroup!;
  }

  private refresh(): void {
    const w = this.weather;
    const generation = `${w.generation}/${this.shadow.generation}`;
    if (this.group && this.groupGeneration === generation) return;
    const [a, b] = w.cubeViews;
    const make = (label: string, map: GPUTextureView) =>
      this.device.createBindGroup({
        label,
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: this.buffer } },
          { binding: 1, resource: { buffer: w.buffer } },
          { binding: 2, resource: a },
          { binding: 3, resource: b },
          { binding: 4, resource: w.base.createView() },
          { binding: 5, resource: w.sampler },
          { binding: 6, resource: map },
          { binding: 7, resource: this.shadow.sampler },
        ],
      });
    this.group = make("frame", this.shadow.view);
    this.castGroup = make("frame (shadow pass)", this.shadow.dummyView);
    this.groupGeneration = generation;
  }

  write(v: CameraView, p: FrameParams): void {
    const d = this.data;
    d.set(v.viewProj, 0); // f64 -> f32 here, after the eye was taken out of every position
    d.set([v.eye[0], v.eye[1], v.eye[2], v.eyeAlt], 16);
    d.set([p.sun[0], p.sun[1], p.sun[2], p.sunIntensity], 20);
    const tx = v.tanHalfY * v.aspect;
    d.set([v.right[0] * tx, v.right[1] * tx, v.right[2] * tx, 0], 24);
    d.set([v.up[0] * v.tanHalfY, v.up[1] * v.tanHalfY, v.up[2] * v.tanHalfY, 0], 28);
    d.set([v.forward[0], v.forward[1], v.forward[2], v.near], 32);
    const h = p.highlight;
    d.set([p.exaggeration, p.lodTint ? 1 : 0, p.time, h?.mode ?? 0], 36);
    d.set(h ? [...h.colour, h.opacity] : [0, 0, 0, 0], 40);
    const sh = this.shadow;
    d.set(sh.proj, 44);
    d.set([sh.texel, sh.fade, 1 / sh.size, 0], 60);
    this.device.queue.writeBuffer(this.buffer, 0, d);
  }
}
