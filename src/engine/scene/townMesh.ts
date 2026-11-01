import type { CameraView } from "../camera/camera";
import type { Engine, Drawable } from "../engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import "../frame/frameUniforms";
import "../sky/atmosphere";
import townMeshWgsl from "./townMesh.wgsl?raw";

// The town's models (docs/PLAN-engine.md N4): two indexed meshes in metres in the east/north/up frame of the town
// origin, built by the game (view/engine/models.ts) from the same model builders the old map used. Roads first without
// depth writes (ribbons of two chains overlap at a junction, equal depths would flicker), then the buildings, then the
// window lights added on top; the old city's broken walls with the buildings while they are shown. Uniforms carry
// the origin relative to the eye, so the meshes are camera-relative.

// Vertex: position 3, normal 3, colour 3, facade 4, height above own ground 1, lamp 1.
export const TOWN_VERTEX_FLOATS = 15;

export interface TownMeshData {
  vertices: Float32Array<ArrayBuffer>;
  indices: Uint32Array<ArrayBuffer>;
}

export interface TownLook {
  sunStrength: number; // 0..1
  light: Vec3; // light direction in the origin's east/north/up frame
  daylight: number; // how lit the place is, 1 day .. 0 night
  lamps: [house: number, work: number, tavern: number];
}

interface Mesh {
  vertices: GPUBuffer;
  indices: GPUBuffer;
  count: number;
}

export class TownMesh implements Drawable {
  readonly occluder = true;
  private origin: Vec3 | null = null;
  private axes: { east: Vec3; north: Vec3; up: Vec3 } | null = null;
  private roads: Mesh | null = null;
  private buildings: Mesh | null = null;
  private ruins: Mesh | null = null;
  ruinsShown = false; // the old city's broken walls (setRuins), drawn with the buildings' pipeline while shown
  private uniform: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private roadPipe: GPURenderPipeline;
  private buildingPipe: GPURenderPipeline;
  private lampPipe: GPURenderPipeline;
  private data = new Float32Array(28);
  look: TownLook = { sunStrength: 1, light: [-0.45, -0.55, 0.7], daylight: 1, lamps: [0, 0, 0] };

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
  ) {
    const layout = device.createBindGroupLayout({
      label: "town mesh",
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    this.uniform = device.createBuffer({ label: "town mesh", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.bindGroup = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: this.uniform } }] });
    const module = createShader(device, "town mesh", townMeshWgsl);
    const pl = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] });
    const f = 4;
    const buffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: TOWN_VERTEX_FLOATS * f,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 3 * f, format: "float32x3" },
          { shaderLocation: 2, offset: 6 * f, format: "float32x3" },
          { shaderLocation: 3, offset: 9 * f, format: "float32x4" },
          { shaderLocation: 4, offset: 13 * f, format: "float32" },
          { shaderLocation: 5, offset: 14 * f, format: "float32" },
        ],
      },
    ];
    const pipe = (label: string, fs: string, depthWrite: boolean, blend?: GPUBlendState, depthBias = 0) =>
      device.createRenderPipeline({
        label,
        layout: pl,
        vertex: { module, entryPoint: "vs", buffers },
        fragment: { module, entryPoint: fs, targets: [{ format: target.format, blend }] },
        primitive: { topology: "triangle-list", cullMode: "none" }, // models are drawn double-sided, like the old layer
        depthStencil: {
          format: target.depthFormat,
          depthWriteEnabled: depthWrite,
          depthCompare: "greater-equal", // reversed Z: LEQUAL of the old layer
          depthBias,
          depthBiasSlopeScale: depthBias ? 1 : 0,
        },
        multisample: { count: target.sampleCount },
      });
    // Roads ride 8 cm over the ground (groundSeat.ts ROAD_LIFT); a little bias keeps them over the terrain's own
    // triangles, which follow the DEM a few centimetres differently from our samples.
    this.roadPipe = pipe("town roads", "fs", false, undefined, 4);
    this.buildingPipe = pipe("town buildings", "fs", true);
    const add: GPUBlendState = { color: { srcFactor: "one", dstFactor: "one" }, alpha: { srcFactor: "one", dstFactor: "one" } };
    this.lampPipe = pipe("town lamps", "lampFs", false, add);
  }

  // The town origin (the founding point): every vertex is east/north/up metres from it, at height 0 on the ellipsoid.
  setOrigin(lat: number, lng: number): void {
    this.origin = geodeticToEcef(lat, lng, 0);
    this.axes = enuAt(lat, lng);
  }

  setMeshes(roads: TownMeshData, buildings: TownMeshData): void {
    this.free(this.roads);
    this.free(this.buildings);
    this.roads = this.upload(roads, "town roads");
    this.buildings = this.upload(buildings, "town buildings");
  }

  // The broken walls of the buried old city: a mesh of its own, so showing and hiding them rebuilds nothing.
  setRuins(ruins: TownMeshData): void {
    this.free(this.ruins);
    this.ruins = this.upload(ruins, "town ruins");
  }

  update(view: CameraView, _engine: Engine): void {
    if (!this.origin || !this.axes) return;
    const d = this.data;
    const o = this.origin;
    const { east, north, up } = this.axes;
    const l = this.look;
    d.set([o[0] - view.eye[0], o[1] - view.eye[1], o[2] - view.eye[2], 0], 0);
    d.set([...east, 0, ...north, 0, ...up, 0], 4);
    d.set([...l.light, l.sunStrength], 16);
    d.set([l.daylight, 0, 0, 0], 20);
    d.set([...l.lamps, 0], 24);
    this.device.queue.writeBuffer(this.uniform, 0, d);
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.origin) return;
    pass.setBindGroup(1, this.bindGroup);
    const run = (pipe: GPURenderPipeline, m: Mesh | null) => {
      if (!m || !m.count) return;
      pass.setPipeline(pipe);
      pass.setVertexBuffer(0, m.vertices);
      pass.setIndexBuffer(m.indices, "uint32");
      pass.drawIndexed(m.count);
    };
    run(this.roadPipe, this.roads);
    run(this.buildingPipe, this.buildings);
    if (this.ruinsShown) run(this.buildingPipe, this.ruins);
    if (Math.max(...this.look.lamps) >= 0.01) run(this.lampPipe, this.buildings);
  }

  // Sun direction (ECEF) in the origin's east/north/up frame.
  toLocal(v: Vec3): Vec3 {
    const a = this.axes;
    return a ? [dot(v, a.east), dot(v, a.north), dot(v, a.up)] : [0, 0, 1];
  }

  private upload(m: TownMeshData, label: string): Mesh | null {
    if (!m.indices.length) return null;
    const vertices = this.device.createBuffer({ label, size: m.vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(vertices, 0, m.vertices);
    const indices = this.device.createBuffer({ label, size: m.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(indices, 0, m.indices);
    return { vertices, indices, count: m.indices.length };
  }

  private free(m: Mesh | null): void {
    m?.vertices.destroy();
    m?.indices.destroy();
  }
}
