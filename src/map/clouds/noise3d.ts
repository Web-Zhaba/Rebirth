// Tileable 3D noise volumes for the cloud ray-march (PLAN-clouds.md section 4). Pure, deterministic, no Math.random.
// Lattice and feature-point grids wrap, so a volume repeats seamlessly (value at 0 == value at N on every axis).

export const BASE_SIZE = 64;
export const DETAIL_SIZE = 32;

function hash(x: number, y: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x2c9277b5) ^ Math.imul(z, 0x6b43a9b5) ^ Math.imul(seed, 0x9e3779b1)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const wrap = (a: number, n: number) => (a < 0 ? a + n : a >= n ? a - n : a); // inputs stay within one lattice period of [0, n)
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

// One Worley grid of n^3 cells with a jittered feature point per cell.
class Worley {
  private p: Float32Array;
  constructor(private n: number, seed: number) {
    this.p = new Float32Array(n * n * n * 3);
    let o = 0;
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          this.p[o++] = hash(x, y, z, seed);
          this.p[o++] = hash(x, y, z, seed + 101);
          this.p[o++] = hash(x, y, z, seed + 202);
        }
  }
  // Coordinates in cell units; 1 at a feature point falling to 0 at one cell distance (inverted Worley).
  at(u: number, v: number, w: number): number {
    const n = this.n;
    const cx = Math.floor(u), cy = Math.floor(v), cz = Math.floor(w);
    let best = 4;
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx, gy = cy + dy, gz = cz + dz;
          const o = ((wrap(gz, n) * n + wrap(gy, n)) * n + wrap(gx, n)) * 3;
          const ex = gx + this.p[o] - u, ey = gy + this.p[o + 1] - v, ez = gz + this.p[o + 2] - w;
          const d = ex * ex + ey * ey + ez * ez;
          if (d < best) best = d;
        }
    return 1 - Math.min(1, Math.sqrt(best));
  }
}

// Periodic gradient (Perlin) noise on an n-cell lattice, scaled into 0..1.
class Perlin {
  constructor(private n: number, private seed: number) {}
  private g(ix: number, iy: number, iz: number, x: number, y: number, z: number): number {
    const k = Math.floor(hash(wrap(ix, this.n), wrap(iy, this.n), wrap(iz, this.n), this.seed) * 12);
    // 12 gradients of the form (+-1, +-1, 0) permuted over the axes
    const pair = k >> 2; // 0: x,y  1: x,z  2: y,z
    const a = pair === 2 ? y : x;
    const b = pair === 0 ? y : z;
    return ((k & 1) === 0 ? a : -a) + ((k & 2) === 0 ? b : -b);
  }
  at(u: number, v: number, w: number): number {
    const ix = Math.floor(u), iy = Math.floor(v), iz = Math.floor(w);
    const fx = u - ix, fy = v - iy, fz = w - iz;
    const sx = fade(fx), sy = fade(fy), sz = fade(fz);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dx: number, dy: number, dz: number) => this.g(ix + dx, iy + dy, iz + dz, fx - dx, fy - dy, fz - dz);
    const v00 = l(c(0, 0, 0), c(1, 0, 0), sx);
    const v10 = l(c(0, 1, 0), c(1, 1, 0), sx);
    const v01 = l(c(0, 0, 1), c(1, 0, 1), sx);
    const v11 = l(c(0, 1, 1), c(1, 1, 1), sx);
    const r = l(l(v00, v10, sy), l(v01, v11, sy), sz);
    return Math.min(1, Math.max(0, r * 0.5 + 0.5)); // |r| stays below ~1.2 in practice
  }
}

const OCT_W = [0.625, 0.25, 0.125]; // three fbm octaves at base, 2 base, 4 base cells; weights sum to 1

interface Channel {
  worley: number | null; // base cell count of the Worley fbm, null = channel unused (255)
  perlin?: number; // base cell count of the Perlin fbm; when set the channel is Perlin-Worley
}

function buildVolume(size: number, seed: number, channels: Channel[]): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const worleys = new Map<number, Worley>();
  const wGrid = (n: number) => {
    let g = worleys.get(n);
    if (!g) worleys.set(n, (g = new Worley(n, seed + 31 * n)));
    return g;
  };
  const perlins = new Map<number, Perlin>();
  const pGrid = (n: number) => {
    let g = perlins.get(n);
    if (!g) perlins.set(n, (g = new Perlin(n, seed + 977 + n)));
    return g;
  };
  // Channels share octaves (4, 8, 16 ... cells), so each distinct Worley octave is evaluated once for the volume.
  const octaves = new Map<number, Float32Array>();
  const octave = (f: number) => {
    let a = octaves.get(f);
    if (!a) {
      a = new Float32Array(size * size * size);
      const g = wGrid(f);
      const k = f / size;
      let i = 0;
      for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) a[i++] = g.at(x * k, y * k, z * k);
      octaves.set(f, a);
    }
    return a;
  };
  const inv = 1 / size;
  let idx = 0;
  let vox = 0;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x * inv, v = y * inv, w = z * inv;
        for (let c = 0; c < 4; c++) {
          const ch = channels[c];
          if (!ch || ch.worley === null) {
            out[idx++] = 255;
            continue;
          }
          let wf = 0;
          for (let o = 0; o < 3; o++) {
            const f = ch.worley << o;
            wf += OCT_W[o] * octave(f)[vox];
          }
          let r = wf;
          if (ch.perlin) {
            let p = 0;
            for (let o = 0; o < 3; o++) {
              const f = ch.perlin << o;
              p += OCT_W[o] * pGrid(f).at(u * f, v * f, w * f);
            }
            r = wf + p * (1 - wf); // Perlin remapped from [0, 1] to [worley, 1]: Perlin-Worley (Nubis, Horizon Zero Dawn)
          }
          out[idx++] = Math.round(Math.min(1, Math.max(0, r)) * 255);
        }
        vox++;
      }
  return out;
}

// 64^3 RGBA8, x fastest then y then z. R Perlin-Worley (Worley fbm from 4 cells, Perlin fbm from 4 cells);
// G, B, A Worley fbm (3 octaves) starting at 4, 8 and 16 cells per volume.
export const buildBaseNoise = (seed = 1): Uint8Array =>
  buildVolume(BASE_SIZE, seed, [{ worley: 4, perlin: 4 }, { worley: 4 }, { worley: 8 }, { worley: 16 }]);

// 32^3 RGBA8, Worley fbm (3 octaves) starting at 2, 4 and 8 cells; A unused (255).
export const buildDetailNoise = (seed = 2): Uint8Array =>
  buildVolume(DETAIL_SIZE, seed, [{ worley: 2 }, { worley: 4 }, { worley: 8 }, { worley: null }]);
