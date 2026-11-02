import { BLOCKS, DEM_SIZE, PAGE_SIZE, samplePage } from "../bake/terrarium";
import { keyToTile, lngLatToTile, tileKey } from "../geo/mercator";
import type { DemPage } from "../stream/demStream";

// Height page pool: one r32float texture array, a layer per resident DEM tile, LRU-evicted.
//
// Texel convention (identical to src/world/terrain.ts sampleGrid): pixel (i, j) of a 256 px terrarium tile holds the
// height at its centre, (i + 0.5) / 256 across the tile, and heights between centres are bilinear. Pages are 258 x 258:
// texel (i + 1, j + 1) = pixel (i, j), plus a 1-texel border copied from the eight same-zoom neighbours when they are
// resident (patched in both directions on upload), else clamped from the edge. With the border, bilinear across a tile
// edge is the exact global bilinear surface and two nodes meeting at the edge compute the same height. terrain.ts
// clamps instead, so the rules and this surface differ only inside the half-pixel band along z11 tile edges (fix in
// N2 by sampling across tiles in terrain.ts).

export const DEM_MAX_ZOOM = 11; // MapLibre's terrain zoom (src/world/nature.ts TERRAIN_ZOOM); deeper nodes reuse z11
const PINNED_ZOOM = 2; // z0-z2 (21 pages) are never evicted: the fallback of last resort
const CPU_COPIES = 64; // pages kept on the CPU for camera/ground queries

export interface Page {
  key: number;
  z: number;
  x: number;
  y: number;
  layer: number;
  min: number;
  max: number;
  blocks: Float32Array; // 16 x 16 min/max pairs
  lastUsed: number;
  edges: Float32Array<ArrayBuffer>; // top row, bottom row, left column, right column (4 x 256), for patching neighbours
  cpu: Float32Array<ArrayBuffer> | null; // the bordered page, for CPU height queries
}

const TOP = 0;
const BOTTOM = 1;
const LEFT = 2;
const RIGHT = 3;

export class HeightPages {
  readonly texture: GPUTexture;
  readonly layers: number;
  private pages = new Map<number, Page>();
  private free: number[] = [];
  private cpuCount = 0;
  frame = 0;
  uploads = 0;
  evictions = 0;
  exhausted = 0; // uploads deferred because every layer was in use
  version = 0; // bumped when the resident set changes

