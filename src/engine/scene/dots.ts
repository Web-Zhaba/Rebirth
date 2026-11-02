import type { CameraView } from "../camera/camera";
import type { Drawable, Engine } from "../engine";
import { enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import dotsWgsl from "./dots.wgsl?raw";

// Dots on the ground (dots.wgsl): screen-sized discs (walkers, carts) and ground discs (evening glows), each layer one
// instanced draw, refilled whenever the game moves them. Depth-tested against the ground and the models, never written,
// premultiplied alpha. Positions: metres in the east/north/up frame of the town origin.

export const DOT_FLOATS = 8;

const u32 = new Uint32Array(1);
const f32 = new Float32Array(u32.buffer);
// Packed RGBA8 colour (as overlay/geometry.ts packColor) as the bits of an f32.
export const colourBits = (packed: number): number => ((u32[0] = packed), f32[0]);

// One dot: centre (east, north, up m), radius (px, or m for a ground disc), fill and stroke colour bits, stroke width px,
// flags (1 + blur share for a ground disc, 0 for a screen dot).
export function writeDot(out: Float32Array, i: number, x: number, y: number, z: number, radius: number, fill: number, stroke: number, strokePx: number, groundBlur: number | null): void {
  const o = i * DOT_FLOATS;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = radius;
  out[o + 4] = fill;
  out[o + 5] = stroke;
  out[o + 6] = strokePx;
  out[o + 7] = groundBlur === null ? 0 : 1 + Math.min(0.999, groundBlur);
}

interface Layer {
  buffer: GPUBuffer | null;
  capacity: number;
  count: number;
}

export class Dots implements Drawable {
  private origin: Vec3 | null = null;
  private axes: { east: Vec3; north: Vec3; up: Vec3 } | null = null;
  private layers: Layer[];
  private uniform: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private pipeline: GPURenderPipeline;
  private data = new Float32Array(20);

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    layers: number,
  ) {
    this.layers = Array.from({ length: layers }, () => ({ buffer: null, capacity: 0, count: 0 }));
    const layout = device.createBindGroupLayout({ label: "dots", entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }] });
    this.uniform = device.createBuffer({ label: "dots", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const module = createShader(device, "dots", dotsWgsl);
    this.pipeline = device.createRenderPipeline({
      label: "dots",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: DOT_FLOATS * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 16, format: "float32x2" },
              { shaderLocation: 2, offset: 24, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [{ format: target.format, blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }],
      },
      primitive: { topology: "triangle-strip" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
  }

  setOrigin(lat: number, lng: number): void {
    this.origin = geodeticToEcef(lat, lng, 0);
    this.axes = enuAt(lat, lng);
  }

  // Replace layer `k` (layers draw in index order) with `count` dots from `data`.
  set(k: number, data: Float32Array<ArrayBuffer>, count: number): void {
    const l = this.layers[k];
    if (count > l.capacity) {
      l.buffer?.destroy();
      l.capacity = Math.max(64, 2 ** Math.ceil(Math.log2(count)));
      l.buffer = this.device.createBuffer({ label: `dots ${k}`, size: l.capacity * DOT_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    l.count = count;
    if (count && l.buffer) this.device.queue.writeBuffer(l.buffer, 0, data, 0, count * DOT_FLOATS);
  }

  // A point (lat, lng, height) in the origin's east/north/up metres.
  local(lat: number, lng: number, h: number): Vec3 {
    const o = this.origin!;
    const a = this.axes!;
    const p = geodeticToEcef(lat, lng, h);
    const d: Vec3 = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return [d[0] * a.east[0] + d[1] * a.east[1] + d[2] * a.east[2], d[0] * a.north[0] + d[1] * a.north[1] + d[2] * a.north[2], d[0] * a.up[0] + d[1] * a.up[1] + d[2] * a.up[2]];
  }

  get ready(): boolean {
    return this.origin !== null;
  }

  update(view: CameraView, engine: Engine): void {
    if (!this.origin || !this.axes) return;
    const o = this.origin;
    const { east, north, up } = this.axes;
    const h = Math.max(1, engine.canvas.clientHeight);
    this.data.set([o[0] - view.eye[0], o[1] - view.eye[1], o[2] - view.eye[2], h / 2, ...east, 0, ...north, 0, ...up, 0, engine.canvas.clientWidth / h, 0, 0, 0]);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.origin) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(1, this.bindGroup);
    for (const l of this.layers) {
      if (!l.count || !l.buffer) continue;
      pass.setVertexBuffer(0, l.buffer);
      pass.draw(4, l.count);
    }
  }
}
