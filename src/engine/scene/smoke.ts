import type { CameraView } from "../camera/camera";
import type { Drawable, Engine } from "../engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import smokeWgsl from "./smoke.wgsl?raw";

// Chimney smoke (docs/PLAN-engine.md N7, port of the old three.js smoke layer): chimneys in the town origin's east/north/up
// frame, the nearest MAX_CHIMNEYS within REACH of the eye drawn as instances of PUFFS camera-facing puffs each
// (smoke.wgsl). The game sets the chimneys and, every frame, `look` (view/engine/smoke.ts); null draws nothing.

const PUFFS = 12;
const LIFE = 8; // s a puff lives
const RISE = 12; // m it rises
const REACH = 650; // m: chimneys farther from the eye are not drawn
const MAX_CHIMNEYS = 400;
const SELECT_STEP = 30; // m the eye may move before the nearest chimneys are picked again
export const CHIMNEY_FLOATS = 6; // east, north, up (m), kind (0 home, 1 furnace, 2 tavern), hash, puff size (m)

export interface SmokeLook {
  strength: [home: number, furnace: number, tavern: number];
  time: number; // s
  wind: [east: number, north: number, speed: number];
  sunStrength: number;
  daylight: number;
  far: number; // m: the smoke fades out towards this distance
}

export class Smoke implements Drawable {
  readonly transparent = true;
  look: SmokeLook | null = null;
  private origin: Vec3 | null = null;
  private axes: { east: Vec3; north: Vec3; up: Vec3 } | null = null;
  private all: Float32Array<ArrayBuffer> = new Float32Array(0);
  private picked: Vec3 | null = null;
  private count = 0;
  private instances: GPUBuffer;
  private uniform: GPUBuffer;
  private group: GPUBindGroup;
  private pipe: GPURenderPipeline;
  private data = new Float32Array(28);
  private pick = new Float32Array(MAX_CHIMNEYS * CHIMNEY_FLOATS);

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
  ) {
    const layout = device.createBindGroupLayout({
      label: "smoke",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    this.uniform = device.createBuffer({ label: "smoke", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.instances = device.createBuffer({ label: "smoke chimneys", size: this.pick.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const module = createShader(device, "smoke", smokeWgsl, { PUFFS, LIFE, RISE });
    const premul: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    this.pipe = device.createRenderPipeline({
      label: "smoke",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: {
        module,
        entryPoint: "vs",
        buffers: [
          {
            arrayStride: CHIMNEY_FLOATS * 4,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 16, format: "float32x2" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format, blend: premul }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
  }

  // The chimneys, CHIMNEY_FLOATS each, in the east/north/up frame of the origin at (lat, lng, 0).
  setChimneys(lat: number, lng: number, chimneys: Float32Array<ArrayBuffer>): void {
    this.origin = geodeticToEcef(lat, lng, 0);
    this.axes = enuAt(lat, lng);
    this.all = chimneys;
    this.picked = null;
  }

  update(view: CameraView, _engine: Engine): void {
    const l = this.look;
    const o = this.origin;
    const a = this.axes;
    if (!l || !o || !a) return;
    const rel: Vec3 = [o[0] - view.eye[0], o[1] - view.eye[1], o[2] - view.eye[2]];
    const eye: Vec3 = [-dot(rel, a.east), -dot(rel, a.north), -dot(rel, a.up)];
    if (!this.picked || Math.hypot(eye[0] - this.picked[0], eye[1] - this.picked[1], eye[2] - this.picked[2]) > SELECT_STEP) this.select(eye);
    this.data.set([...rel, 0, ...a.east, 0, ...a.north, 0, ...a.up, 0, ...l.strength, l.time, ...l.wind, l.far, l.sunStrength, l.daylight, 0, 0]);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);
  }

  draw(pass: GPURenderPassEncoder): void {
    const l = this.look;
    if (!l || !this.count || Math.max(...l.strength) <= 0) return;
    pass.setPipeline(this.pipe);
    pass.setBindGroup(1, this.group);
    pass.setVertexBuffer(0, this.instances);
    pass.draw(PUFFS * 6, this.count);
  }

  // The nearest chimneys within REACH of the eye (east/north/up of the origin) into the instance buffer.
  private select(eye: Vec3): void {
    const all = this.all;
    const near: { q: number; d2: number }[] = [];
    for (let q = 0; q < all.length / CHIMNEY_FLOATS; q++) {
      const k = q * CHIMNEY_FLOATS;
      const d2 = (all[k] - eye[0]) ** 2 + (all[k + 1] - eye[1]) ** 2 + (all[k + 2] - eye[2]) ** 2;
      if (d2 < REACH * REACH) near.push({ q, d2 });
    }
    near.sort((x, y) => x.d2 - y.d2);
    if (near.length > MAX_CHIMNEYS) near.length = MAX_CHIMNEYS;
    near.forEach(({ q }, i) => this.pick.set(all.subarray(q * CHIMNEY_FLOATS, (q + 1) * CHIMNEY_FLOATS), i * CHIMNEY_FLOATS));
    this.count = near.length;
    if (this.count) this.device.queue.writeBuffer(this.instances, 0, this.pick, 0, this.count * CHIMNEY_FLOATS);
    this.picked = eye;
  }
}
