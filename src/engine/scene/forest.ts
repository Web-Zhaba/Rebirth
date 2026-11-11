import type { CameraView } from "../camera/camera";
import { frustumPlanes, sphereInView as inside } from "../camera/frustum";
import type { Drawable, Engine } from "../engine";
import { ecefToGeodetic, enuAt, type Vec3 } from "../geo/ellipsoid";
import { lngLatToTile } from "../geo/mercator";
import type { RenderTarget } from "../gpu/device";
import type { HiZ } from "../frame/hiz";
import { GpuTimer } from "../gpu/timer";
import { createShader } from "../gpu/wgsl";
import { SHADOW_DEPTH } from "../shadow/shadowMap";
import { COVER_BLOCKS } from "../bake/drape";
import { EXAGGERATION, NO_PAGE, type Terrain } from "../terrain/terrain";
import { birchShare, coniferShare, COVER_TABLE, DETAIL_KINDS, DETAIL_SIZE, DETAIL_SPACING, RUIN_ADD, TREE_SIZE, TREE_SPACING } from "../../world/forestMix";
import "../frame/frameUniforms";
import { keepAt, SCATTER_ZOOM, steadyReach, strideLevel, thinReach, tileFrame, type TileFrame } from "./forestTiles";
import forestWgsl from "./forest.wgsl?raw";
import scatterWgsl from "./forestScatter.wgsl?raw";
import { bakeTreeAtlas, IMPOSTOR_STEP, IMPOSTOR_VIEWS, TREE_VERTEX_LAYOUT, uploadTreeMeshes, type TreeAtlas, type TreeMeshes, type TreeModelData } from "./treeAtlas";

// The forest on the GPU (docs/PLAN-engine.md N5): trees, bushes, reeds and boulders grown every frame by a compute
// pass (forestScatter.wgsl) from the cover pages (bake/drape.ts rasterCover), the height pages and the game's mask,
// over the tiles around the eye that lie in view (scene/forestTiles.ts), culled per candidate against the frustum and
// the reach of their kind, then drawn with indirect draws: models near, impostors far. Nothing about a tree lives on
// the CPU; the CPU picks tiles, sets the thinning so the expected count fits the budget, and hands over a job table.

// Kinds: conifer, broadleaf, birch (trees), bush, reed, boulder (details); a slot per (kind, level of detail).
export const FOREST_KINDS = 6;
const SLOTS = FOREST_KINDS * 2;
const CAPS = [24576, 65536, 24576, 65536, 24576, 65536, 12288, 32768, 12288, 32768, 12288, 32768];
const INSTANCE_BYTES = 32;

const MAX_TREES = 120_000; // expected trees in view
const MAX_DETAILS = 60_000;
const MAX_CANDIDATES = 3_000_000;
const TREE_NEAR = 700; // trees nearer than this are models (and never thinned)
const DETAIL_NEAR = 120;
const TREE_FAR_CAP = 12_000;
const DETAIL_FAR_CAP = 2_000;
const MIN_PX = 1.5; // drawn up to where a typical one is this many px tall
const SINK = 0.3; // m below the ground, so a slope does not show a floating root
const TILE_SLACK = 150; // m added to a tile's bounding sphere for its trees
const JOB_WORDS = 36;
const UNIFORM_FLOATS = 5 * 4 + 4 + 4 + 4 + 4 + 4 + 12 * 4 + 17 * 4 + 4 + 4 * 4 + 16 + 4 + 4;
const COUNTERS = 16; // the 12 slots, then frustum-culled and occluded candidates
const STATS_MS = 250;
const LOOK_FLOATS = 8 * 4 + 6 * 4 * 4 + 4;

export interface ForestKind {
  tall: number; // typical height (m): how far it is drawn
  season: 0 | 1 | 2; // what turns its crown: nothing, the leaves' year, the reeds' year
  sway: number;
  leaf: [number, number, number]; // the colour its crown is built with
}

export interface ForestLook {
  light: Vec3; // in the target's east/north/up frame
  sunStrength: number;
  daylight: number; // 1 day .. 0 night
  time: number; // s, for the sway
  wind: number; // 0..1
  windDir: [number, number]; // east/north
  bare: [number, number, number];
  snowColour: [number, number, number];
  kinds: { colA: [number, number, number]; colB: [number, number, number]; snow: number; bare: number }[];
}

