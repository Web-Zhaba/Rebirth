import type { RenderTarget } from "../gpu/device";
import type { CameraView } from "../camera/camera";
import { ecefToGeodetic, type Vec3 } from "../geo/ellipsoid";
import { MAX_MERCATOR_LAT, tileKey } from "../geo/mercator";
import { createShader } from "../gpu/wgsl";
import { DEM_SIZE } from "../bake/terrarium";
import { DRAPE_MAX_ZOOM } from "../bake/drape";
import type { DrapeResponse } from "../bake/drapeWorker";
import { demStream, TileStream } from "../stream/demStream";
import { OVERLAY_LEVELS, type OverlayRaster } from "../overlay/overlayRaster";
import { DrapePages, type DrapePage } from "./drapePages";
import { DEM_MAX_ZOOM, HeightPages, type Page } from "./heightPages";
import { morphBand } from "./morph";
import { buildIndices, buildNodeVertices, CAP_NORTH, capFlags, GRID, NODE_FLOATS, nodeOrigin, poleLocal } from "./nodeMesh";
import { DEFAULT_TAU, MAX_ZOOM, MERGE, NodeCache, projScale, selectNodes, type HeightRanges, type NodeInfo, type SelectView } from "./quadtree";
import "../frame/frameUniforms";
import "../sky/atmosphere";
import terrainWgsl from "./terrain.wgsl?raw";

// Globe terrain renderer: quadtree selection, vertex slots, height pages, the per-frame chunk table and one instanced
// draw. Lives on the main thread; DEM decoding is in the bake worker. Vertex blocks are built here: with separable trig
// (nodeMesh.ts) a node costs ~20 us, so a worker round trip would not pay.

export const EXAGGERATION = 1.6; // MapLibre relief (src/map/relief.ts RELIEF_EXAGGERATION)

const MAX_NODES = 4096; // chunk-table capacity per frame
const SLOTS = 1024; // resident node vertex blocks
const NODE_STRIDE = 40; // floats per chunk-table entry (160 B, struct Node in terrain.wgsl)
export const NO_PAGE = 0xffffffff;
const VERTEX_BUILDS_PER_FRAME = 64; // 64 x 35 KB ~ 2.2 MB
const UPLOADS_PER_FRAME = 4; // 4 x 266 KB height pages ~ 1 MB
const DRAPE_UPLOADS_PER_FRAME = 4; // 4 x 256 KB drape pages ~ 1 MB: with the vertex builds inside the 4 MB/frame budget of section 6
const DRAPE_LAYERS = 256; // 64 MB of rgba8 pages
const HB_REBUILD = 1000; // m: rebuild a node's vertices when its base height is this far from its height range's middle
const EVICT_BATCH = 32;
const EQUATOR = 2 * Math.PI * 6378137;

export interface TerrainStats {
  nodes: number;
  visited: number;
  maxZoom: number;
  pages: number;
  pageLayers: number;
  pending: number;
  inFlight: number;
  missing: number; // drawn nodes whose own page is not resident yet
  vertexBuilds: number;
  selectionHash: number;
  morph: { lo: number; hi: number };
  deferredUploads: number; // decoded pages waiting (e.g. every page layer in use)
  drapePages: number;
  drapePending: number;
}

