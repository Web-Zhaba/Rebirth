import type maplibregl from "maplibre-gl";
import type { ReadonlySignal } from "@preact/signals";
import { effect } from "@preact/signals";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, LessEqualDepth, Matrix4, Mesh, NoBlending, Scene, ShaderMaterial, ShapeUtils, Camera, Vector2, Vector3 } from "three";
import type { Building } from "../sim/types";
import type { Frame as TownFrame } from "../world/frame";
import { PALETTE } from "../ui/palette";
import { EARTH_RADIUS_M, lngLatToMercator, mercatorLocalMatrix, metresPerMercator } from "./clouds/frame";
import { localFrame } from "./clouds/shadowMath";
import { acquireHost, type ThreeHost } from "./clouds/three";

// Restored buildings drawn by three.js inside the MapLibre map (PLAN-research.ru.md section 8, stage T0 spike). Import
// this file only with a dynamic `import()` (it pulls in three.js).
//
// A custom layer with `renderingMode: "3d"`: MapLibre sets its 3D depth mode (shared depth buffer with fill-extrusion,
// LEQUAL, read-write, 3D depth range) before `render`, and our material keeps depth test and write on, so meshes and
// fill-extrusions occlude each other per pixel.
//
// Projection: each vertex is stored twice, in a globe tangent frame and in a mercator frame, both in metres relative to
// the layer origin and computed in float64 on the CPU from the vertex's lng/lat:
// - globe: exact tangent coordinates (east, north, up) of the point (R + h) * unit(lng, lat) about the origin, so the
//   map to the unit sphere is affine: sphere = o + (E e + N n + U o) / R. Matrix = main * that, in float64 per frame.
// - mercator: east = dLng * R cos(lat0), north = R cos(lat0) * (ymerc(lat) - ymerc(lat0)), up = h, through
//   mercatorLocalMatrix(fallback, ...) (the same helper the shadow layer uses).
// The vertex shader mixes the two clip positions with `projectionTransition`, exactly like MapLibre's
// interpolateProjectionFor3D does for fill-extrusion, so depth values agree through the projection transition.

export const RESTORED_LAYER_ID = "restored-buildings";
const R = EARTH_RADIUS_M;
const RAD = Math.PI / 180;
const atanh = (x: number) => 0.5 * Math.log((1 + x) / (1 - x));

// A building to draw: ring in town-local metres (counter-clockwise), heights in metres.
export interface RestoredPiece {
  ring: [number, number][];
  height: number;
  wall: string;
  roof: string;
  gable: boolean; // gabled roof on a 4-corner ring (ridge along the long axis); anything else gets a flat roof
}

type P3 = [number, number, number];

interface Buf {
  g: number[]; // globe tangent frame
  m: number[]; // mercator frame
  n: number[];
  c: number[];
}

