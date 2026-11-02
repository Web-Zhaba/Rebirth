import type { FeatureCollection } from "geojson";
import type { CameraState } from "../camera/camera";
import { createShader } from "../gpu/wgsl";
import { buildLayer, CIRCLE_FLOATS, EQUATOR, FILL_FLOATS, levelSquare, LINE_FLOATS, mercX, mercY, type OverlayStyle } from "./geometry";
import overlayWgsl from "./overlay.wgsl?raw";

// The game's 2D drawings on the ground (docs/PLAN-engine.md section 4: tool previews, zones, road lines, lots...),
// rasterised on the GPU into squares of web mercator around the camera target: levels 1.5, 6 and 24 camera distances
// wide, 2048 texels each (the near one about a screen pixel per texel at the target). The terrain samples them by its own mercator uv, so
// the drawings follow every slope exactly and never fight the ground for depth. A level is redrawn only when its
// square moves a step, the screen scale changes, or the data changes.

export const OVERLAY_SIZE = 2048;
const LEVEL_SIDES = [1.5, 6, 24]; // camera distances across each level
export const OVERLAY_LEVELS = LEVEL_SIDES.length;
const FORMAT: GPUTextureFormat = "rgba8unorm-srgb";

export interface OverlayLayer {
  source: string; // data key: several layers can draw one source (a fill and its outline)
  style: OverlayStyle;
  maxMpp?: number; // drawn only while the view is at least this close (metres per CSS px at the target)
}

interface Built {
  fills: GPUBuffer | null;
  fillCount: number;
  lines: GPUBuffer | null;
  lineCount: number;
  circles: GPUBuffer | null;
  circleCount: number;
}

export interface LevelSquare {
  x0: number; // mercator metres
  y0: number;
  side: number;
  texPerPx: number; // texels per screen px the level was drawn for
  valid: boolean;
}

export class OverlayRaster {
  readonly texture: GPUTexture;
  readonly levels: LevelSquare[] = LEVEL_SIDES.map(() => ({ x0: 0, y0: 0, side: 1, texPerPx: 0, valid: false }));
  private layers: OverlayLayer[] = [];
  private data = new Map<string, FeatureCollection>();
  private built: (Built | null)[] = [];
  private anchor: [number, number] | null = null;
  private dirty = true;
  private shown: boolean[] = []; // layers within their scale, as last drawn
  private uniforms: GPUBuffer[];
  private bindGroups: GPUBindGroup[];
  private fillPipe: GPURenderPipeline;
  private linePipe: GPURenderPipeline;
  private circlePipe: GPURenderPipeline;
  private views: GPUTextureView[];

