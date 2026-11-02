import type { CameraView } from "../camera/camera";
import type { Drawable, Engine } from "../engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import waterWgsl from "./water.wgsl?raw";

// The water surface near the camera (docs/PLAN-engine.md N8, port of the old three.js water layer): lakes, rivers and streams as
// chunk meshes in the town origin's east/north/up frame, at the level of their shores, drawn over the terrain's own
// drape-shaded water and fading into it at the far edge and while the camera comes down (water.wgsl). A sheet of
// steam over the same geometry rides in the transparent phase (`steam`). The game builds the chunks and sets, every
// frame, which of them are drawn and the `look` (view/engine/water.ts); null draws nothing.

export const WATER_VERTEX_FLOATS = 7; // east, north, up (m), metres to the shore, flow (east, north), shore tone
export const PIERS = 32;

export interface WaterChunkData {
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

export interface WaterChunkGpu {
  vertices: GPUBuffer;
  indices: GPUBuffer;
  count: number;
}

export interface WaterLook {
  light: Vec3; // in the origin's frame: the models' light (blended towards a fixed one as the sun sets)
  sunStrength: number;
  sun: Vec3; // the sun's direction in the origin's frame
  daylight: number; // how lit the place is: day 1 .. night 0
  time: number; // s
  windDir: [number, number];
  wind: number; // ripple strength 0.12..1.2
  rain: number; // 0..1: rings
  far: number; // m: fades into the terrain's water towards here
  fadeIn: number; // 0..1 as the camera comes down
  steam: number; // 0..1
  sky: Vec3; // display colours of the sky's reflection, overhead and at the horizon
  horizon: Vec3;
  piers: readonly { x: number; y: number; r: number }[]; // origin-frame metres, the nearest first
}

const UNIFORM_FLOATS = 4 * (11 + PIERS);

export class Water implements Drawable {
  look: WaterLook | null = null;
  shown: WaterChunkGpu[] = [];
  readonly steam: Drawable;
  private origin: Vec3 | null = null;
  private axes: { east: Vec3; north: Vec3; up: Vec3 } | null = null;
  private uniform: GPUBuffer;
  private group: GPUBindGroup;
  private pipe: GPURenderPipeline;
  private steamPipe: GPURenderPipeline;
  private data = new Float32Array(UNIFORM_FLOATS);

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    colours: { deep: Vec3; shallow: Vec3; foam: Vec3; groundTone: Vec3; forestTone: Vec3 },
  ) {
    const layout = device.createBindGroupLayout({
      label: "water",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    this.uniform = device.createBuffer({ label: "water", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const v3 = (c: Vec3) => c.map((x) => x.toFixed(4)).join(", ");
    const module = createShader(device, "water", waterWgsl, {
      PIERS,
      DEEP: v3(colours.deep),
      SHALLOW: v3(colours.shallow),
      FOAM: v3(colours.foam),
      GROUND_TONE: v3(colours.groundTone),
      FOREST_TONE: v3(colours.forestTone),
    });
    const premul: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    const vertex: GPUVertexState = {
      module,
      entryPoint: "vs",
      buffers: [
        {
          arrayStride: WATER_VERTEX_FLOATS * 4,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32" },
            { shaderLocation: 2, offset: 16, format: "float32x2" },
            { shaderLocation: 3, offset: 24, format: "float32" },
          ],
        },
      ],
    };
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] });
    this.pipe = device.createRenderPipeline({
      label: "water",
      layout: pipelineLayout,
      vertex,
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format, blend: premul }] },
      primitive: { topology: "triangle-list" }, // the pieces wind either way: no culling
      depthStencil: { format: target.depthFormat, depthWriteEnabled: true, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
    this.steamPipe = device.createRenderPipeline({
      label: "water steam",
      layout: pipelineLayout,
      vertex: { ...vertex, entryPoint: "vsSteam" },
      fragment: { module, entryPoint: "fsSteam", targets: [{ format: target.format, blend: premul }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
    this.steam = { transparent: true, draw: (pass) => this.drawSteam(pass) };
  }

  // The frame the chunk vertices are in: east/north/up of (lat, lng, 0).
  setOrigin(lat: number, lng: number): void {
    this.origin = geodeticToEcef(lat, lng, 0);
    this.axes = enuAt(lat, lng);
  }

  // An ECEF direction in the origin's frame.
  toLocal(d: Readonly<Vec3>): Vec3 {
    const a = this.axes;
    return a ? [dot(d, a.east), dot(d, a.north), dot(d, a.up)] : [d[0], d[1], d[2]];
  }

  upload(c: WaterChunkData): WaterChunkGpu {
    const vertices = this.device.createBuffer({ label: "water chunk", size: Math.max(16, c.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const indices = this.device.createBuffer({ label: "water chunk", size: Math.max(16, c.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vertices, 0, c.vertices);
    this.device.queue.writeBuffer(indices, 0, c.indices);
    return { vertices, indices, count: c.indices.length };
  }

  release(c: WaterChunkGpu): void {
    c.vertices.destroy();
    c.indices.destroy();
  }

  update(view: CameraView, _engine: Engine): void {
    const l = this.look;
    const o = this.origin;
    const a = this.axes;
    if (!l || !o || !a || !this.shown.length) return;
    const rel: Vec3 = [o[0] - view.eye[0], o[1] - view.eye[1], o[2] - view.eye[2]];
    const eye: Vec3 = [-dot(rel, a.east), -dot(rel, a.north), -dot(rel, a.up)];
    const d = this.data;
    d.set([...rel, 0, ...a.east, 0, ...a.north, 0, ...a.up, 0, ...eye, l.time, ...l.light, l.sunStrength, ...l.sun, l.daylight]);
    d.set([l.windDir[0], l.windDir[1], l.wind, l.rain, l.far, l.fadeIn, l.steam, Math.min(PIERS, l.piers.length), ...l.sky, 0, ...l.horizon, 0], 28);
    for (let q = 0; q < PIERS; q++) {
      const p = l.piers[q];
      d.set(p ? [p.x, p.y, p.r, 0] : [0, 0, 0, 0], 44 + q * 4);
    }
    this.device.queue.writeBuffer(this.uniform, 0, d);
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.look || !this.shown.length) return;
    pass.setPipeline(this.pipe);
    this.chunks(pass);
  }

  private drawSteam(pass: GPURenderPassEncoder): void {
    if (!this.look || this.look.steam <= 0.003 || !this.shown.length) return;
    pass.setPipeline(this.steamPipe);
    this.chunks(pass);
  }

  private chunks(pass: GPURenderPassEncoder): void {
    pass.setBindGroup(1, this.group);
    for (const c of this.shown) {
      pass.setVertexBuffer(0, c.vertices);
      pass.setIndexBuffer(c.indices, "uint32");
      pass.drawIndexed(c.count);
    }
  }
}
