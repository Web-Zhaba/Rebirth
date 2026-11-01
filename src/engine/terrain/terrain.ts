import type { CameraView } from "../camera/camera";
import { ecefToGeodetic } from "../geo/ellipsoid";
import { tileKey } from "../geo/mercator";
import { createShader } from "../gpu/wgsl";
import { DEM_SIZE } from "../bake/terrarium";
import { DemStream } from "../stream/demStream";
import { DEM_MAX_ZOOM, HeightPages } from "./heightPages";
import { writeRelative } from "../frame/chunkTable";
import { buildIndices, buildNodeVertices, GRID, NODE_FLOATS } from "./nodeMesh";
import { DEFAULT_TAU, MAX_ZOOM, NodeCache, selectNodes, type HeightRanges, type NodeInfo, type SelectView } from "./quadtree";
import "../frame/frameUniforms";
import "../sky/atmosphere";
import terrainWgsl from "./terrain.wgsl?raw";

// Globe terrain renderer: quadtree selection, vertex slots, height pages, the per-frame chunk table and one instanced
// draw. Lives on the main thread; DEM decoding is in the bake worker.

export const EXAGGERATION = 1.6; // MapLibre relief (src/map/relief.ts RELIEF_EXAGGERATION)

const MAX_NODES = 4096; // chunk-table capacity per frame
const SLOTS = 1024; // resident node vertex blocks
const NODE_STRIDE = 12; // floats per chunk-table entry (48 B)
const NO_PAGE = 0xffffffff;
const VERTEX_BUILDS_PER_FRAME = 256;
const UPLOADS_PER_FRAME = 6; // 6 x 266 KB pages ~ 1.6 MB, inside the 4 MB/frame budget of section 6
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
}

export class Terrain {
  readonly pages: HeightPages;
  readonly stream = new DemStream(8);
  private cache = new NodeCache();
  private prevSplit = new Set<number>();
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
  private freeSlots: number[] = [];
  private scratch = new Float32Array(NODE_FLOATS);
  private drawCount = 0;
  private frameNo = 0;
  tau = DEFAULT_TAU;
  maxZoom = MAX_ZOOM;
  stats: TerrainStats = { nodes: 0, visited: 0, maxZoom: 0, pages: 0, pageLayers: 0, pending: 0, inFlight: 0, missing: 0, vertexBuilds: 0, selectionHash: 0 };