export class Terrain {
  readonly pages: HeightPages;
  readonly stream = demStream(8);
  readonly drape: DrapePages;
  readonly drapeStream = new TileStream<DrapeResponse, DrapePage>(
    "drape",
    () => new Worker(new URL("../bake/drapeWorker.ts", import.meta.url), { type: "module" }),
    (key, r) => ({ key, rgba: r.rgba, cover: r.cover, shares: r.shares }),
    6,
  );
  private cache = new NodeCache();
  private prevSplit = new Set<number>();
  private nextSplit = new Set<number>();
  private selected: NodeInfo[] = [];
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;
  private nodeBuf: GPUBuffer;
  private vertBuf: GPUBuffer;
  private indexBuf: GPUBuffer;
  private indexCount: number;
  private table = new ArrayBuffer(MAX_NODES * NODE_STRIDE * 4);
  private tableF = new Float32Array(this.table);
  private tableU = new Uint32Array(this.table);
  private slots = new Map<number, number>(); // node key -> slot
  private slotKey = new Float64Array(SLOTS).fill(-1);
  private slotUsed = new Int32Array(SLOTS).fill(-1);
  private slotOrigin = new Float64Array(SLOTS * 3); // f64 origin each slot's vertices are relative to
  private slotHb = new Float64Array(SLOTS); // base height the slot was built at
  private freeSlots: number[] = [];
  private evictQueue: number[] = [];
  private tmp: Vec3 = [0, 0, 0];
  private pole: Vec3 = [0, 0, 0];
  private capHeight = [0, 0]; // drawn height of the north / south cap apex
  private scratch = new Float32Array(NODE_FLOATS);
  private drawCount = 0;
  private frameNo = 0;
  tau = DEFAULT_TAU;
  morphing = true; // false: no geomorphing (A/B in devtools: __engine.terrain.morphing = false)
  maxZoom = MAX_ZOOM;
  stats: TerrainStats = { nodes: 0, visited: 0, maxZoom: 0, pages: 0, pageLayers: 0, pending: 0, inFlight: 0, missing: 0, vertexBuilds: 0, selectionHash: 0, morph: { lo: 0, hi: 0 }, deferredUploads: 0, drapePages: 0, drapePending: 0 };

