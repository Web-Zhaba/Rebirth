import type { HeritageModel } from "./heritageModels";
import { EARTH_RADIUS_M, localFrame } from "./three/frame";

// Vertex buffers of the restored-buildings layer (restoredLayer.ts): many models merged into one indexed mesh. Pure maths,
// no three.js. Each vertex is stored twice, in the globe tangent frame and in the mercator frame, both in metres relative
// to the layer origin and computed in float64 from the vertex's lng/lat (see restoredLayer.ts for how they are used).

const R = EARTH_RADIUS_M;
const RAD = Math.PI / 180;
const atanh = (x: number) => 0.5 * Math.log((1 + x) / (1 - x));

export interface Buffers {
  g: number[]; // globe tangent frame (east, north, up of the origin)
  m: number[]; // mercator frame (east, north, up) at the origin latitude scale
  n: number[]; // normals, town-local (east, north, up)
  c: number[]; // colours
  i: number[]; // triangle indices
}

export const emptyBuffers = (): Buffers => ({ g: [], m: [], n: [], c: [], i: [] });

// Appends a model whose x, y are town-local metres; `toLngLat` is the town frame's local -> lng/lat.
export function appendModel(out: Buffers, model: HeritageModel, toLngLat: (x: number, y: number) => [number, number], origin: { lng: number; lat: number }): void {
  const f = localFrame(origin.lng, origin.lat);
  const l0 = origin.lng * RAD;
  const cp0 = Math.cos(origin.lat * RAD);
  const ym0 = atanh(Math.sin(origin.lat * RAD));
  const base = out.g.length / 3;
  const p = model.positions;
  for (let k = 0; k < p.length; k += 3) {
    const [lng, lat] = toLngLat(p[k], p[k + 1]);
    const z = p[k + 2];
    const l = lng * RAD;
    const ph = lat * RAD;
    const cp = Math.cos(ph);
    const r = R + z;
    const dx = Math.sin(l) * cp * r - f.o[0] * R;
    const dy = Math.sin(ph) * r - f.o[1] * R;
    const dz = Math.cos(l) * cp * r - f.o[2] * R;
    out.g.push(dx * f.e[0] + dy * f.e[1] + dz * f.e[2], dx * f.n[0] + dy * f.n[1] + dz * f.n[2], dx * f.o[0] + dy * f.o[1] + dz * f.o[2]);
    out.m.push((l - l0) * R * cp0, R * cp0 * (atanh(Math.sin(ph)) - ym0), z);
  }
  for (const v of model.normals) out.n.push(v);
  for (const v of model.colors) out.c.push(v);
  for (const v of model.indices) out.i.push(base + v);
}
