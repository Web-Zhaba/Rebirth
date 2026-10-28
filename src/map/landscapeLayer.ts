import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NoBlending,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";
import type { Frame as TownFrame } from "../world/frame";
import { PALETTE } from "../ui/palette";
import { chunksInView } from "./chunkView";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { projectPoints } from "./modelBuffers";
import { rgb } from "./modelGeometry";
import { groundAt, loadGround, reliefScale } from "./relief";
import { eyeOf, frustumPlanes } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";

export const LANDSCAPE_LAYER_ID = "landscape-terrain";
export const LANDSCAPE_FROM_ZOOM = 10.5;

const CHUNK = 1200;
const CELL = 60;
const GRID = Math.round(CHUNK / CELL);
const FAR = 18_000;
const SLOPE_PAD = 300;
const BUILD_BUDGET_MS = 5;
const MAX_CHUNKS = 900;

interface LandscapeOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
}

interface Chunk {
  mesh: Mesh;
  seen: number;
}

const VERT = /* glsl */ `
attribute vec3 aG;
attribute vec3 aM;
attribute vec3 aColor;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vP;
varying vec3 vC;
void main() {
  vec4 m = uM * vec4(aM, 1.0);
  vec4 g = uG * vec4(aG, 1.0);
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vP = aM;
  vC = aColor;
}`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSun;
uniform vec4 uTint;
varying vec3 vP;
varying vec3 vC;