// The game's mask over a square of web mercator (0..1 units): red how much of the growth is blocked (1 lots, roads,
// zones, fields; a clearing's progress), green the ruins (where bushes and stones add).
export interface ForestMask {
  rgba: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
  box: [number, number, number, number]; // mercator x0, y0, x1, y1
}

export interface ForestStats {
  jobs: number;
  candidates: number;
  reach: number;
  expected: number; // trees the budget expects at that reach
}

// What the GPU did with the candidates (read back a few times a second): drawn per slot (kind x level of detail, over
// capacity included), and how many in reach the frustum and the occluders took.
export interface ForestCulling {
  slots: number[];
  drawn: number;
  frustum: number;
  occluded: number;
}

interface TileInfo extends TileFrame {
  seed: number;
  lo: number; // drawn height range over the tile (0..0 until a page covers it)
  hi: number;
  source: number; // the height page the range came from (terrain.ranges.source), NaN = not yet read
}

export class Forest implements Drawable {
  grow = 0; // 0 hides the forest, 1 full size (the view eases it in with the scale)
  look: ForestLook | null = null;
  stats: ForestStats = { jobs: 0, candidates: 0, reach: Infinity, expected: 0 };
  culling: ForestCulling = { slots: [], drawn: 0, frustum: 0, occluded: 0 };
  occlusion = true; // test against the Hi-Z (off: for comparisons)
  readonly timer: GpuTimer | null; // GPU time of the scatter pass, where timestamps are available
  private readonly meshes: TreeMeshes;
  private readonly atlas: TreeAtlas;
  private readonly kinds: readonly ForestKind[];
  private readonly scatterPipe: GPUComputePipeline;
  private readonly finalizePipe: GPUComputePipeline;
  private readonly meshPipe: GPURenderPipeline;
  private readonly shadowPipe: GPURenderPipeline;
  private readonly impostorPipe: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly lookBuffer: GPUBuffer;
  private readonly instances: GPUBuffer;
  private readonly counts: GPUBuffer;
  private readonly args: GPUBuffer;
  private jobs: GPUBuffer;
  private jobCapacity = 0;
  private scatterGroup: GPUBindGroup | null = null;
  private readonly drawGroup: GPUBindGroup;
  private maskTexture: GPUTexture;
  private maskBox: ForestMask["box"] | null = null;
  private readonly bases: number[] = [];
  private readonly data = new Float32Array(UNIFORM_FLOATS);
  private readonly lookData = new Float32Array(LOOK_FLOATS);
  private jobData = new ArrayBuffer(0);
  private total = 0;
  private jobCount = 0;
  private treeReach = Infinity;
  private detailReach = Infinity;
  private readonly tiles = new Map<number, TileInfo>();
  private hizVersion = -1;
  private statsRead: GPUBuffer;
  private statsBusy = false;
  private statsAt = 0;
  private statsWanted = false;
  private eye: Vec3 = [0, 0, 0]; // this frame's
  private scatterEye: Vec3 | null = null; // the eye the instances in the buffer were scattered for
  private castHash = 0;
  private castPending = false;
  shadowVersion = 0; // bumped when the instances the shadow pass draws changed (Drawable.shadowVersion)

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    private readonly terrain: Terrain,
    private readonly hiz: HiZ,
    models: readonly TreeModelData[],
    kinds: readonly ForestKind[],
  ) {
    this.kinds = kinds;
    this.timer = device.features.has("timestamp-query") ? new GpuTimer(device) : null;
    this.meshes = uploadTreeMeshes(device, models);
    this.atlas = bakeTreeAtlas(device, this.meshes, models, kinds.map((k) => k.leaf));

    let at = 0;
    for (const c of CAPS) (this.bases.push(at), (at += c));
    this.instances = device.createBuffer({ label: "forest instances", size: at * INSTANCE_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX });
    this.statsRead = device.createBuffer({ label: "forest stats", size: COUNTERS * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.counts = device.createBuffer({ label: "forest counts", size: COUNTERS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.args = device.createBuffer({ label: "forest draws", size: SLOTS * 5 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST });
    const args = new Uint32Array(SLOTS * 5);
    for (let k = 0; k < FOREST_KINDS; k++) {
      const r = this.meshes.ranges[k];
      args.set([r.count, 0, r.firstIndex, r.baseVertex, 0], k * 10); // drawIndexedIndirect
      args.set([4, 0, 0, 0, 0], k * 10 + 5); // drawIndirect: a quad as a strip
    }
    device.queue.writeBuffer(this.args, 0, args);
    this.uniform = device.createBuffer({ label: "forest scatter", size: this.data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.lookBuffer = device.createBuffer({ label: "forest look", size: this.lookData.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.jobs = this.jobBuffer(256);
    this.maskTexture = this.createMask(null);

    const scatterModule = createShader(device, "forest scatter", scatterWgsl);
    const compute = (entryPoint: string) => device.createComputePipeline({ label: `forest ${entryPoint}`, layout: "auto", compute: { module: scatterModule, entryPoint } });
    this.scatterPipe = compute("scatter");
    this.finalizePipe = compute("finalize");

    const module = createShader(device, "forest", forestWgsl, { IMPOSTOR_VIEWS, IMPOSTOR_STEP });
    const drawLayout = device.createBindGroupLayout({
      label: "forest",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d-array" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: "2d-array" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    this.drawGroup = device.createBindGroup({
      layout: drawLayout,
      entries: [
        { binding: 0, resource: { buffer: this.lookBuffer } },
        { binding: 1, resource: this.atlas.color.createView({ dimension: "2d-array" }) },
        { binding: 2, resource: this.atlas.data.createView({ dimension: "2d-array" }) },
        { binding: 3, resource: device.createSampler({ minFilter: "linear", magFilter: "linear", mipmapFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }) },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, drawLayout] });
    const instanceLayout: GPUVertexBufferLayout = {
      arrayStride: INSTANCE_BYTES,
      stepMode: "instance",
      attributes: [
        { shaderLocation: 4, offset: 0, format: "float32x4" },
        { shaderLocation: 5, offset: 16, format: "float32x4" },
      ],
    };
    const depthStencil: GPUDepthStencilState = { format: target.depthFormat, depthWriteEnabled: true, depthCompare: "greater" };
    this.meshPipe = device.createRenderPipeline({
      label: "forest models",
      layout,
      vertex: { module, entryPoint: "meshVs", buffers: [TREE_VERTEX_LAYOUT, instanceLayout] },
      fragment: { module, entryPoint: "meshFs", targets: [{ format: target.format }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
      multisample: { count: target.sampleCount },
    });
    this.shadowPipe = device.createRenderPipeline({
      label: "forest shadow",
      layout,
      vertex: { module, entryPoint: "meshShadowVs", buffers: [TREE_VERTEX_LAYOUT, instanceLayout] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: SHADOW_DEPTH,
    });
    this.impostorPipe = device.createRenderPipeline({
      label: "forest impostors",
      layout,
      vertex: { module, entryPoint: "impostorVs", buffers: [instanceLayout] },
      fragment: { module, entryPoint: "impostorFs", targets: [{ format: target.format }] },
      primitive: { topology: "triangle-strip" },
      depthStencil,
      multisample: { count: target.sampleCount, alphaToCoverageEnabled: target.sampleCount > 1 },
    });
  }

  // The game's mask, or null where there is no town.
  setMask(mask: ForestMask | null): void {
    this.maskTexture.destroy();
    this.maskTexture = this.createMask(mask);
    this.maskBox = mask?.box ?? null;
    this.scatterGroup = null;
  }

  update(view: CameraView, engine: Engine): void {
    this.eye = view.eye;
    this.prepare(view, engine);
    this.noteCasters();
  }

  // The shadow pass draws the instances last frame's scatter made, so a change of them reaches it one frame later: the
  // version is bumped on the frame after the job table, the growth or the crowns changed.
  private noteCasters(): void {
    let h = Math.imul(this.jobCount + 1, 31) + Math.round(this.grow * 1000);
    const words = new Uint32Array(this.jobData, 0, this.jobCount * JOB_WORDS);
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 16777619);
    for (const k of this.look?.kinds ?? []) h = Math.imul(h ^ Math.round(k.bare * 1000), 16777619);
    if (this.castPending) this.shadowVersion++;
    this.castPending = h !== this.castHash;
    this.castHash = h;
  }

  private prepare(view: CameraView, engine: Engine): void {
    this.total = 0;
    this.jobCount = 0;
    if (this.grow <= 0 || !this.look) return;
    const eyeGeo = ecefToGeodetic(view.eye);
    // How far a typical one of each kind is still MIN_PX tall.
    const farOf = (tall: number) => (tall * 0.5 * view.viewportH) / view.tanHalfY / MIN_PX;
    const treeFar = Math.min(TREE_FAR_CAP, farOf(this.kinds[0].tall));
    const detailFar = DETAIL_KINDS.map((_, i) => Math.min(DETAIL_FAR_CAP, farOf(this.kinds[3 + i].tall)));
    const maxFar = Math.max(treeFar, ...detailFar);
    if (view.eyeAboveGround > maxFar) return;

    const planes = frustumPlanes(view);
    const z = SCATTER_ZOOM;
    const n = 2 ** z;
    const at = lngLatToTile(eyeGeo.lng, eyeGeo.lat, z);
    const width = (2 * Math.PI * 6378137 * Math.cos((eyeGeo.lat * Math.PI) / 180)) / n;
    const span = Math.ceil(maxFar / width) + 1;
    type Want = { tile: TileInfo; x: number; y: number; group: number; grid: number; d: number; dMin: number; n: number };
    const trees: Want[] = [];
    const details: Want[] = [];
    const mask = this.maskBox;
    for (let ty = Math.max(0, Math.floor(at.y) - span); ty <= Math.min(n - 1, Math.floor(at.y) + span); ty++)
      for (let tx0 = Math.floor(at.x) - span; tx0 <= Math.floor(at.x) + span; tx0++) {
        const tx = ((tx0 % n) + n) % n;
        const t = this.tile(tx, ty);
        // Bounding sphere over the tile's relief: centred halfway up its height range, wide enough for both ends.
        const h = (t.lo + t.hi) / 2;
        const radius = Math.hypot(t.radius, (t.hi - t.lo) / 2) + TILE_SLACK;
        const c: Vec3 = [t.centre[0] + t.up[0] * h - view.eye[0], t.centre[1] + t.up[1] * h - view.eye[1], t.centre[2] + t.up[2] * h - view.eye[2]];
        const d = Math.hypot(c[0], c[1], c[2]);
        const dMin = Math.max(1, d - radius);
        if (dMin > maxFar) continue;
        if (!inside(planes, c, radius)) continue;
        const cover = this.terrain.drape.best(z, tx, ty);
        if (!cover) continue;
        const ruins = mask !== null && tx0 / n < mask[2] && (tx0 + 1) / n > mask[0] && ty / n < mask[3] && (ty + 1) / n > mask[1];
        const [tree, ...detail] = blockShares(cover, tx, ty);
        if (tree > 0 && dMin < treeFar) {
          const grid = Math.max(8, Math.round(t.width / TREE_SPACING));
          trees.push({ tile: t, x: tx0, y: ty, group: 0, grid, d, dMin, n: grid * grid * tree });
        }
        DETAIL_KINDS.forEach((kind, i) => {
          const add = ruins ? [RUIN_ADD.bush, RUIN_ADD.reed, RUIN_ADD.boulder][i] : 0;
          if ((detail[i] <= 0 && add <= 0) || dMin >= detailFar[i]) return;
          const grid = Math.max(8, Math.round(t.width / DETAIL_SPACING[kind]));
          details.push({ tile: t, x: tx0, y: ty, group: 1 + i, grid, d, dMin, n: grid * grid * Math.max(detail[i], add * 0.05) });
        });
      }

    this.treeReach = steadyReach(this.treeReach, thinReach(trees, MAX_TREES, TREE_NEAR));
    this.detailReach = steadyReach(this.detailReach, thinReach(details, MAX_DETAILS, DETAIL_NEAR));
    const all = [...trees, ...details].sort((a, b) => a.d - b.d);

    // The job table, nearest first, until the candidate budget runs out.
    if (all.length > this.jobCapacity) this.jobs = this.jobBuffer(all.length);
    const words = new Uint32Array(this.jobData);
    const floats = new Float32Array(this.jobData);
    let total = 0;
    let count = 0;
    for (const w of all) {
      const reach = w.group ? this.detailReach : this.treeReach;
      const level = strideLevel(w.dMin, reach);
      const stride = 2 ** level;
      const cols = Math.ceil(w.grid / stride);
      if (total + cols * cols > MAX_CANDIDATES) break;
      const t = w.tile;
      const tx = ((w.x % n) + n) % n;
      const o = count * JOB_WORDS;
      // the tile's north-west corner, eye-relative: centre - (east + south) / 2 (f64 here, f32 on the GPU)
      for (let i = 0; i < 3; i++) {
        floats[o + i] = t.centre[i] - 0.5 * (t.east[i] + t.south[i]) - view.eye[i];
        floats[o + 4 + i] = t.east[i];
        floats[o + 8 + i] = t.south[i];
      }
      words[o + 3] = total;
      words[o + 7] = cols;
      words[o + 11] = w.grid;
      words[o + 12] = stride;
      words[o + 13] = w.group;
      words[o + 14] = t.seed;
      const hp = this.terrain.pages.best(z, tx, w.y);
      words[o + 15] = hp ? hp.layer : NO_PAGE;
      const cp = this.terrain.drape.best(z, tx, w.y)!;
      words[o + 16] = cp.layer;
      pageUv(floats, o + 20, tx, w.y, hp);
      pageUv(floats, o + 24, tx, w.y, cp);
      if (mask) {
        const sx = 1 / n / (mask[2] - mask[0]);
        const sy = 1 / n / (mask[3] - mask[1]);
        floats.set([(w.x / n - mask[0]) / (mask[2] - mask[0]), (w.y / n - mask[1]) / (mask[3] - mask[1]), sx, sy], o + 28);
      } else floats.set([0, 0, 0, 0], o + 28);
      floats.set([coniferShare(t.lat), birchShare(t.lat), 4 ** -level, 0], o + 32);
      total += cols * cols;
      count++;
    }
    this.total = total;
    this.jobCount = count;
    this.stats = { jobs: count, candidates: total, reach: this.treeReach, expected: Math.round(trees.reduce((a, t) => a + (t.d < TREE_NEAR ? t.n : t.n * keepAt(t.d, this.treeReach)), 0)) };
    if (!count) return;
    this.device.queue.writeBuffer(this.jobs, 0, this.jobData, 0, count * JOB_WORDS * 4);

    const up = enuAt(engine.state.lat, engine.state.lng);
    const d = this.data;
    let k = 0;
    const put = (...v: number[]) => (d.set(v, k), (k += v.length));
    for (const p of planes) put(...p);
    const groups = Math.ceil(total / 64);
    put(0, 0, 0, total);
    new Uint32Array(d.buffer).set([count, Math.min(groups, 65535) * 64, 0, 0], k);
    k += 4;
    put(treeFar, ...detailFar);
    put(this.treeReach === Infinity ? 1e9 : this.treeReach, this.detailReach === Infinity ? 1e9 : this.detailReach, this.grow, EXAGGERATION);
    put(TREE_NEAR, DETAIL_NEAR, SINK, 0);
    const u = new Uint32Array(d.buffer);
    for (let s = 0; s < SLOTS; s++) (u.set([this.bases[s], CAPS[s], 0, 0], k), (k += 4));
    put(0, 0, 0, 0); // cover id 0: nothing grows
    for (const c of COVER_TABLE) put(c.tree ? 1 : 0, c.bush, c.reed, c.boulder);
    put(0, RUIN_ADD.bush, RUIN_ADD.reed, RUIN_ADD.boulder);
    put(...TREE_SIZE, 0);
    DETAIL_KINDS.forEach((kind) => put(...DETAIL_SIZE[kind], Math.max(...COVER_TABLE.map((c) => c[kind])) + RUIN_ADD[kind], 0));
    put(...view.viewProj);
    const hz = this.hiz.texture;
    put(view.near, view.tanHalfY * view.aspect, view.tanHalfY, this.occlusion && hz ? this.hiz.levels : 0);
    put(hz?.width ?? 1, hz?.height ?? 1, 0, 0);
    if (k !== UNIFORM_FLOATS) throw new Error(`forest uniform out of step with forestScatter.wgsl: ${k}`);
    this.device.queue.writeBuffer(this.uniform, 0, d);
    this.writeLook(up);
  }

  compute(encoder: GPUCommandEncoder): void {
    if (!this.jobCount) return;
    this.scatterEye = this.eye;
    encoder.clearBuffer(this.counts);
    if (this.hiz.version !== this.hizVersion) (this.hizVersion = this.hiz.version), (this.scatterGroup = null);
    const group = (this.scatterGroup ??= this.device.createBindGroup({
      layout: this.scatterPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: this.jobs } },
        { binding: 2, resource: { buffer: this.instances } },
        { binding: 3, resource: { buffer: this.counts } },
        { binding: 5, resource: this.terrain.pages.texture.createView({ dimension: "2d-array" }) },
        { binding: 6, resource: this.terrain.drape.cover.createView({ dimension: "2d-array" }) },
        { binding: 7, resource: this.maskTexture.createView() },
        { binding: 8, resource: this.hiz.texture!.createView() },
      ],
    }));
    const pass = encoder.beginComputePass({ label: "forest scatter", timestampWrites: this.timer?.passWrites() });
    pass.setPipeline(this.scatterPipe);
    pass.setBindGroup(0, group);
    const groups = Math.ceil(this.total / 64);
    const x = Math.min(groups, 65535);
    pass.dispatchWorkgroups(x, Math.ceil(groups / x));
    pass.setPipeline(this.finalizePipe);
    pass.setBindGroup(0, this.finalizeGroup());
    pass.dispatchWorkgroups(1);
    pass.end();
    this.timer?.resolveInto(encoder);
    this.statsWanted = !this.statsBusy && performance.now() - this.statsAt > STATS_MS;
    if (this.statsWanted) encoder.copyBufferToBuffer(this.counts, 0, this.statsRead, 0, COUNTERS * 4);
  }

  // After the frame's submit (the engine calls it): read the scatter's time back.
  afterSubmit(): void {
    this.timer?.afterSubmit();
    if (!this.statsWanted) return;
    this.statsWanted = false;
    this.statsBusy = true;
    this.statsAt = performance.now();
    this.statsRead
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const c = new Uint32Array(this.statsRead.getMappedRange()).slice();
        this.statsRead.unmap();
        const slots = [...c.subarray(0, SLOTS)];
        this.culling = { slots, drawn: slots.reduce((a, n, s) => a + Math.min(n, CAPS[s]), 0), frustum: c[SLOTS], occluded: c[SLOTS + 1] };
      })
      .catch(() => {})
      .finally(() => (this.statsBusy = false));
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.jobCount) return;
    pass.setBindGroup(1, this.drawGroup);
    pass.setPipeline(this.meshPipe);
    pass.setVertexBuffer(0, this.meshes.vertices);
    pass.setIndexBuffer(this.meshes.indices, "uint32");
    for (let k = 0; k < FOREST_KINDS; k++) {
      pass.setVertexBuffer(1, this.instances, this.bases[k * 2] * INSTANCE_BYTES, CAPS[k * 2] * INSTANCE_BYTES);
      pass.drawIndexedIndirect(this.args, k * 2 * 20);
    }
    pass.setPipeline(this.impostorPipe);
    for (let k = 0; k < FOREST_KINDS; k++) {
      pass.setVertexBuffer(0, this.instances, this.bases[k * 2 + 1] * INSTANCE_BYTES, CAPS[k * 2 + 1] * INSTANCE_BYTES);
      pass.drawIndirect(this.args, (k * 2 + 1) * 20);
    }
  }

  // Into the sun's shadow map: the near models only (impostors stand far beyond the map).
  drawShadow(pass: GPURenderPassEncoder): void {
    if (!this.jobCount || !this.scatterEye) return;
    pass.setBindGroup(1, this.drawGroup);
    pass.setPipeline(this.shadowPipe);
    pass.setVertexBuffer(0, this.meshes.vertices);
    pass.setIndexBuffer(this.meshes.indices, "uint32");
    for (let k = 0; k < FOREST_KINDS; k++) {
      pass.setVertexBuffer(1, this.instances, this.bases[k * 2] * INSTANCE_BYTES, CAPS[k * 2] * INSTANCE_BYTES);
      pass.drawIndexedIndirect(this.args, k * 2 * 20);
    }
  }

  private finalizeGroupCache: GPUBindGroup | null = null;
  private finalizeGroup(): GPUBindGroup {
    return (this.finalizeGroupCache ??= this.device.createBindGroup({
      layout: this.finalizePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 3, resource: { buffer: this.counts } },
        { binding: 4, resource: { buffer: this.args } },
      ],
    }));
  }

  private writeLook(axes: { east: Vec3; north: Vec3; up: Vec3 }): void {
    const l = this.look!;
    const d = this.lookData;
    d.set([...axes.east, 0, ...axes.north, 0, ...axes.up, 0, ...l.light, l.sunStrength, l.daylight, l.time, l.wind, 0, ...l.windDir, 0, 0, ...l.bare, 0, ...l.snowColour, 0], 0);
    for (let k = 0; k < FOREST_KINDS; k++) {
      const info = this.kinds[k];
      const s = l.kinds[k];
      d.set([info.season, info.sway, s.snow, s.bare], 32 + k * 4);
      d.set([...s.colA, this.atlas.radius[k]], 56 + k * 4);
      d.set([...s.colB, 0], 80 + k * 4);
      d.set([...info.leaf, 0], 104 + k * 4);
    }
    const se = this.scatterEye ?? this.eye;
    d.set([se[0] - this.eye[0], se[1] - this.eye[1], se[2] - this.eye[2], 0], 128);
    this.device.queue.writeBuffer(this.lookBuffer, 0, d);
  }

  private tile(x: number, y: number): TileInfo {
    const key = y * 2 ** SCATTER_ZOOM + x;
    let t = this.tiles.get(key);
    if (!t) {
      if (this.tiles.size > 20000) this.tiles.clear();
      t = { ...tileFrame(x, y), seed: (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0, lo: 0, hi: 0, source: NaN };
      this.tiles.set(key, t);
    }
    // The range follows the page the scatter reads the heights from, refined as finer pages stream in.
    const ranges = this.terrain.ranges;
    const src = ranges.source!(SCATTER_ZOOM, x, y);
    if (src !== t.source) {
      t.source = src;
      const r = ranges.range(SCATTER_ZOOM, x, y);
      t.lo = r?.min ?? 0;
      t.hi = r?.max ?? 0;
    }
    return t;
  }

  private jobBuffer(jobs: number): GPUBuffer {
    this.jobs?.destroy();
    this.jobCapacity = 2 ** Math.ceil(Math.log2(Math.max(256, jobs)));
    this.jobData = new ArrayBuffer(this.jobCapacity * JOB_WORDS * 4);
    this.scatterGroup = null;
    return this.device.createBuffer({ label: "forest jobs", size: this.jobData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  }

  private createMask(mask: ForestMask | null): GPUTexture {
    const w = mask?.width ?? 1;
    const h = mask?.height ?? 1;
    const t = this.device.createTexture({ label: "forest mask", size: [w, h], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.device.queue.writeTexture({ texture: t }, mask?.rgba ?? new Uint8Array(4), { bytesPerRow: w * 4 }, [w, h]);
    return t;
  }
}

// The mean tree, bush, reed and boulder share of the cover blocks under tile (SCATTER_ZOOM, x, y).
function blockShares(page: { z: number; x: number; y: number; blocks: Float32Array }, x: number, y: number): number[] {
  const k = 2 ** (SCATTER_ZOOM - page.z);
  const B = COVER_BLOCKS;
  const u = ((x - page.x * k) / k) * B;
  const v = ((y - page.y * k) / k) * B;
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const i1 = Math.max(i0, Math.ceil(u + B / k) - 1);
  const j1 = Math.max(j0, Math.ceil(v + B / k) - 1);
  const out = [0, 0, 0, 0];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let g = 0; g < 4; g++) out[g] += page.blocks[(j * B + i) * 4 + g];
  const n = (i1 - i0 + 1) * (j1 - j0 + 1);
  return out.map((s) => s / n);
}

// Tile (SCATTER_ZOOM, x, y) uv -> a page's uv: offset xy, scale z.
function pageUv(out: Float32Array, o: number, x: number, y: number, page: { z: number; x: number; y: number } | null): void {
  if (!page) return void out.set([0, 0, 1, 0], o);
  const k = 2 ** (SCATTER_ZOOM - page.z);
  out.set([(x - page.x * k) / k, (y - page.y * k) / k, 1 / k, 0], o);
}
