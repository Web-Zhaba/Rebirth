import { writeVillager, poseOf, type Action, type Rig, type Vec3 } from "../../map/villagerModel";
import { rgb } from "../../map/modelGeometry";
import { createShader } from "../gpu/wgsl";
import villagersWgsl from "./villagers.wgsl?raw";

// Villagers on raw WebGPU for the preview page (/villagers.html): every figure's vertices are rewritten on the CPU each
// frame from poseOf() into one vertex buffer, and the figures stand on a flat patch. Not part of the globe engine.

const FLOATS = 9; // position, normal, colour
const SAMPLES = 4;
const GROUND = 40; // m, half side of the patch
const AMBIENT = 0.42;
const PAPER = rgb("#dfe4d6"); // the project's paper (map/ui palette), the page background too
const BACKGROUND = { r: PAPER[0], g: PAPER[1], b: PAPER[2], a: 1 };
const GROUND_COLOUR = rgb("#b5a57c");

export interface Actor {
  rig: Rig;
  origin: Vec3; // m, feet on the patch
}

const VERTEX_LAYOUT: GPUVertexBufferLayout = {
  arrayStride: FLOATS * 4,
  attributes: [
    { shaderLocation: 0, offset: 0, format: "float32x3" },
    { shaderLocation: 1, offset: 12, format: "float32x3" },
    { shaderLocation: 2, offset: 24, format: "float32x3" },
  ],
};

export class VillagerPreview {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniforms: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly ground: GPUBuffer;
  private readonly uni = new Float32Array(20);
  private figures: GPUBuffer | null = null;
  private cpu = new Float32Array(0);
  private vertices = 0;
  private actors: Actor[] = [];
  private msaaView: GPUTextureView | null = null;
  private depthView: GPUTextureView | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
  ) {
    const module = createShader(device, "villagers", villagersWgsl);
    this.pipeline = device.createRenderPipeline({
      label: "villagers",
      layout: "auto",
      vertex: { module, entryPoint: "vs", buffers: [VERTEX_LAYOUT] },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
      multisample: { count: SAMPLES },
    });
    this.uniforms = device.createBuffer({ label: "villagers.scene", size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniforms } }] });
    this.ground = this.groundBuffer();
  }

  setActors(actors: Actor[]): void {
    this.actors = actors;
    this.vertices = actors.reduce((n, a) => n + a.rig.vertices, 0);
    this.cpu = new Float32Array(this.vertices * FLOATS);
    this.figures?.destroy();
    this.figures = this.device.createBuffer({
      label: "villagers.figures",
      size: Math.max(1, this.vertices) * FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
  }

  resize(width: number, height: number): void {
    const size = [width, height] as const;
    this.msaaView = this.device
      .createTexture({ label: "villagers.msaa", size, sampleCount: SAMPLES, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT })
      .createView();
    this.depthView = this.device
      .createTexture({ label: "villagers.depth", size, sampleCount: SAMPLES, format: "depth32float", usage: GPUTextureUsage.RENDER_ATTACHMENT })
      .createView();
  }

  draw(time: number, action: Action, viewProj: Float32Array, light: Vec3): void {
    if (!this.msaaView || !this.depthView) return;
    const d = this.device;
    let at = 0;
    for (const a of this.actors) at = writeVillager(a.rig, poseOf(a.rig, action, time), a.origin, this.cpu, at);
    if (this.figures && this.vertices) d.queue.writeBuffer(this.figures, 0, this.cpu);
    this.uni.set(viewProj, 0);
    this.uni.set([light[0], light[1], light[2], AMBIENT], 16);
    d.queue.writeBuffer(this.uniforms, 0, this.uni);

    const encoder = d.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.msaaView,
          resolveTarget: this.context.getCurrentTexture().createView(),
          clearValue: BACKGROUND,
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
      depthStencilAttachment: { view: this.depthView, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "discard" },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.ground);
    pass.draw(6);
    if (this.figures && this.vertices) {
      pass.setVertexBuffer(0, this.figures);
      pass.draw(this.vertices);
    }
    pass.end();
    d.queue.submit([encoder.finish()]);
  }

  // Two triangles facing up, counter-clockwise seen from above (the pipeline culls back faces).
  private groundBuffer(): GPUBuffer {
    const g = GROUND;
    const corners: [number, number][] = [[-g, -g], [-g, g], [g, g], [-g, -g], [g, g], [g, -g]];
    const data = new Float32Array(corners.length * FLOATS);
    corners.forEach(([x, z], i) => data.set([x, 0, z, 0, 1, 0, ...GROUND_COLOUR], i * FLOATS));
    const buffer = this.device.createBuffer({ label: "villagers.ground", size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }
}