  constructor(private readonly device: GPUDevice, format: GPUTextureFormat, depthFormat: GPUTextureFormat, frameLayout: GPUBindGroupLayout, frameLayers: number) {
    this.pages = new HeightPages(device, frameLayers);
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
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float", viewDimension: "2d-array" } },
      ],
    });
    this.bindGroup = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.nodeBuf } },
        { binding: 1, resource: { buffer: this.vertBuf } },
        { binding: 2, resource: this.pages.texture.createView({ dimension: "2d-array" }) },
      ],
    });
    const module = createShader(device, "terrain", terrainWgsl, { GRID });
    this.pipeline = device.createRenderPipeline({
      label: "terrain",
      layout: device.createPipelineLayout({ bindGroupLayouts: [frameLayout, layout] }),
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      // No culling: skirts and nodes seen from below the horizon both stay closed without caring about winding.
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "greater" },
    });
  }

  // Drawn terrain height (exaggerated, sea clamped to 0) from CPU page copies, or null when nothing covers the point.
  groundAt = (lat: number, lng: number): number | null => {
    const h = this.pages.heightAt(lat, lng);
    return h === null ? null : Math.max(h, 0) * EXAGGERATION;
  };

  private ranges: HeightRanges = {
    range: (z, x, y) => {
      const r = this.pages.range(z, x, y);
      return r ? { min: Math.max(r.min, 0) * EXAGGERATION, max: Math.max(r.max, 0) * EXAGGERATION, z: r.z } : null;
    },
  };

  update(v: CameraView): void {
    this.frameNo++;
    this.cache.frame = this.frameNo;
    this.pages.frame = this.frameNo;
    if (this.frameNo % 120 === 0) this.cache.sweep();

    // Upload what the worker finished since the last frame, within the budget.
    this.pages.upload(this.stream.take(UPLOADS_PER_FRAME));

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
    const sel = selectNodes(sv, this.cache, this.ranges, this.prevSplit, { tau: this.tau, maxZoom: this.maxZoom, maxNodes: Math.min(MAX_NODES, SLOTS) - 4 });
    this.prevSplit = sel.split;

    this.stream.beginFrame();
    let count = 0;
    let builds = 0;
    let missing = 0;
    let maxZ = 0;
    let hash = 0;
    const f = this.tableF;
    const u = this.tableU;
    for (const node of sel.nodes) {
      const slot = this.slotFor(node, builds < VERTEX_BUILDS_PER_FRAME);
      if (slot < 0) continue;
      if (slot >= SLOTS) builds++;
      const s = slot % SLOTS;
      // Height page: the node's own tile up to z11, then its z11 ancestor; parents stand in while it loads.
      const pz = Math.min(node.z, DEM_MAX_ZOOM);
      const want = tileKey(pz, node.x >> (node.z - pz), node.y >> (node.z - pz));
      const page = this.pages.best(node.z, node.x, node.y);
      if (!page || page.key !== want) {
        if (!this.stream.isFailed(want)) {
          missing++;
          const dist = Math.hypot(node.center[0] - v.eye[0], node.center[1] - v.eye[1], node.center[2] - v.eye[2]);
          this.stream.want(want, pz + Math.min(0.99, dist / 4e7));
          // A coarser page three levels up arrives sooner and covers the wait.
          if (pz >= 3) {
            const az = pz - 3;
            const ak = tileKey(az, node.x >> (node.z - az), node.y >> (node.z - az));
            if (!this.pages.has(ak)) this.stream.want(ak, az);
          }
        }
      }
      const o = count * NODE_STRIDE;
      writeRelative(f, o, node.origin, v.eye);
      f[o + 3] = node.cell + 20; // skirt depth
      if (page) {
        const dz = node.z - page.z;
        const sc = 1 / 2 ** dz;
        f[o + 4] = (node.x - (page.x << dz)) * sc;
        f[o + 5] = (node.y - (page.y << dz)) * sc;
        f[o + 6] = sc;
        f[o + 7] = EQUATOR / 2 ** page.z / DEM_SIZE;
        u[o + 8] = page.layer;
      } else {
        f[o + 4] = f[o + 5] = 0;
        f[o + 6] = 1;
        f[o + 7] = 1;
        u[o + 8] = NO_PAGE;
      }
      u[o + 9] = s;
      u[o + 10] = node.z;
      u[o + 11] = 0;
      count++;
      if (node.z > maxZ) maxZ = node.z;
      hash = (hash * 31 + (node.key % 1_000_003) + (page ? page.z * 7 : 0)) % 2_147_483_647;
    }
    // The pinned coarse pages are always wanted: the fallback of last resort for any view.
    for (let z = 0; z <= 2; z++)
      for (let y = 0; y < 2 ** z; y++)
        for (let x = 0; x < 2 ** z; x++) {
          const k = tileKey(z, x, y);
          if (!this.pages.has(k)) this.stream.want(k, -1);
        }
    this.stream.pump();
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
    const have = this.slots.get(node.key);
    if (have !== undefined) {
      this.slotUsed[have] = this.frameNo;
      return have;
    }
    if (!mayBuild) return -1;
    let slot = this.freeSlots.pop();
    if (slot === undefined) {
      let oldest = -1;
      for (let i = 0; i < SLOTS; i++) if (this.slotUsed[i] < this.frameNo && (oldest < 0 || this.slotUsed[i] < this.slotUsed[oldest])) oldest = i;
      if (oldest < 0) return -1;
      this.slots.delete(this.slotKey[oldest]);
      slot = oldest;
    }
    buildNodeVertices(node.z, node.x, node.y, node.origin, this.scratch);
    this.device.queue.writeBuffer(this.vertBuf, slot * NODE_FLOATS * 4, this.scratch);
    this.slots.set(node.key, slot);
    this.slotKey[slot] = node.key;
    this.slotUsed[slot] = this.frameNo;
    return slot + SLOTS;
  }
}