  constructor(private readonly device: GPUDevice) {
    this.texture = device.createTexture({
      label: "overlay levels",
      size: [OVERLAY_SIZE, OVERLAY_SIZE, OVERLAY_LEVELS],
      format: FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.views = LEVEL_SIDES.map((_, i) => this.texture.createView({ dimension: "2d", baseArrayLayer: i, arrayLayerCount: 1 }));
    const layout = device.createBindGroupLayout({ label: "overlay level", entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } }] });
    this.uniforms = LEVEL_SIDES.map(() => device.createBuffer({ label: "overlay level", size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    this.bindGroups = this.uniforms.map((buffer) => device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer } }] }));
    const module = createShader(device, "overlay", overlayWgsl);
    const pl = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const blend: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    const target: GPUColorTargetState = { format: FORMAT, blend };
    const pipe = (label: string, vs: string, fs: string, buffers: GPUVertexBufferLayout[], topology: GPUPrimitiveTopology) =>
      device.createRenderPipeline({ label, layout: pl, vertex: { module, entryPoint: vs, buffers }, fragment: { module, entryPoint: fs, targets: [target] }, primitive: { topology } });
    this.fillPipe = pipe(
      "overlay fills",
      "fillVs",
      "fillFs",
      [{ arrayStride: FILL_FLOATS * 4, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x2" }, { shaderLocation: 1, offset: 8, format: "float32" }, { shaderLocation: 2, offset: 12, format: "float32" }] }],
      "triangle-list",
    );
    this.linePipe = pipe(
      "overlay lines",
      "lineVs",
      "lineFs",
      [
        {
          arrayStride: LINE_FLOATS * 4,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x4" },
            { shaderLocation: 2, offset: 32, format: "float32x2" },
          ],
        },
      ],
      "triangle-strip",
    );
    this.circlePipe = pipe(
      "overlay circles",
      "circleVs",
      "circleFs",
      [
        {
          arrayStride: CIRCLE_FLOATS * 4,
          stepMode: "instance",
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x4" },
            { shaderLocation: 1, offset: 16, format: "float32x2" },
          ],
        },
      ],
      "triangle-strip",
    );
  }

  // The layers in paint order (bottom first). Replaces the previous list.
  setLayers(layers: OverlayLayer[]): void {
    this.layers = layers;
    this.built.forEach((b) => b && free(b));
    this.built = layers.map(() => null);
    this.dirty = true;
  }

  setData(source: string, data: FeatureCollection): void {
    this.data.set(source, data);
    if (!this.anchor) {
      const p = firstPoint(data);
      if (p) this.anchor = [mercX(p[0]), mercY(p[1])];
    }
    this.layers.forEach((l, i) => {
      if (l.source !== source) return;
      const b = this.built[i];
      if (b) free(b);
      this.built[i] = null;
    });
    this.dirty = true;
  }

  // Re-rasterise the levels that need it for this camera. `mpp` is metres per CSS px at the target.
  update(s: CameraState, mpp: number): void {
    const cx = mercX(s.lng);
    const cy = mercY(s.lat);
    const sec = 1 / Math.cos((s.lat * Math.PI) / 180);

    const any = this.anchor !== null && this.layers.length > 0;
    const shown = this.layers.map((l) => l.maxMpp === undefined || mpp <= l.maxMpp);
    if (shown.some((v, i) => v !== this.shown[i])) {
      this.shown = shown;
      this.dirty = true;
    }
    let encoder: GPUCommandEncoder | null = null;
    for (let i = 0; i < OVERLAY_LEVELS; i++) {
      const sq = levelSquare(cx, cy, LEVEL_SIDES[i] * s.distance * sec);
      const lv = this.levels[i];
      // Texels per screen px: how the px widths of lines and circles map into this level.
      const texelGroundM = sq.side / sec / OVERLAY_SIZE;
      const texPerPx = mpp / texelGroundM;
      const scaleChanged = lv.texPerPx === 0 || Math.abs(Math.log2(texPerPx / lv.texPerPx)) > 0.35;
      if (!this.dirty && lv.valid === any && lv.x0 === sq.x0 && lv.y0 === sq.y0 && lv.side === sq.side && !scaleChanged) continue;
      Object.assign(lv, sq, { texPerPx, valid: any });
      encoder ??= this.device.createCommandEncoder({ label: "overlay" });
      this.render(encoder, i, lv);
    }
    this.dirty = false;
    if (encoder) this.device.queue.submit([encoder.finish()]);
  }

  // A tile's corner and size inside a level, in level uv (f64 math, stored f32 by the caller).
  nodeUv(level: number, z: number, x: number, y: number, out: Float32Array, at: number): void {
    const lv = this.levels[level];
    const tile = EQUATOR / 2 ** z;
    out[at] = (x * tile - lv.x0) / lv.side;
    out[at + 1] = (y * tile - lv.y0) / lv.side;
    out[at + 2] = tile / lv.side;
    out[at + 3] = lv.valid ? 1 : 0;
  }

  private render(encoder: GPUCommandEncoder, i: number, lv: LevelSquare): void {
    const pass = encoder.beginRenderPass({ label: `overlay level ${i}`, colorAttachments: [{ view: this.views[i], clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" }] });
    if (lv.valid && this.anchor) {
      const [ax, ay] = this.anchor;
      // uv = p / side + (anchor - corner) / side, in f64 here so the offset keeps its precision.
      const u = new Float32Array([1 / lv.side, (ax - lv.x0) / lv.side, (ay - lv.y0) / lv.side, OVERLAY_SIZE, OVERLAY_SIZE / lv.side, lv.texPerPx, 0, 0]);
      this.device.queue.writeBuffer(this.uniforms[i], 0, u);
      pass.setBindGroup(0, this.bindGroups[i]);
      this.layers.forEach((layer, k) => {
        if (!this.shown[k]) return;
        const b = this.geometry(k, layer);
        if (!b) return;
        if (b.fillCount) {
          pass.setPipeline(this.fillPipe);
          pass.setVertexBuffer(0, b.fills);
          pass.draw(b.fillCount);
        }
        if (b.lineCount) {
          pass.setPipeline(this.linePipe);
          pass.setVertexBuffer(0, b.lines);
          pass.draw(4, b.lineCount);
        }
        if (b.circleCount) {
          pass.setPipeline(this.circlePipe);
          pass.setVertexBuffer(0, b.circles);
          pass.draw(4, b.circleCount);
        }
      });
    }
    pass.end();
  }

  private geometry(k: number, layer: OverlayLayer): Built | null {
    const have = this.built[k];
    if (have) return have;
    const data = this.data.get(layer.source);
    if (!data || !this.anchor) return null;
    const g = buildLayer(data, layer.style, this.anchor);
    const buf = (a: Float32Array<ArrayBuffer>, label: string) => {
      if (!a.length) return null;
      const b = this.device.createBuffer({ label, size: a.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(b, 0, a);
      return b;
    };
    const b: Built = {
      fills: buf(g.fills, `${layer.source} fills`),
      fillCount: g.fills.length / FILL_FLOATS,
      lines: buf(g.lines, `${layer.source} lines`),
      lineCount: g.lines.length / LINE_FLOATS,
      circles: buf(g.circles, `${layer.source} circles`),
      circleCount: g.circles.length / CIRCLE_FLOATS,
    };
    this.built[k] = b;
    return b;
  }
}

function free(b: Built): void {
  b.fills?.destroy();
  b.lines?.destroy();
  b.circles?.destroy();
}

function firstPoint(fc: FeatureCollection): number[] | null {
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || g.type === "GeometryCollection") continue;
    let c: unknown = g.coordinates;
    while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
    if (Array.isArray(c) && typeof c[0] === "number") return c as number[];
  }
  return null;
}
