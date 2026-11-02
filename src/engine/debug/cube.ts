import type { RenderTarget } from "../gpu/device";
import "../frame/frameUniforms";
import { enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import { writeRelative } from "../frame/chunkTable";
import { createShader } from "../gpu/wgsl";
import cubeWgsl from "./cube.wgsl?raw";

// A 1 m checker cube standing on the terrain at a lat/lng: the precision probe of N0. It is a one-object content
// chunk: f64 origin on the CPU, `origin - eye` and the ENU basis to the GPU every frame.
export class DebugCube {
  private pipeline: GPURenderPipeline;
  private buffer: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private data = new Float32Array(16);
  origin: Vec3 = [0, 0, 0];

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    readonly lat: number,
    readonly lng: number,
    readonly edge = 1,
  ) {
    const layout = device.createBindGroupLayout({
      label: "cube",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }],
    });
    this.buffer = device.createBuffer({ label: "cube", size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
    const module = createShader(device, "cube", cubeWgsl);
    this.pipeline = device.createRenderPipeline({
      label: "cube",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: true, depthCompare: "greater" },
      multisample: { count: target.sampleCount },
    });
  }

  // Re-seat on the drawn terrain (heights arrive while streaming) and write origin - eye for this frame.
  update(eye: Readonly<Vec3>, ground: number): void {
    this.origin = geodeticToEcef(this.lat, this.lng, ground);
    const e = enuAt(this.lat, this.lng);
    const d = this.data;
    writeRelative(d, 0, this.origin, eye);
    d[3] = this.edge;
    d.set(e.east, 4);
    d.set(e.north, 8);
    d.set(e.up, 12);
    this.device.queue.writeBuffer(this.buffer, 0, d);
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(1, this.bindGroup);
    pass.draw(36);
  }
}
