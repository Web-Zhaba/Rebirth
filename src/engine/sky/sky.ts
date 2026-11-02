import type { RenderTarget } from "../gpu/device";
import "../frame/frameUniforms";
import { createShader } from "../gpu/wgsl";
import "./atmosphere";
import skyWgsl from "./sky.wgsl?raw";

// Sky and space behind the terrain: one fullscreen triangle, depth-tested against the cleared far value so only
// pixels the terrain left empty pay for the ray march.
export class Sky {
  private pipeline: GPURenderPipeline;

  constructor(device: GPUDevice, target: RenderTarget, frameLayout: GPUBindGroupLayout) {
    const module = createShader(device, "sky", skyWgsl);
    this.pipeline = device.createRenderPipeline({
      label: "sky",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
  }

  draw(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.draw(3);
  }
}