// Pure geometry (no GL): walls plus a flat or gabled roof for every piece. `toLngLat` is the town frame's local -> lng/lat.
export function buildGeometry(pieces: RestoredPiece[], toLngLat: (x: number, y: number) => [number, number], origin: { lng: number; lat: number }): Buf {
  const f = localFrame(origin.lng, origin.lat);
  const l0 = origin.lng * RAD;
  const cp0 = Math.cos(origin.lat * RAD);
  const ym0 = atanh(Math.sin(origin.lat * RAD));
  const out: Buf = { g: [], m: [], n: [], c: [] };

  const vertex = (p: P3, n: P3, col: Color) => {
    const [lng, lat] = toLngLat(p[0], p[1]);
    const l = lng * RAD;
    const ph = lat * RAD;
    const cp = Math.cos(ph);
    const r = R + p[2];
    const dx = Math.sin(l) * cp * r - f.o[0] * R;
    const dy = Math.sin(ph) * r - f.o[1] * R;
    const dz = Math.cos(l) * cp * r - f.o[2] * R;
    out.g.push(dx * f.e[0] + dy * f.e[1] + dz * f.e[2], dx * f.n[0] + dy * f.n[1] + dz * f.n[2], dx * f.o[0] + dy * f.o[1] + dz * f.o[2]);
    out.m.push((l - l0) * R * cp0, R * cp0 * (atanh(Math.sin(ph)) - ym0), p[2]);
    out.n.push(n[0], n[1], n[2]);
    out.c.push(col.r, col.g, col.b);
  };
  const faceNormal = (a: P3, b: P3, c: P3): P3 => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    return nz < 0 ? [-nx, -ny, -nz] : [nx, ny, nz]; // roofs face up (walls pass their own normal)
  };
  const tri = (a: P3, b: P3, c: P3, col: Color, n?: P3) => {
    const nn = n ?? faceNormal(a, b, c);
    vertex(a, nn, col);
    vertex(b, nn, col);
    vertex(c, nn, col);
  };
  const quad = (a: P3, b: P3, c: P3, d: P3, col: Color, n?: P3) => {
    tri(a, b, c, col, n);
    tri(a, c, d, col, n);
  };

  for (const pc of pieces) {
    let ring = pc.ring;
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
      area += x0 * y1 - x1 * y0;
    }
    if (area < 0) ring = [...ring].reverse(); // counter-clockwise: outward normal of edge d is (dy, -dx)
    const wall = new Color(pc.wall);
    const roof = new Color(pc.roof);
    const h = pc.height;
    const gabled = pc.gable && ring.length === 4;
    if (gabled && Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]) < Math.hypot(ring[2][0] - ring[1][0], ring[2][1] - ring[1][1]))
      ring = [ring[1], ring[2], ring[3], ring[0]]; // long side first
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      quad([a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], h], [a[0], a[1], h], wall, [dy / len, -dx / len, 0]);
    }
    if (gabled) {
      const [p0, p1, p2, p3] = ring;
      const shortSide = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const top = h + Math.min(6, Math.max(1.5, shortSide * 0.3));
      const r0: P3 = [(p3[0] + p0[0]) / 2, (p3[1] + p0[1]) / 2, top];
      const r1: P3 = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, top];
      const up = (p: [number, number]): P3 => [p[0], p[1], h];
      const outward = (a: [number, number], b: [number, number]): P3 => {
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        return [dy / len, -dx / len, 0];
      };
      tri(up(p3), up(p0), r0, wall, outward(p3, p0));
      tri(up(p1), up(p2), r1, wall, outward(p1, p2));
      quad(up(p0), up(p1), r1, r0, roof);
      quad(up(p2), up(p3), r0, r1, roof);
    } else {
      const idx = ShapeUtils.triangulateShape(ring.map(([x, y]) => new Vector2(x, y)), []);
      for (const [a, b, c] of idx) tri([ring[a][0], ring[a][1], h], [ring[b][0], ring[b][1], h], [ring[c][0], ring[c][1], h], roof, [0, 0, 1]);
    }
  }
  return out;
}