  constructor(private readonly device: GPUDevice, layers: number) {
    this.layers = layers;
    this.texture = device.createTexture({
      label: "height pages",
      size: [PAGE_SIZE, PAGE_SIZE, layers],
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    for (let i = layers - 1; i >= 0; i--) this.free.push(i);
  }

  get resident(): number {
    return this.pages.size;
  }

  has(key: number): boolean {
    return this.pages.has(key);
  }

  // Finest resident page covering tile (z, x, y), starting at min(z, DEM_MAX_ZOOM). Marks it used.
  best(z: number, x: number, y: number): Page | null {
    let pz = Math.min(z, DEM_MAX_ZOOM);
    let px = x >> (z - pz);
    let py = y >> (z - pz);
    for (;;) {
      const p = this.pages.get(tileKey(pz, px, py));
      if (p) {
        p.lastUsed = this.frame;
        return p;
      }
      if (pz === 0) return null;
      pz--;
      px >>= 1;
      py >>= 1;
    }
  }

  // Key of the page `best` would return (-1: none), without marking it used: lets node bounds skip unchanged ranges.
  source(z: number, x: number, y: number): number {
    let pz = Math.min(z, DEM_MAX_ZOOM);
    let px = x >> (z - pz);
    let py = y >> (z - pz);
    for (;;) {
      const k = tileKey(pz, px, py);
      if (this.pages.has(k)) return k;
      if (pz === 0) return -1;
      pz--;
      px >>= 1;
      py >>= 1;
    }
  }

  // Raw height range over tile (z, x, y) from the finest resident page: the page's 16 x 16 block grid narrows it for
  // nodes deeper than the page, so a high camera over a z11 page does not see 2 km of relief under every node.
  range(z: number, x: number, y: number): { min: number; max: number; z: number } | null {
    const p = this.best(z, x, y);
    if (!p) return null;
    const dz = z - p.z;
    if (dz === 0) return { min: p.min, max: p.max, z: p.z };
    const n = 2 ** dz;
    const lx = x - p.x * n;
    const ly = y - p.y * n;
    const b0x = Math.floor((lx * BLOCKS) / n);
    const b0y = Math.floor((ly * BLOCKS) / n);
    const b1x = Math.max(b0x, Math.ceil(((lx + 1) * BLOCKS) / n) - 1);
    const b1y = Math.max(b0y, Math.ceil(((ly + 1) * BLOCKS) / n) - 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (let by = b0y; by <= b1y; by++)
      for (let bx = b0x; bx <= b1x; bx++) {
        lo = Math.min(lo, p.blocks[(by * BLOCKS + bx) * 2]);
        hi = Math.max(hi, p.blocks[(by * BLOCKS + bx) * 2 + 1]);
      }
    return { min: lo, max: hi, z: p.z };
  }

  // Upload decoded pages; returns the ones that did not fit (every layer is in use this frame) for a later frame.
  upload(list: DemPage[]): DemPage[] {
    for (let n = 0; n < list.length; n++) {
      const d = list[n];
      if (this.pages.has(d.key)) continue;
      const layer = this.allocate();
      if (layer < 0) {
        this.exhausted++;
        return list.slice(n);
      }
      const t = keyToTile(d.key);
      const edges = new Float32Array(4 * DEM_SIZE);
      const h = d.heights;
      for (let i = 0; i < DEM_SIZE; i++) {
        edges[TOP * DEM_SIZE + i] = h[1 * PAGE_SIZE + i + 1];
        edges[BOTTOM * DEM_SIZE + i] = h[DEM_SIZE * PAGE_SIZE + i + 1];
        edges[LEFT * DEM_SIZE + i] = h[(i + 1) * PAGE_SIZE + 1];
        edges[RIGHT * DEM_SIZE + i] = h[(i + 1) * PAGE_SIZE + DEM_SIZE];
      }
      const page: Page = { key: d.key, ...t, layer, min: d.min, max: d.max, blocks: d.blocks, lastUsed: this.frame, edges, cpu: h };
      this.pages.set(d.key, page);
      this.version++;
      this.cpuCount++;
      this.trimCpu();
      // Pull the neighbours' edges into this page's border before the upload, then push ours into theirs.
      this.patchFromNeighbours(page, h);
      this.device.queue.writeTexture({ texture: this.texture, origin: [0, 0, layer] }, h, { bytesPerRow: PAGE_SIZE * 4 }, [PAGE_SIZE, PAGE_SIZE, 1]);
      this.patchNeighbours(page);
      this.uploads++;
    }
    return [];
  }

  // Raw DEM height (m, not exaggerated) at a point from the finest page that still has a CPU copy, or null.
  heightAt(lat: number, lng: number): number | null {
    for (let z = DEM_MAX_ZOOM; z >= 0; z--) {
      const f = lngLatToTile(lng, lat, z);
      const n = 2 ** z;
      const tx = Math.floor(f.x);
      const ty = Math.max(0, Math.min(n - 1, Math.floor(f.y)));
      const p = this.pages.get(tileKey(z, ((tx % n) + n) % n, ty));
      if (p?.cpu) return samplePage(p.cpu, f.x - tx, f.y - ty);
    }
    return null;
  }

  private allocate(): number {
    const l = this.free.pop();
    if (l !== undefined) return l;
    let victim: Page | null = null;
    for (const p of this.pages.values()) {
      if (p.z <= PINNED_ZOOM || p.lastUsed >= this.frame) continue;
      if (!victim || p.lastUsed < victim.lastUsed) victim = p;
    }
    if (!victim) return -1;
    this.pages.delete(victim.key);
    this.version++;
    if (victim.cpu) this.cpuCount--;
    this.evictions++;
    return victim.layer;
  }

  private trimCpu(): void {
    while (this.cpuCount > CPU_COPIES) {
      let victim: Page | null = null;
      for (const p of this.pages.values()) if (p.cpu && (!victim || p.lastUsed < victim.lastUsed || (p.lastUsed === victim.lastUsed && p.z < victim.z))) victim = p;
      if (!victim) return;
      victim.cpu = null;
      this.cpuCount--;
    }
  }

  private neighbour(p: Page, dx: number, dy: number): Page | null {
    const n = 2 ** p.z;
    const y = p.y + dy;
    if (y < 0 || y >= n) return null;
    return this.pages.get(tileKey(p.z, (((p.x + dx) % n) + n) % n, y)) ?? null;
  }

  private patchFromNeighbours(p: Page, h: Float32Array<ArrayBuffer>): void {
    const S = DEM_SIZE;
    const row = (r: number, src: Float32Array, side: number) => h.set(src.subarray(side * S, side * S + S), r * PAGE_SIZE + 1);
    const col = (c: number, src: Float32Array, side: number) => {
      for (let i = 0; i < S; i++) h[(i + 1) * PAGE_SIZE + c] = src[side * S + i];
    };
    const north = this.neighbour(p, 0, -1);
    const south = this.neighbour(p, 0, 1);
    const west = this.neighbour(p, -1, 0);
    const east = this.neighbour(p, 1, 0);
    if (north) row(0, north.edges, BOTTOM);
    if (south) row(PAGE_SIZE - 1, south.edges, TOP);
    if (west) col(0, west.edges, RIGHT);
    if (east) col(PAGE_SIZE - 1, east.edges, LEFT);
    const nw = this.neighbour(p, -1, -1);
    const ne = this.neighbour(p, 1, -1);
    const sw = this.neighbour(p, -1, 1);
    const se = this.neighbour(p, 1, 1);
    if (nw) h[0] = nw.edges[BOTTOM * S + S - 1];
    if (ne) h[PAGE_SIZE - 1] = ne.edges[BOTTOM * S];
    if (sw) h[(PAGE_SIZE - 1) * PAGE_SIZE] = sw.edges[TOP * S + S - 1];
    if (se) h[PAGE_SIZE * PAGE_SIZE - 1] = se.edges[TOP * S];
  }

  // Write this page's edges into the borders of resident neighbours (GPU and their CPU copies).
  private patchNeighbours(p: Page): void {
    const S = DEM_SIZE;
    const e = p.edges;
    const put = (q: Page, x: number, y: number, w: number, hgt: number, data: Float32Array<ArrayBuffer>) => {
      this.device.queue.writeTexture({ texture: this.texture, origin: [x, y, q.layer] }, data, { bytesPerRow: w * 4 }, [w, hgt, 1]);
      if (q.cpu) for (let j = 0; j < hgt; j++) for (let i = 0; i < w; i++) q.cpu[(y + j) * PAGE_SIZE + x + i] = data[j * w + i];
    };
    const north = this.neighbour(p, 0, -1);
    const south = this.neighbour(p, 0, 1);
    const west = this.neighbour(p, -1, 0);
    const east = this.neighbour(p, 1, 0);
    if (north) put(north, 1, PAGE_SIZE - 1, S, 1, e.subarray(TOP * S, TOP * S + S));
    if (south) put(south, 1, 0, S, 1, e.subarray(BOTTOM * S, BOTTOM * S + S));
    if (west) put(west, PAGE_SIZE - 1, 1, 1, S, e.subarray(LEFT * S, LEFT * S + S));
    if (east) put(east, 0, 1, 1, S, e.subarray(RIGHT * S, RIGHT * S + S));
    const one = (v: number) => new Float32Array([v]);
    const nw = this.neighbour(p, -1, -1);
    const ne = this.neighbour(p, 1, -1);
    const sw = this.neighbour(p, -1, 1);
    const se = this.neighbour(p, 1, 1);
    if (nw) put(nw, PAGE_SIZE - 1, PAGE_SIZE - 1, 1, 1, one(e[TOP * S]));
    if (ne) put(ne, 0, PAGE_SIZE - 1, 1, 1, one(e[TOP * S + S - 1]));
    if (sw) put(sw, PAGE_SIZE - 1, 0, 1, 1, one(e[BOTTOM * S]));
    if (se) put(se, 0, 0, 1, 1, one(e[BOTTOM * S + S - 1]));
  }
}
