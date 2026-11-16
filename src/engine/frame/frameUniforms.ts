import type { CameraView } from "../camera/camera";
import type { Vec3 } from "../geo/ellipsoid";
import frameWgsl from "./frame.wgsl?raw";
import lightWgsl from "./light.wgsl?raw";
import shadowWgsl from "../shadow/shadow.wgsl?raw";
import type { ShadowMap } from "../shadow/shadowMap";
import { MAX_CASCADES } from "../shadow/shadowMath";
import { registerWgsl } from "../gpu/wgsl";
import { WeatherGpu } from "../sky/weather";

registerWgsl("frame", frameWgsl);
registerWgsl("shadow", shadowWgsl);
registerWgsl("light", lightWgsl);

// Bind group 0 for every pass: the Frame uniform of frame.wgsl, the weather of sky/weather.wgsl (its textures are
// replaced when the weather cubes change size or swap, so the group is rebuilt then) and the sun's shadow maps of
// shadow/shadow.wgsl. A cascade's shadow pass binds `castBindGroup(i)`: its own copy of the Frame, carrying that
// cascade's matrix and sun, with a stand-in for the maps it draws into.

const FLOATS = 16 + 7 * 4 + 16 * MAX_CASCADES + 4 + 4 + 16;
const SHADOW_AT = 44;

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
  private castBuffers: GPUBuffer[];
  private data = new Float32Array(FLOATS);
  private group: GPUBindGroup | null = null;
  private castGroups: GPUBindGroup[] = [];
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
        { binding: 6, visibility: all, texture: { sampleType: "depth", viewDimension: "2d-array" } },
        { binding: 7, visibility: all, sampler: { type: "comparison" } },
      ],
    });
    const buffer = (label: string) => device.createBuffer({ label, size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.buffer = buffer("frame");
    this.castBuffers = Array.from({ length: MAX_CASCADES }, (_, i) => buffer(`frame (shadow ${i})`));
    this.weather = new WeatherGpu(device);
  }

  get bindGroup(): GPUBindGroup {
    this.refresh();
    return this.group!;
  }

  castBindGroup(i: number): GPUBindGroup {
    this.refresh();
    return this.castGroups[i];
  }

  private refresh(): void {
    const w = this.weather;
    const generation = `${w.generation}/${this.shadow.generation}`;
    if (this.group && this.groupGeneration === generation) return;
    const [a, b] = w.cubeViews;
    const make = (label: string, buffer: GPUBuffer, map: GPUTextureView) =>
      this.device.createBindGroup({
        label,
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: { buffer: w.buffer } },
          { binding: 2, resource: a },
          { binding: 3, resource: b },
          { binding: 4, resource: w.base.createView() },
          { binding: 5, resource: w.sampler },
          { binding: 6, resource: map },
          { binding: 7, resource: this.shadow.sampler },
        ],
      });
    this.group = make("frame", this.buffer, this.shadow.view);
    this.castGroups = this.castBuffers.map((b, i) => make(`frame (shadow ${i})`, b, this.shadow.dummyView));
    this.groupGeneration = generation;
  }

  // This frame's uniforms, and the copies for the cascades the shadow pass draws (`cast`).
  write(v: CameraView, p: FrameParams, cast: readonly number[] = []): void {
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
    const at = SHADOW_AT + 16 * MAX_CASCADES;
    d.set(sh.proj, SHADOW_AT);
    for (let i = 0; i < MAX_CASCADES; i++) d[at + i] = sh.texel(i);
    d.set([sh.count, sh.fade, 1 / sh.size, sh.far], at + 4);
    d.set(sh.proj.subarray(0, 16), at + 8);
    this.device.queue.writeBuffer(this.buffer, 0, d);
    // A cascade's copy: its matrix for the casters, and the sun it is drawn for (the impostors turn to face it).
    for (const i of cast) {
      d.set(sh.proj.subarray(i * 16, i * 16 + 16), at + 8);
      d.set(sh.castSun(i), 20);
      this.device.queue.writeBuffer(this.castBuffers[i], 0, d);
    }
  }
}
