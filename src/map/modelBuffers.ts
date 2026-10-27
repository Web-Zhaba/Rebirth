import type { Model } from "./modelGeometry";
import { EARTH_RADIUS_M, localFrame } from "./three/frame";

// Vertex buffers of the building-models layer (modelLayer.ts). Pure maths, no three.js. Each model is projected once into
// its own packed arrays (cached by the layer per building), and the packs are merged into one indexed mesh. Each vertex
// is stored twice, in the globe tangent frame and in the mercator frame, both in metres relative to the layer origin and
// computed in float64 from the vertex's lng/lat (see modelLayer.ts for how they are used).

const R = EARTH_RADIUS_M;
const RAD = Math.PI / 180;
const atanh = (x: number) => 0.5 * Math.log((1 + x) / (1 - x));

export interface Packed {
  g: Float32Array; // globe tangent frame (east, north, up of the origin)
  m: Float32Array; // mercator frame (east, north, up) at the origin latitude scale
  n: Float32Array; // normals, town-local (east, north, up)
  c: Float32Array; // colours
  f: Float32Array; // facade codes, 4 per vertex (modelGeometry.ts PATTERN)
  z: Float32Array; // height above the model's own ground per vertex (what facades are laid out by; Model.lift)
  l: Float32Array; // lamp per vertex: kind (0 none, 1 house, 2 work, 3 tavern) + a building seed in 0..1
  i: Uint32Array; // triangle indices, from 0 within the pack
}

// Town-local points (x, y, z metres, flat) into the globe tangent and mercator frames about `origin`; `toLngLat` is the
// town frame's local -> lng/lat.
export function projectPoints(p: ArrayLike<number>, toLngLat: (x: number, y: number) => [number, number], origin: { lng: number; lat: number }): { g: Float32Array; m: Float32Array } {
  const f = localFrame(origin.lng, origin.lat);
  const l0 = origin.lng * RAD;
  const cp0 = Math.cos(origin.lat * RAD);
  const ym0 = atanh(Math.sin(origin.lat * RAD));
  const g = new Float32Array(p.length), m = new Float32Array(p.length);
  for (let k = 0; k + 2 < p.length; k += 3) {
    const [lng, lat] = toLngLat(p[k], p[k + 1]);
    const z = p[k + 2];
    const l = lng * RAD;
    const ph = lat * RAD;
    const cp = Math.cos(ph);
    const r = R + z;
    const dx = Math.sin(l) * cp * r - f.o[0] * R;
    const dy = Math.sin(ph) * r - f.o[1] * R;
    const dz = Math.cos(l) * cp * r - f.o[2] * R;
    g[k] = dx * f.e[0] + dy * f.e[1] + dz * f.e[2];
    g[k + 1] = dx * f.n[0] + dy * f.n[1] + dz * f.n[2];
    g[k + 2] = dx * f.o[0] + dy * f.o[1] + dz * f.o[2];
    m[k] = (l - l0) * R * cp0;
    m[k + 1] = R * cp0 * (atanh(Math.sin(ph)) - ym0);
    m[k + 2] = z;
  }
  return { g, m };
}

// Projects a model whose x, y are town-local metres.
export function projectModel(model: Model, toLngLat: (x: number, y: number) => [number, number], origin: { lng: number; lat: number }, lamp = 0): Packed {
  const { g, m } = projectPoints(model.positions, toLngLat, origin);
  const n = model.positions.length / 3;
  const z = new Float32Array(n);
  for (let k = 0; k < n; k++) z[k] = model.positions[k * 3 + 2] - (model.lift?.[k] ?? 0);
  return { g, m, n: Float32Array.from(model.normals), c: Float32Array.from(model.colors), f: Float32Array.from(model.facade), z, l: new Float32Array(n).fill(lamp), i: Uint32Array.from(model.indices) };
}

// One pack of many, indices offset.
export function mergePacked(list: readonly Packed[]): Packed {
  let nv = 0, ni = 0;
  for (const p of list) (nv += p.g.length / 3), (ni += p.i.length);
  const out: Packed = { g: new Float32Array(nv * 3), m: new Float32Array(nv * 3), n: new Float32Array(nv * 3), c: new Float32Array(nv * 3), f: new Float32Array(nv * 4), z: new Float32Array(nv), l: new Float32Array(nv), i: new Uint32Array(ni) };
  let v = 0, k = 0;
  for (const p of list) {
    out.g.set(p.g, v * 3);
    out.m.set(p.m, v * 3);
    out.n.set(p.n, v * 3);
    out.c.set(p.c, v * 3);
    out.f.set(p.f, v * 4);
    out.z.set(p.z, v);
    out.l.set(p.l, v);
    for (let j = 0; j < p.i.length; j++) out.i[k + j] = p.i[j] + v;
    v += p.g.length / 3;
    k += p.i.length;
  }
  return out;
}
