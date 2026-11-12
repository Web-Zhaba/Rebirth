import type { CameraView } from "../camera/camera";
import type { Drawable, Engine } from "../engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import fieldsWgsl from "./fields.wgsl?raw";

// The town's farm fields up close (port of the old three.js field layer): one mesh of every field draped
// on the ground in the town origin's east/north/up frame, the furrows, crops, stubble, headlands and snow procedural in
// fields.wgsl. The game builds the mesh, rewrites the farms' work into it and sets the `look` every frame
// (view/engine/fields.ts); null draws nothing.

// east, north, up (m), the field's own metres (2), furrow direction (2), worked / hash / extent along the furrows (4),
// metres to the edge, the share sown and the share harvested
export const FIELD_VERTEX_FLOATS = 14;
export const FIELD_WORK_OFFSET = 12;

export interface FieldsLook {
  light: Vec3; // in the origin's frame
  sunStrength: number;
  daylight: number;
  day: number; // day of the year, with its fraction
  fadeIn: number; // 0..1 as the camera comes down
  far: number; // m: fades out towards here
}

export class Fields implements Drawable {
  look: FieldsLook | null = null;
  private origin: Vec3 | null = null;
  private axes: { east: Vec3; north: Vec3; up: Vec3 } | null = null;
  private vertices: GPUBuffer | null = null;
  private indices: GPUBuffer | null = null;
  private count = 0;
  private uniform: GPUBuffer;
  private group: GPUBindGroup;
  private pipe: GPURenderPipeline;
  private data = new Float32Array(28);

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    defines: Record<string, string | number>,
  ) {
    const layout = device.createBindGroupLayout({
      label: "fields",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    this.uniform = device.createBuffer({ label: "fields", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const module = createShader(device, "fields", fieldsWgsl, defines);
    const premul: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    this.pipe = device.createRenderPipeline({
      label: "fields",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: FIELD_VERTEX_FLOATS * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x2" },
              { shaderLocation: 2, offset: 20, format: "float32x2" },
              { shaderLocation: 3, offset: 28, format: "float32x4" },
              { shaderLocation: 4, offset: 44, format: "float32" },
              { shaderLocation: 5, offset: FIELD_WORK_OFFSET * 4, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format, blend: premul }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: true, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
  }

  // The frame the vertices are in: east/north/up of (lat, lng, 0).
  setOrigin(lat: number, lng: number): void {
    this.origin = geodeticToEcef(lat, lng, 0);
    this.axes = enuAt(lat, lng);
  }

  // An ECEF direction in the origin's frame.
  toLocal(d: Readonly<Vec3>): Vec3 {
    const a = this.axes;
    return a ? [dot(d, a.east), dot(d, a.north), dot(d, a.up)] : [d[0], d[1], d[2]];
  }

  setMesh(vertices: Float32Array<ArrayBuffer>, indices: Uint32Array<ArrayBuffer>): void {
    this.vertices?.destroy();
    this.indices?.destroy();
    this.vertices = this.indices = null;
    this.count = indices.length;
    if (!this.count) return;
    this.vertices = this.device.createBuffer({ label: "fields", size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.indices = this.device.createBuffer({ label: "fields", size: indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(this.vertices, 0, vertices);
    this.device.queue.writeBuffer(this.indices, 0, indices);
  }

  // The whole vertex array again (the farms' work changed in it).
  rewrite(vertices: Float32Array<ArrayBuffer>): void {
    if (this.vertices) this.device.queue.writeBuffer(this.vertices, 0, vertices);
  }

  update(view: CameraView, _engine: Engine): void {
    const l = this.look;
    const o = this.origin;
    const a = this.axes;
    if (!l || !o || !a || !this.count) return;
    const rel: Vec3 = [o[0] - view.eye[0], o[1] - view.eye[1], o[2] - view.eye[2]];
    const eye: Vec3 = [-dot(rel, a.east), -dot(rel, a.north), -dot(rel, a.up)];
    this.data.set([...rel, 0, ...a.east, 0, ...a.north, 0, ...a.up, 0, ...eye, l.day, ...l.light, l.sunStrength, l.daylight, l.fadeIn, l.far, 0]);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.look || !this.count || !this.vertices || !this.indices) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(1, this.group);
    pass.setVertexBuffer(0, this.vertices);
    pass.setIndexBuffer(this.indices, "uint32");
    pass.drawIndexed(this.count);
  }
}