float hash2(vec2 p) {
  return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 dx = dFdx(vP);
  vec3 dy = dFdy(vP);
  vec3 n = normalize(cross(dx, dy));
  if (n.z < 0.0) n = -n;

  float lit = mix(0.55, 1.0, max(dot(n, normalize(uLight)), 0.0));
  lit *= mix(0.9, 1.0, uSun);

  float grain = 0.96 + 0.08 * hash2(vP.xy / 14.0);
  vec3 col = vC * lit * grain;
  col = mix(col, uTint.rgb, uTint.a);

  gl_FragColor = vec4(col, 1.0);
}`;

function mix3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function createLandscapeLayer(
  map: maplibregl.Map,
  opts: LandscapeOptions,
): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mat: ShaderMaterial | null = null;
  let origin: { lng: number; lat: number } | null = null;
  let frameNo = 0;

  const chunks = new Map<string, Chunk>();
  const camera = new Camera();
  const framer = frameSetter(opts.light);
  const stops: (() => void)[] = [];

  const meadow = rgb(PALETTE.mapGrass);
  const rock = rgb(PALETTE.mapRock);
  const high = rgb(PALETTE.mapIce);

  const reset = () => {
    for (const c of chunks.values()) {
      scene?.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    chunks.clear();
  };

  const keyOf = (i: number, j: number) => `${i},${j}`;

  const build = (
    i: number,
    j: number,
    tf: TownFrame,
    o: { lng: number; lat: number },
  ): Chunk | null => {
    const side = GRID + 1;
    const points: [number, number][] = new Array(side * side);
    const heights = new Float64Array(side * side);

    let p = 0;
    for (let y = 0; y <= GRID; y++) {
      for (let x = 0; x <= GRID; x++, p++) {
        const lx = i * CHUNK + x * CELL;
        const ly = j * CHUNK + y * CELL;
        points[p] = tf.toLngLat(lx, ly);
      }
    }

    let missing = false;
    for (let q = 0; q < points.length; q++) {
      const [lng, lat] = points[q];
      const h = groundAt(lng, lat);
      if (h === null) {
        missing = true;
        break;
      }
      heights[q] = h;
    }

    if (missing) {
      void loadGround(points).then(() => map.triggerRepaint());
      return null;
    }

    const k = reliefScale.peek();
    const local = new Float64Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);

    const at = (x: number, y: number) =>
      heights[Math.max(0, Math.min(GRID, y)) * side + Math.max(0, Math.min(GRID, x))];

    p = 0;
    for (let y = 0; y <= GRID; y++) {
      for (let x = 0; x <= GRID; x++, p++) {
        const h = heights[p];
        local[p * 3] = i * CHUNK + x * CELL;
        local[p * 3 + 1] = j * CHUNK + y * CELL;
        local[p * 3 + 2] = h * k;

        const sx = (at(x + 1, y) - at(x - 1, y)) / (2 * CELL);
        const sy = (at(x, y + 1) - at(x, y - 1)) / (2 * CELL);
        const slope = Math.atan(Math.hypot(sx, sy)) * 180 / Math.PI;

        const rocky = Math.min(1, Math.max(0, (slope - 18) / 24));
        const alpine = Math.min(1, Math.max(0, (h - 1500) / 1200));
        const c0 = mix3(meadow, rock, rocky * 0.8);
        const c = mix3(c0, high, alpine * alpine * 0.7);

        colors[p * 3] = c[0];
        colors[p * 3 + 1] = c[1];
        colors[p * 3 + 2] = c[2];
      }
    }

    const projected = projectPoints(local, tf.toLngLat, o);
    const indices: number[] = [];

    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const a = y * side + x;
        const b = a + 1;
        const c = a + side;
        const d = c + 1;

        if (((i + j + x + y) & 1) === 0) {
          indices.push(a, c, b, b, c, d);
        } else {
          indices.push(a, c, d, a, d, b);
        }
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute("aG", new BufferAttribute(projected.g, 3));
    geo.setAttribute("aM", new BufferAttribute(projected.m, 3));
    geo.setAttribute("aColor", new BufferAttribute(colors, 3));
    geo.setIndex(indices);

    const mesh = new Mesh(geo, mat!);
    mesh.frustumCulled = false;
    scene!.add(mesh);

    return { mesh, seen: frameNo };
  };

  return {
    id: LANDSCAPE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();

      mat = new ShaderMaterial({
        uniforms: {
          uG: { value: new Matrix4() },
          uM: { value: new Matrix4() },
          uT: { value: 0 },
          uLight: { value: framer.light },
          uSun: { value: 1 },
          uTint: { value: new Vector4() },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        blending: NoBlending,
        depthTest: true,
        depthWrite: true,
        depthFunc: LessEqualDepth,
      });

      stops.push(
        effect(() => {
          void reliefScale.value;
          reset();
          map.triggerRepaint();
        }),
        effect(() => {
          void opts.frame.value;
          origin = null;
          reset();
          map.triggerRepaint();
        }),
      );
    },

    onRemove() {
      for (const stop of stops) stop();
      stops.length = 0;
      reset();
      mat?.dispose();
      mat = null;
      scene = null;
      host?.release();
      host = null;
    },

    render(_gl, args) {
      const tf = opts.frame.peek();
      if (!host || !scene || !mat || !tf || reliefScale.peek() <= 0 || map.getZoom() < LANDSCAPE_FROM_ZOOM) return;

      const [lng, lat] = tf.toLngLat(0, 0);
      if (!origin || origin.lng !== lng || origin.lat !== lat) {
        origin = { lng, lat };
        reset();
      }

      const M = framer.mercator(args, host, origin);
      const eye = eyeOf(M);
      if (!eye) return;

      const seen = chunksInView({
        planes: frustumPlanes(M),
        eye,
        at: [0, 0],
        far: FAR,
        size: CHUNK,
        rise: SLOPE_PAD,
        slope: SLOPE_PAD,
        centre(x, y, out) {
          const [a, b] = tf.toLngLat(x, y);
          const h = groundAt(a, b) ?? 0;
          out[0] = x;
          out[1] = y;
          out[2] = h * reliefScale.peek();
        },
      });

      frameNo++;
      const wanted = new Set<string>();
      const started = performance.now();
      let missing = false;

      for (const s of seen) {
        const key = keyOf(s.i, s.j);
        wanted.add(key);

        let c = chunks.get(key);
        if (!c) {
          if (performance.now() - started > BUILD_BUDGET_MS) {
            missing = true;
            continue;
          }
          c = build(s.i, s.j, tf, origin);
          if (!c) {
            missing = true;
            continue;
          }
          chunks.set(key, c);
        }

        c.seen = frameNo;
        c.mesh.visible = true;
      }

      for (const [key, c] of chunks) {
        if (!wanted.has(key)) c.mesh.visible = false;
        if (chunks.size > MAX_CHUNKS && frameNo - c.seen > 300) {
          scene.remove(c.mesh);
          c.mesh.geometry.dispose();
          chunks.delete(key);
        }
      }

      if (missing) map.triggerRepaint();

      framer.set(mat.uniforms, args, host, origin);

      host.draw((r) => {
        r.render(scene!, camera);
      });
    },
  };
}

export function attachLandscapeLayer(
  map: maplibregl.Map,
  opts: LandscapeOptions,
): () => void {
  const layer = createLandscapeLayer(map, opts);
  let disposed = false;

  const add = () => {
    if (disposed || map.getLayer(LANDSCAPE_LAYER_ID)) return;
    const before = map.getLayer("place-labels") ? "place-labels" : undefined;
    map.addLayer(layer, before);
    map.off("styledata", add);
  };

  if (map.isStyleLoaded()) add();
  else map.on("styledata", add);

  return () => {
    disposed = true;
    map.off("styledata", add);
    if (map.getLayer(LANDSCAPE_LAYER_ID)) map.removeLayer(LANDSCAPE_LAYER_ID);
  };
}
