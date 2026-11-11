import type { CameraView } from "../camera/camera";
import type { Engine, Drawable } from "../engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../geo/ellipsoid";
import type { RenderTarget } from "../gpu/device";
import { createShader } from "../gpu/wgsl";
import { SHADOW_DEPTH } from "../shadow/shadowMap";
import "../frame/frameUniforms";
import "../sky/atmosphere";
import townMeshWgsl from "./townMesh.wgsl?raw";

// The town's models (docs/PLAN-engine.md N4): two indexed meshes in metres in the east/north/up frame of the town
// origin, built by the game (view/engine/models.ts) from the same model builders the old map used. Roads first without
// depth writes (ribbons of two chains overlap at a junction, equal depths would flicker), then the buildings, then the
// window lights added on top; the old city's broken walls with the buildings while they are shown; the townspeople's
// figures (map/villagerModel.ts) last, a mesh the game rewrites several times a second. Uniforms carry the origin
// relative to the eye, so the meshes are camera-relative.

// Vertex: position 3, normal 3, colour 3, facade 4, height above own ground 1, lamp 1.
export const TOWN_VERTEX_FLOATS = 15;

// A figure's vertex: position 3, normal 3, colour 3 (villagerModel.ts).
export const FIGURE_VERTEX_FLOATS = 9;

// A contact shadow's vertex: position 3, place in the ellipse 2 (-1..1), strength 1; six vertices a shadow.
export const FOOT_VERTEX_FLOATS = 6;

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
  private figures: { buffer: GPUBuffer | null; capacity: number; vertices: number } = { buffer: null, capacity: 0, vertices: 0 };
  private feet: { buffer: GPUBuffer | null; capacity: number; vertices: number } = { buffer: null, capacity: 0, vertices: 0 };
  ruinsShown = false; // the old city's broken walls (setRuins), drawn with the buildings' pipeline while shown
  private meshVersion = 0;
  private shadowPipe: GPURenderPipeline;
  private uniform: GPUBuffer;
  private bindGroup: GPUBindGroup;
  private roadPipe: GPURenderPipeline;
  private buildingPipe: GPURenderPipeline;
  private lampPipe: GPURenderPipeline;
  private figurePipe: GPURenderPipeline;
  private footPipe: GPURenderPipeline;
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
    // Into the sun's shadow map: positions only, depth only.
    this.shadowPipe = device.createRenderPipeline({
      label: "town shadow",
      layout: pl,
      vertex: { module, entryPoint: "shadowVs", buffers },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: SHADOW_DEPTH,
    });
    this.figurePipe = device.createRenderPipeline({
      label: "town figures",
      layout: pl,
      vertex: {
        module,
        entryPoint: "figureVs",
        buffers: [
          {
            arrayStride: FIGURE_VERTEX_FLOATS * f,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * f, format: "float32x3" },
              { shaderLocation: 2, offset: 6 * f, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "figureFs", targets: [{ format: target.format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: true, depthCompare: "greater-equal" },
      multisample: { count: target.sampleCount },
    });
    // Contact shadows multiply what lies under them; biased like the roads, they lie a few centimetres over the ground.
    this.footPipe = device.createRenderPipeline({
      label: "town foot shadows",
      layout: pl,
      vertex: {
        module,
        entryPoint: "footVs",
        buffers: [
          {
            arrayStride: FOOT_VERTEX_FLOATS * f,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 3 * f, format: "float32x2" },
              { shaderLocation: 2, offset: 5 * f, format: "float32" },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: "footFs", targets: [{ format: target.format, blend: { color: { srcFactor: "zero", dstFactor: "src" }, alpha: { srcFactor: "zero", dstFactor: "one" } } }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: false, depthCompare: "greater-equal", depthBias: 4, depthBiasSlopeScale: 1 },
      multisample: { count: target.sampleCount },
    });
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
    this.meshVersion++;
  }

  // The broken walls of the buried old city: a mesh of its own, so showing and hiding them rebuilds nothing.
  setRuins(ruins: TownMeshData): void {
    this.free(this.ruins);
    this.ruins = this.upload(ruins, "town ruins");
    this.meshVersion++;
  }

  // What drawShadow draws: the buildings and the ruins while they are shown.
  get shadowVersion(): number {
    return this.meshVersion * 2 + (this.ruinsShown ? 1 : 0);
  }

  // The figures to draw now, `vertices` of them from the start of `data` (the last ones are replaced).
  setFigures(data: Float32Array<ArrayBuffer>, vertices: number): void {
    this.fill(this.figures, "town figures", FIGURE_VERTEX_FLOATS, data, vertices);
  }

  // The figures' contact shadows, six vertices each.
  setFootShadows(data: Float32Array<ArrayBuffer>, vertices: number): void {
    this.fill(this.feet, "town foot shadows", FOOT_VERTEX_FLOATS, data, vertices);
  }

  private fill(g: TownMesh["figures"], label: string, floats: number, data: Float32Array<ArrayBuffer>, vertices: number): void {
    if (vertices > g.capacity) {
      g.buffer?.destroy();
      g.capacity = Math.max(1024, 2 ** Math.ceil(Math.log2(vertices)));
      g.buffer = this.device.createBuffer({ label, size: g.capacity * floats * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    g.vertices = vertices;
    if (vertices && g.buffer) this.device.queue.writeBuffer(g.buffer, 0, data, 0, vertices * floats);
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
    for (const [pipe, g] of [[this.footPipe, this.feet], [this.figurePipe, this.figures]] as const) {
      if (!g.buffer || !g.vertices) continue;
      pass.setPipeline(pipe);
      pass.setVertexBuffer(0, g.buffer);
      pass.draw(g.vertices);
    }
  }

  // Buildings and ruins cast; the roads lie flat and the figures move, so they only receive.
  drawShadow(pass: GPURenderPassEncoder): void {
    if (!this.origin) return;
    pass.setBindGroup(1, this.bindGroup);
    pass.setPipeline(this.shadowPipe);
    for (const m of [this.buildings, this.ruinsShown ? this.ruins : null]) {
      if (!m || !m.count) continue;
      pass.setVertexBuffer(0, m.vertices);
      pass.setIndexBuffer(m.indices, "uint32");
      pass.drawIndexed(m.count);
    }
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
