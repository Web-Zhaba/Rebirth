import type { CameraView } from "../camera/camera";
import type { Drawable, Engine } from "../engine";
import { enuAt } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import precipWgsl from "./precip.wgsl?raw";

// Rain and snow around the eye (docs/PLAN-engine.md N7): one instanced draw of camera-relative particles, positions
// from the instance index and the time (precip.wgsl). The game sets `look` (view/engine/weather.ts); null draws nothing.

export interface PrecipLook {
  count: number; // particles
  box: number; // edge of the box of air around the eye (m)
  snow: boolean;
  opacity: number; // 0..1
  drift: [east: number, north: number]; // horizontal drift per metre of fall
  colour: [number, number, number]; // display space
  time: number; // s
}

export const PRECIP_MAX = 6000;

export class Precip implements Drawable {
  readonly transparent = true;
  look: PrecipLook | null = null;
  private uniform: GPUBuffer;
  private group: GPUBindGroup;
  private pipe: GPURenderPipeline;
  private data = new Float32Array(24);

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
  ) {
    const layout = device.createBindGroupLayout({
      label: "precip",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    this.uniform = device.createBuffer({ label: "precip", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const module = createShader(device, "precip", precipWgsl);
    const premul: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    this.pipe = device.createRenderPipeline({
      label: "precip",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format, blend: premul }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
  }

  update(_view: CameraView, engine: Engine): void {
    const l = this.look;
    if (!l) return;
    const { east, north, up } = enuAt(engine.state.lat, engine.state.lng);
    this.data.set([...east, 0, ...north, 0, ...up, 0, l.box, l.time, l.snow ? 1 : 0, l.opacity, ...l.drift, 0, 0, ...l.colour, 1]);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);
  }

  draw(pass: GPURenderPassEncoder): void {
    const l = this.look;
    if (!l || l.count < 1 || l.opacity <= 0) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(1, this.group);
    pass.draw(6, Math.min(PRECIP_MAX, Math.round(l.count)));
  }
}
