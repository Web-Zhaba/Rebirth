import { DRAPE_MAX_ZOOM, DRAPE_SIZE } from "../bake/drape";
import { keyToTile, lngLatToTile, tileKey } from "../geo/mercator";

// Drape page pool (bake/drape.ts): one rgba8unorm-srgb texture array, a layer per resident page, LRU-evicted like the
// height pages. The texture is filtered (sampled with a linear sampler), so unlike heights there is no border: at a page
// edge the sample clamps, which at one texel is invisible next to the next page's own edge.
//
// Each page also fills the same layer of `cover`, an r8uint array of vegetation class ids (bake/drape.ts rasterCover)
// read by the tree scatter, and keeps the share of each class on the CPU (the scatter's budget and empty-tile skip).

const PINNED_ZOOM = 2; // z0-z2 never evicted: the fallback of last resort
const CPU_COPIES = 64; // water masks kept on the CPU for isWaterAt

export interface DrapePage {
  key: number;
  rgba: Uint8Array<ArrayBuffer>;
  cover: Uint8Array<ArrayBuffer>;
  shares: Float32Array; // per class id, index 0 no cover
}

export interface Resident {
  key: number;
  z: number;
  x: number;
  y: number;
  layer: number;
  lastUsed: number;
  water: Uint8Array | null; // alpha channel, for CPU queries
  shares: Float32Array;
}

export class DrapePages {
  readonly texture: GPUTexture;
  readonly cover: GPUTexture;
  readonly layers: number;
  private pages = new Map<number, Resident>();
  private free: number[] = [];
  private cpu: number[] = []; // keys with a CPU water copy, oldest first
  frame = 0;

  constructor(
    private readonly device: GPUDevice,
    layers: number,
  ) {
    this.layers = layers;
    this.texture = device.createTexture({
      label: "drape pages",
      size: [DRAPE_SIZE, DRAPE_SIZE, layers],
      format: "rgba8unorm-srgb",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.cover = device.createTexture({
      label: "cover pages",
      size: [DRAPE_SIZE, DRAPE_SIZE, layers],
      format: "r8uint",
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

  // Finest resident page covering tile (z, x, y), starting at min(z, DRAPE_MAX_ZOOM). Marks it used.
  best(z: number, x: number, y: number): Resident | null {
    let pz = Math.min(z, DRAPE_MAX_ZOOM);
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

  // Upload baked pages; returns the ones that did not fit (every layer in use this frame) for a later frame.
  upload(list: DrapePage[]): DrapePage[] {
    for (let n = 0; n < list.length; n++) {
      const d = list[n];
      if (this.pages.has(d.key)) continue;
      const layer = this.allocate();
      if (layer < 0) return list.slice(n);
      const water = new Uint8Array(DRAPE_SIZE * DRAPE_SIZE);
      for (let i = 0; i < water.length; i++) water[i] = d.rgba[i * 4 + 3];
      this.pages.set(d.key, { key: d.key, ...keyToTile(d.key), layer, lastUsed: this.frame, water, shares: d.shares });
      this.cpu.push(d.key);
      while (this.cpu.length > CPU_COPIES) {
        const p = this.pages.get(this.cpu.shift()!);
        if (p) p.water = null;
      }
      this.device.queue.writeTexture({ texture: this.texture, origin: [0, 0, layer] }, d.rgba, { bytesPerRow: DRAPE_SIZE * 4 }, [DRAPE_SIZE, DRAPE_SIZE, 1]);
      this.device.queue.writeTexture({ texture: this.cover, origin: [0, 0, layer] }, d.cover, { bytesPerRow: DRAPE_SIZE }, [DRAPE_SIZE, DRAPE_SIZE, 1]);
    }
    return [];
  }

  // Water coverage 0..1 at a point from the finest page that still has a CPU copy, or null when none covers it.
  waterAt(lat: number, lng: number): number | null {
    for (let z = DRAPE_MAX_ZOOM; z >= 0; z--) {
      const f = lngLatToTile(lng, lat, z);
      const n = 2 ** z;
      const tx = Math.floor(f.x);
      const ty = Math.max(0, Math.min(n - 1, Math.floor(f.y)));
      const p = this.pages.get(tileKey(z, ((tx % n) + n) % n, ty));
      if (!p?.water) continue;
      const i = Math.min(DRAPE_SIZE - 1, Math.floor((f.x - tx) * DRAPE_SIZE));
      const j = Math.min(DRAPE_SIZE - 1, Math.floor((f.y - ty) * DRAPE_SIZE));
      return p.water[j * DRAPE_SIZE + i] / 255;
    }
    return null;
  }

  private allocate(): number {
    const l = this.free.pop();
    if (l !== undefined) return l;
    let victim: Resident | null = null;
    for (const p of this.pages.values()) {
      if (p.z <= PINNED_ZOOM || p.lastUsed >= this.frame) continue;
      if (!victim || p.lastUsed < victim.lastUsed) victim = p;
    }
    if (!victim) return -1;
    this.pages.delete(victim.key);
    return victim.layer;
  }
}