  constructor(
    private readonly device: GPUDevice,
    target: RenderTarget,
    frameLayout: GPUBindGroupLayout,
    frameLayers: number,
    private readonly overlay: OverlayRaster,
  ) {
    this.pages = new HeightPages(device, frameLayers);
    this.drape = new DrapePages(device, Math.min(DRAPE_LAYERS, frameLayers));
    for (let i = SLOTS - 1; i >= 0; i--) this.freeSlots.push(i);
    const idx = buildIndices();
    this.indexCount = idx.length;
    this.indexBuf = device.createBuffer({ label: "terrain indices", size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.indexBuf, 0, idx);
    this.nodeBuf = device.createBuffer({ label: "terrain chunk table", size: this.table.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.vertBuf = device.createBuffer({ label: "terrain vertex slots", size: SLOTS * NODE_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    const layout = device.createBindGroupLayout({
      label: "terrain",
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d-array" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d-array" } },
      ],
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.nodeBuf } },
        { binding: 1, resource: { buffer: this.vertBuf } },
        { binding: 2, resource: this.pages.texture.createView({ dimension: "2d-array" }) },
        { binding: 3, resource: this.drape.texture.createView({ dimension: "2d-array" }) },
        { binding: 4, resource: device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" }) },
        { binding: 5, resource: overlay.texture.createView({ dimension: "2d-array" }) },
      ],
    });
    const module = createShader(device, "terrain", terrainWgsl, { GRID });
    this.pipeline = device.createRenderPipeline({
      label: "terrain",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: target.format }] },
      // No culling: skirts and nodes seen from below the horizon both stay closed without caring about winding.
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: target.depthFormat, depthWriteEnabled: true, depthCompare: "greater" },
      multisample: { count: target.sampleCount },
    });
  }

  // Drawn terrain height (exaggerated, sea clamped to 0) from CPU page copies, or null when nothing covers the point.
  groundAt = (lat: number, lng: number): number | null => {
    const h = this.pages.heightAt(lat, lng);
    return h === null ? null : Math.max(h, 0) * EXAGGERATION;
  };

  // Water coverage 0..1 under a point from the drape pages, or null before any page covers it.
  waterAt = (lat: number, lng: number): number | null => this.drape.waterAt(lat, lng);

  private ranges: HeightRanges = {
    source: (z, x, y) => this.pages.source(z, x, y),
    version: () => this.pages.version,
    range: (z, x, y) => {
      const r = this.pages.range(z, x, y);
      return r ? { min: Math.max(r.min, 0) * EXAGGERATION, max: Math.max(r.max, 0) * EXAGGERATION, z: r.z } : null;
    },
  };

  update(v: CameraView): void {
    this.frameNo++;
    this.cache.frame = this.frameNo;
    this.pages.frame = this.frameNo;
    this.drape.frame = this.frameNo;
    if (this.frameNo % 120 === 0) this.cache.sweep();

    // Upload what the worker finished since the last frame, within the budget.
    const deferred = this.pages.upload(this.stream.take(UPLOADS_PER_FRAME));
    if (deferred.length) this.stream.putBack(deferred);
    const drapeDeferred = this.drape.upload(this.drapeStream.take(DRAPE_UPLOADS_PER_FRAME));
    if (drapeDeferred.length) this.drapeStream.putBack(drapeDeferred);

    const eyeGeo = ecefToGeodetic(v.eye);
    const sv: SelectView = {
      eye: v.eye,
      eyeLat: eyeGeo.lat,
      eyeLng: eyeGeo.lng,
      eyeAlt: eyeGeo.h,
      right: v.right,
      up: v.up,
      forward: v.forward,
      near: v.near,
      tanHalfY: v.tanHalfY,
      aspect: v.aspect,
      viewportH: v.viewportH,
    };
    const opts = { tau: this.tau, maxZoom: this.maxZoom, maxNodes: Math.min(MAX_NODES, SLOTS) - 4 };
    const sel = selectNodes(sv, this.cache, this.ranges, this.prevSplit, opts, this.nextSplit, this.selected);
    this.nextSplit = this.prevSplit;
    this.prevSplit = sel.split;
    const k = projScale(sv);
    const band = morphBand(this.tau, MERGE, k);

    // Cap apexes: the mean ground along the quadtree's edge (a cone from the edge row to it closes the pole).
    if (this.frameNo % 30 === 1)
      for (let c = 0; c < 2; c++) {
        let sum = 0;
        let n = 0;
        for (let lng = -180; lng < 180; lng += 22.5) {
          const g = this.groundAt(c ? -MAX_MERCATOR_LAT : MAX_MERCATOR_LAT, lng + 11.25);
          if (g !== null) (sum += g), n++;
        }
        if (n) this.capHeight[c] = sum / n;
      }

    this.stream.beginFrame();
    this.drapeStream.beginFrame();
    let lastDrapeWant = -1;
    let lastDrapeAncestor = -1;
    let count = 0;
    let builds = 0;
    let missing = 0;
    let maxZ = 0;
    let hash = 0;
    let lastWant = -1;
    let lastK11 = -1;
    let lastVersion = -1;
    let lastPage: Page | null = null;
    let lastAncestor = -1;
    const f = this.tableF;
    const u = this.tableU;
    const eye = v.eye;
    for (const node of sel.nodes) {
      const slot = this.slotFor(node, builds < VERTEX_BUILDS_PER_FRAME);
      if (slot < 0) continue;
      if (slot >= SLOTS) builds++;
      const s = slot % SLOTS;
      // Height page: the node's own tile up to z11, then its z11 ancestor; parents stand in while it loads. A node
      // that is fully morphed (its error is below the band at its nearest point) shows only its parent's page, so it
      // asks for that one.
      // From z11 down siblings share one page: look it up once per run of them.
      let page: Page | null;
      if (node.z >= DEM_MAX_ZOOM) {
        const d = node.z - DEM_MAX_ZOOM;
        const k11 = tileKey(DEM_MAX_ZOOM, node.x >> d, node.y >> d);
        if (k11 !== lastK11 || this.pages.version !== lastVersion) {
          lastK11 = k11;
          lastVersion = this.pages.version;
          lastPage = this.pages.best(node.z, node.x, node.y);
        }
        page = lastPage;
      } else page = this.pages.best(node.z, node.x, node.y);
      const pz = Math.min(node.sse <= band.lo ? node.z - 1 : node.z, DEM_MAX_ZOOM);
      if (pz >= 0 && (!page || page.z < pz)) {
        const want = tileKey(pz, node.x >> (node.z - pz), node.y >> (node.z - pz));
        if (!this.stream.isFailed(want)) {
          missing++;
          // Siblings come one after another and share pages from z11 down: ask once.
          if (want !== lastWant) {
            lastWant = want;
            const dx = node.center[0] - eye[0];
            const dy = node.center[1] - eye[1];
            const dz = node.center[2] - eye[2];
            this.stream.want(want, pz + Math.min(0.99, Math.sqrt(dx * dx + dy * dy + dz * dz) / 4e7));
            // A coarser page three levels up arrives sooner and covers the wait.
            if (pz >= 3) {
              const az = pz - 3;
              const ak = tileKey(az, node.x >> (node.z - az), node.y >> (node.z - az));
              if (ak !== lastAncestor && !this.pages.has(ak)) this.stream.want(ak, az);
              lastAncestor = ak;
            }
          }
        }
      }
      // The page the parent node would draw with: the morph target's heights come from it. From z12 down it is the
      // same z11 page.
      const parent = node.z > DEM_MAX_ZOOM ? page : node.z > 0 ? (this.pages.best(node.z - 1, node.x >> 1, node.y >> 1) ?? page) : page;
      const hb = this.slotHb[s];
      const o = count * NODE_STRIDE;
      const so = this.slotOrigin;
      f[o] = so[s * 3] - eye[0];
      f[o + 1] = so[s * 3 + 1] - eye[1];
      f[o + 2] = so[s * 3 + 2] - eye[2];
      f[o + 3] = node.cell + 20; // skirt depth
      writePage(f, u, o + 4, o + 20, node, page);
      writePage(f, u, o + 8, o + 23, node, parent);
      f[o + 12] = hb;
      f[o + 13] = node.z > 0 && this.morphing ? (EQUATOR / 2 ** node.z / (GRID - 1)) * k : 0; // morph: cell at the equator x K, 0 = never
      f[o + 14] = band.lo;
      f[o + 15] = band.hi;
      const caps = node.z > 0 ? capFlags(node.z, node.y) : 0;
      if (caps) {
        const t = this.tmp;
        t[0] = so[s * 3];
        t[1] = so[s * 3 + 1];
        t[2] = so[s * 3 + 2];
        const north = (caps & CAP_NORTH) !== 0;
        const apex = north ? this.capHeight[0] : this.capHeight[1];
        const pole = poleLocal(north, t, apex, this.pole);
        f[o + 16] = pole[0];
        f[o + 17] = pole[1];
        f[o + 18] = pole[2];
        f[o + 19] = apex;
      } else f[o + 16] = f[o + 17] = f[o + 18] = f[o + 19] = 0;
      u[o + 21] = s;
      u[o + 22] = node.z;
      // Drape page: the node's own tile up to DRAPE_MAX_ZOOM, ancestors standing in while it bakes.
      const dpage = this.drape.best(node.z, node.x, node.y);
      writePage(f, u, o + 24, o + 27, node, dpage);
      for (let l = 0; l < OVERLAY_LEVELS; l++) this.overlay.nodeUv(l, node.z, node.x, node.y, f, o + 28 + l * 4);
      const dz = Math.min(node.z, DRAPE_MAX_ZOOM);
      if (!dpage || dpage.z < dz) {
        const want = tileKey(dz, node.x >> (node.z - dz), node.y >> (node.z - dz));
        if (want !== lastDrapeWant && !this.drapeStream.isFailed(want)) {
          lastDrapeWant = want;
          const dx = node.center[0] - eye[0];
          const dy = node.center[1] - eye[1];
          const dzz = node.center[2] - eye[2];
          this.drapeStream.want(want, dz + Math.min(0.99, Math.sqrt(dx * dx + dy * dy + dzz * dzz) / 4e7));
          if (dz >= 3) {
            const az = dz - 3;
            const ak = tileKey(az, node.x >> (node.z - az), node.y >> (node.z - az));
            if (ak !== lastDrapeAncestor && !this.drape.has(ak)) this.drapeStream.want(ak, az);
            lastDrapeAncestor = ak;
          }
        }
      }
      count++;
      if (node.z > maxZ) maxZ = node.z;
      hash = (Math.imul(hash, 31) + node.x * 3 + node.y * 5 + node.z * 7 + (page ? page.z * 11 : 0) + (parent ? parent.z * 13 : 0)) | 0;
    }
    // The pinned coarse pages are always wanted: the fallback of last resort for any view.
    for (let z = 0; z <= 2; z++)
      for (let y = 0; y < 2 ** z; y++)
        for (let x = 0; x < 2 ** z; x++) {
          const key = tileKey(z, x, y);
          if (!this.pages.has(key)) this.stream.want(key, -1);
          if (!this.drape.has(key)) this.drapeStream.want(key, -1);
        }
    this.stream.pump();
    this.drapeStream.pump();
    this.drawCount = count;
    if (count) this.device.queue.writeBuffer(this.nodeBuf, 0, this.table, 0, count * NODE_STRIDE * 4);
    this.stats = {
      nodes: count,
      visited: sel.visited,
      maxZoom: maxZ,
      pages: this.pages.resident,
      pageLayers: this.pages.layers,
      pending: this.stream.pending,
      inFlight: this.stream.running,
      missing,
      vertexBuilds: builds,
      selectionHash: hash,
      morph: band,
      deferredUploads: this.stream.decoded,
      drapePages: this.drape.resident,
      drapePending: this.drapeStream.pending,
    };
  }

  draw(pass: GPURenderPassEncoder): void {
    if (!this.drawCount) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(1, this.bindGroup);
    pass.setIndexBuffer(this.indexBuf, "uint32");
    pass.drawIndexed(this.indexCount, this.drawCount);
  }

  // Slot holding the node's vertices; builds them if needed (returns slot + SLOTS to flag a build), -1 if none.
  private slotFor(node: NodeInfo, mayBuild: boolean): number {
    const hb = node.rangeZ >= 0 ? (node.hmin + node.hmax) / 2 : 0;
    const have = node.slot >= 0 && this.slotKey[node.slot] === node.key ? node.slot : this.slots.get(node.key);
    if (have !== undefined) {
      this.slotUsed[have] = this.frameNo;
      // Built before its heights were known: rebuild around the real base height for precision.
      if (mayBuild && Math.abs(hb - this.slotHb[have]) > HB_REBUILD) {
        this.build(node, have, hb);
        return have + SLOTS;
      }
      return have;
    }
    if (!mayBuild) return -1;
    const slot = this.freeSlots.pop() ?? this.evict();
    if (slot < 0) return -1;
    this.build(node, slot, hb);
    this.slots.set(node.key, slot);
    node.slot = slot;
    this.slotKey[slot] = node.key;
    this.slotUsed[slot] = this.frameNo;
    return slot + SLOTS;
  }

  private build(node: NodeInfo, slot: number, hb: number): void {
    const origin = nodeOrigin(node.z, node.x, node.y, hb, this.tmp);
    this.slotOrigin.set(origin, slot * 3);
    this.slotHb[slot] = hb;
    buildNodeVertices(node.z, node.x, node.y, origin, this.scratch, 0, hb);
    this.device.queue.writeBuffer(this.vertBuf, slot * NODE_FLOATS * 4, this.scratch);
  }

  // Least recently used slot not drawn this frame, or -1. Candidates are gathered a batch at a time so a frame full of
  // new nodes does not scan every slot per node.
  private evict(): number {
    for (;;) {
      if (!this.evictQueue.length) {
        const cand: number[] = [];
        for (let i = 0; i < SLOTS; i++) if (this.slotUsed[i] < this.frameNo) cand.push(i);
        if (!cand.length) return -1;
        cand.sort((a, b) => this.slotUsed[b] - this.slotUsed[a]); // oldest last, popped first
        this.evictQueue = cand.slice(Math.max(0, cand.length - EVICT_BATCH));
      }
      const slot = this.evictQueue.pop()!;
      if (this.slotUsed[slot] >= this.frameNo) continue; // drawn again since it was queued
      this.slots.delete(this.slotKey[slot]);
      this.slotKey[slot] = -1;
      return slot;
    }
  }
}

// Page uv rectangle of the node inside `page` (xy corner, z scale), the page's texel size (w) and its layer.
function writePage(f: Float32Array, u: Uint32Array, o: number, layerAt: number, node: NodeInfo, page: { z: number; x: number; y: number; layer: number } | null): void {
  if (!page) {
    f[o] = f[o + 1] = 0;
    f[o + 2] = 1;
    f[o + 3] = 1;
    u[layerAt] = NO_PAGE;
    return;
  }
  const dz = node.z - page.z;
  const n = 1 << dz; // dz <= MAX_ZOOM
  const sc = 1 / n;
  f[o] = (node.x - page.x * n) * sc;
  f[o + 1] = (node.y - page.y * n) * sc;
  f[o + 2] = sc;
  f[o + 3] = EQUATOR / 2 ** page.z / DEM_SIZE;
  u[layerAt] = page.layer;
}