const VERT = /* glsl */ `
attribute vec3 aMerc;
attribute vec3 aColor;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vN;
varying vec3 vC;
void main() {
  vec4 m = uM * vec4(aMerc, 1.0);
  vec4 g = uG * vec4(position, 1.0);
  // MapLibre's interpolateProjectionFor3D: mercator -> globe by the projection transition
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vN = normal;
  vC = aColor;
}`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vC;
void main() {
  float d = max(dot(normalize(vN), uLight), 0.0);
  gl_FragColor = vec4(vC * (0.5 + 0.65 * d), 1.0);
}`;

function mul4(a: ArrayLike<number>, b: ArrayLike<number>, out = new Float64Array(16)): Float64Array {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

export interface RestoredLayer extends maplibregl.CustomLayerInterface {
  setPieces(pieces: RestoredPiece[]): void;
}

export function createRestoredLayer(map: maplibregl.Map, town: { frame: ReadonlySignal<TownFrame | null>; origin: ReadonlySignal<{ lng: number; lat: number } | null> }): RestoredLayer {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mesh: Mesh | null = null;
  let material: ShaderMaterial | null = null;
  let pieces: RestoredPiece[] = [];
  let dirty = true;
  const camera = new Camera();
  const lg = new Float64Array(16);
  const g64 = new Float64Array(16);

  const rebuild = () => {
    const tf = town.frame.peek();
    const o = town.origin.peek();
    if (!mesh || !tf || !o) return;
    const b = buildGeometry(pieces, tf.toLngLat, o);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(b.g), 3));
    geo.setAttribute("aMerc", new BufferAttribute(new Float32Array(b.m), 3));
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(b.n), 3));
    geo.setAttribute("aColor", new BufferAttribute(new Float32Array(b.c), 3));
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.visible = b.g.length > 0;
    dirty = false;
  };

  const layer: RestoredLayer = {
    id: RESTORED_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      material = new ShaderMaterial({
        uniforms: { uG: { value: new Matrix4() }, uM: { value: new Matrix4() }, uT: { value: 0 }, uLight: { value: new Vector3(-0.45, -0.55, 0.7).normalize() } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        blending: NoBlending,
        depthTest: true,
        depthWrite: true,
        depthFunc: LessEqualDepth,
      });
      mesh = Object.assign(new Mesh(new BufferGeometry(), material), { frustumCulled: false });
      scene = new Scene();
      scene.add(mesh);
      dirty = true;
    },
    onRemove() {
      mesh?.geometry.dispose();
      material?.dispose();
      host?.release();
      host = null;
      scene = mesh = material = null;
    },
    render(_gl, args) {
      const o = town.origin.peek();
      if (!host || !scene || !material || !mesh || !o) return;
      if (dirty) rebuild();
      if (!mesh.visible) return;
      const fr = host.frame(args.defaultProjectionData);
      const u = material.uniforms;
      // mercator: local metres -> clip through the fallback (always the mercator matrix)
      const s = metresPerMercator(o.lat);
      (u.uM.value as Matrix4).fromArray(Float32Array.from(mercatorLocalMatrix(fr.fallback, lngLatToMercator(o.lng, o.lat), s)));
      // globe: local metres -> unit sphere (affine) -> clip
      const f = localFrame(o.lng, o.lat);
      for (let i = 0; i < 3; i++) {
        lg[i] = f.e[i] / R;
        lg[4 + i] = f.n[i] / R;
        lg[8 + i] = f.o[i] / R;
        lg[12 + i] = f.o[i];
      }
      lg[3] = lg[7] = lg[11] = 0;
      lg[15] = 1;
      (u.uG.value as Matrix4).fromArray(Float32Array.from(mul4(fr.main, lg, g64)));
      u.uT.value = fr.transition;
      host.draw((r) => r.render(scene!, camera));
    },
    setPieces(p) {
      pieces = p;
      dirty = true;
      map.triggerRepaint();
    },
  };
  return layer;
}

// ---- Debug switch (spike): localStorage "debug3dRestored" = "1" (main.ts imports this file only then) ----

const rect = (cx: number, cy: number, w: number, d: number, rot = 0): [number, number][] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as [number, number][]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const mesh = (ring: [number, number][], height: number, gable = true): RestoredPiece => ({ ring, height, wall: PALETTE.warn, roof: PALETTE.bad, gable });
// Demo scale (localStorage "debug3dRestoredScale"): at 40 the set is 2 km wide, readable at the globe/mercator zooms.
const DEMO_K = (() => {
  try {
    return Number(localStorage.getItem("debug3dRestoredScale")) || 1;
  } catch {
    return 1;
  }
})();
const scaled = (ring: [number, number][]): [number, number][] => ring.map(([x, y]) => [x * DEMO_K, y * DEMO_K]);
const DEMO_PIECES: RestoredPiece[] = [
  mesh(rect(0, 0, 18, 10), 6),
  mesh(rect(0, -28, 14, 8), 6),
  mesh(rect(-30, 8, 8, 8), 24, false),
  mesh(rect(36, 14, 16, 9, 0.5), 5),
  mesh(rect(0, 30, 30, 12), 4, false),
  mesh(rect(60, -10, 10, 10), 8, false), // seam test: shares its east wall with the fill-extrusion box below
].map((p) => ({ ...p, ring: scaled(p.ring), height: p.height * DEMO_K }));
// Fill-extrusion neighbours (rings in local metres, height): intersect or stand in front of / behind the meshes.
const DEMO_FE: { ring: [number, number][]; h: number }[] = [
  { ring: rect(14, 0, 8, 8), h: 22 },
  { ring: rect(0, -18, 40, 3), h: 12 },
  { ring: rect(-26, 8, 10, 4), h: 10 },
  { ring: rect(-30, 22, 16, 10), h: 7 },
  { ring: rect(0, 30, 6, 40), h: 9 },
  { ring: rect(70, -10, 10, 10), h: 8 },
].map((b) => ({ ring: scaled(b.ring), h: b.h * DEMO_K }));
let demoShown: boolean | null = null;
function demoFillExtrusions(map: maplibregl.Map, f: TownFrame | null): void {
  if (!map.getLayer(RESTORED_LAYER_ID) || demoShown === (f !== null)) return;
  demoShown = f !== null;
  if (!map.getSource("restored-demo-fe")) {
    map.addSource("restored-demo-fe", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "restored-demo-fe", type: "fill-extrusion", source: "restored-demo-fe", paint: { "fill-extrusion-color": PALETTE.info, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0 } }, RESTORED_LAYER_ID);
  }
  const features: GeoJSON.Feature[] = f
    ? DEMO_FE.map((b) => {
        const pts = b.ring.map(([x, y]) => f.toLngLat(x, y));
        return { type: "Feature", properties: { h: b.h }, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } };
      })
    : [];
  (map.getSource("restored-demo-fe") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
}

// Draws the town's finished buildings again as three.js meshes, shifted so they overlap their fill-extrusion twins and
// neighbours; occlusion between the two kinds can be judged by eye. Offset (metres) via localStorage "debug3dRestoredOffset"
// = "dx,dy" (default 9,5).
export function attachRestoredDebug(map: maplibregl.Map, deps: { buildings: ReadonlySignal<Record<number, Building> | null>; frame: ReadonlySignal<TownFrame | null> }): void {
  const origin = { value: null as { lng: number; lat: number } | null, peek() { return this.value; } };
  const offsetRaw = (() => {
    try {
      return localStorage.getItem("debug3dRestoredOffset");
    } catch {
      return null;
    }
  })();
  const [dx, dy] = (offsetRaw ?? "9,5").split(",").map(Number);
  const layer = createRestoredLayer(map, { frame: deps.frame, origin: origin as unknown as ReadonlySignal<{ lng: number; lat: number } | null> });
  const add = () => {
    if (map.getLayer(RESTORED_LAYER_ID) || !map.getLayer("night-tint")) return;
    map.addLayer(layer, "night-tint");
    map.off("styledata", add);
    const f = deps.frame.peek();
    if (f && !Object.values(deps.buildings.peek() ?? {}).some((b) => b.state === "active")) demoFillExtrusions(map, f);
  };
  if (map.getLayer("night-tint")) add();
  else map.on("styledata", add);
  effect(() => {
    const list = deps.buildings.value;
    const f = deps.frame.value;
    if (!list || !f) return;
    const [lng, lat] = f.toLngLat(0, 0);
    origin.value = { lng, lat };
    const pieces: RestoredPiece[] = [];
    for (const b of Object.values(list))
      if (b.state === "active")
        pieces.push({ ring: b.footprint.map(([x, y]) => [x + dx, y + dy] as [number, number]), height: b.height * 1.2, wall: PALETTE.warn, roof: PALETTE.bad, gable: true });
    // No finished buildings yet: a fixed demo set, meshes interleaved with fill-extrusion boxes that intersect them.
    const demo = pieces.length === 0;
    if (demo) pieces.push(...DEMO_PIECES);
    demoFillExtrusions(map, demo ? f : null);
    layer.setPieces(pieces);
  });
  if (import.meta.env.DEV) Object.assign(window, { restoredLayer: layer });
}
