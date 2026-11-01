import type { CameraView } from "../camera/camera";
import type { Vec3 } from "../geo/ellipsoid";
import frameWgsl from "./frame.wgsl?raw";
import { registerWgsl } from "../gpu/wgsl";

registerWgsl("frame", frameWgsl);

// The Frame uniform of frame.wgsl: bind group 0 for every pass.

const FLOATS = 16 + 6 * 4;

export interface FrameParams {
  sun: Vec3;
  sunIntensity: number;
  exaggeration: number;
  lodTint: boolean;
  time: number;
}

export class FrameUniforms {
  readonly layout: GPUBindGroupLayout;
  readonly bindGroup: GPUBindGroup;
  private buffer: GPUBuffer;
  private data = new Float32Array(FLOATS);

  constructor(private readonly device: GPUDevice) {
    this.layout = device.createBindGroupLayout({
      label: "frame",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }],
    });
    this.buffer = device.createBuffer({ label: "frame", size: FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: this.buffer } }] });
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
    d.set([p.exaggeration, p.lodTint ? 1 : 0, p.time, 0], 36);
    this.device.queue.writeBuffer(this.buffer, 0, d);
  }
}
