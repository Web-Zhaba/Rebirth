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
  Vector4,
} from "three";
import { PALETTE } from "../ui/palette";
import type { Frame as TownFrame } from "../world/frame";
import { pointInRings, type Land } from "../world/landcover";
import { lngLatToTile } from "../world/mercator";
import { NATURE_MAXZOOM } from "../world/nature";
import { getLandTile, type LandTile } from "../world/tiles";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { mercatorLocal, projectPoints } from "./modelBuffers";
import { rgb } from "./modelGeometry";
import { groundAt, loadGround, reliefScale } from "./relief";
import { eyeOf } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";

export const LANDSCAPE_LAYER_ID = "landscape-terrain";
export const LANDSCAPE_FROM_ZOOM = 12.5;

const HALF = 12_000;
const CELL = 120;
const GRID = Math.ceil((HALF * 2) / CELL);
const CENTER_STEP = 4_000;

interface LandscapeOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
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
  vec3 n = normalize(cross(dFdx(vP), dFdy(vP)));
  if (n.z < 0.0) n = -n;

  float light = mix(0.56, 1.0, max(dot(n, normalize(uLight)), 0.0));
  light *= mix(0.9, 1.0, uSun);

  float grain = 0.965 + 0.07 * hash2(vP.xy / 18.0);
  vec3 col = vC * light * grain;
  col = mix(col, uTint.rgb, uTint.a);

  gl_FragColor = vec4(col, 1.0);
}`;

function mix3(
  a: readonly number[],
  b: readonly number[],
  t: number,
): [number, number, number] {
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
  let mesh: Mesh | null = null;
  let origin: { lng: number; lat: number } | null = null;
  let loading = false;
  let generation = 0;
  let meshCentre: [number, number] | null = null;
  let requestedCentre: [number, number] | null = null;

  const camera = new Camera();
  const framer = frameSetter(opts.light);
  const stops: (() => void)[] = [];

  const biomeColor: Record<Land, readonly number[]> = {
    water: rgb(PALETTE.mapWater),
    forest: rgb(PALETTE.mapForest),
    meadow: rgb(PALETTE.mapGrass),
    wetland: rgb(PALETTE.mapWetland),
    sand: rgb(PALETTE.mapSand),
    rock: rgb(PALETTE.mapRock),
    ice: rgb(PALETTE.mapIce),
  };

  const rock = rgb(PALETTE.mapRock);
  const ice = rgb(PALETTE.mapIce);
  const shore = rgb(PALETTE.mapShore);

  const natureN = 2 ** NATURE_MAXZOOM;
  const natureTiles = new Map<string, LandTile>();

  const natureKey = (tx: number, ty: number): string => {
    const x = ((tx % natureN) + natureN) % natureN;
    const y = Math.max(0, Math.min(natureN - 1, ty));
    return `${x}/${y}`;
  };

  const loadNature = async (points: readonly [number, number][]): Promise<void> => {
    const need = new Set<string>();

    for (const [lng, lat] of points) {
      const t = lngLatToTile(lng, lat, NATURE_MAXZOOM);
      const key = natureKey(Math.floor(t.x), Math.floor(t.y));
      if (!natureTiles.has(key)) need.add(key);
    }

    await Promise.all(
      [...need].map(async (key) => {
        const [x, y] = key.split("/").map(Number);
        try {
          natureTiles.set(key, await getLandTile(x, y));
        } catch {
          natureTiles.set(key, { extent: 4096, land: [], water: [] });
        }
      }),
    );
  };

  const biomeAt = (lng: number, lat: number): Land => {
    const t = lngLatToTile(lng, lat, NATURE_MAXZOOM);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    const tile = natureTiles.get(natureKey(tx, ty));

    if (!tile) return "meadow";

    const x = (t.x - tx) * tile.extent;
    const y = (t.y - ty) * tile.extent;

    const hit = (p: LandTile["land"][number]): boolean =>
      x >= p.bbox[0] &&
      x <= p.bbox[2] &&
      y >= p.bbox[1] &&
      y <= p.bbox[3] &&
      pointInRings(x, y, p.rings);

    if (tile.water.some(hit)) return "water";

    const p = tile.land.find(hit);
    if (!p) return "meadow";

    if (p.cls === "wood") return "forest";
    if (p.cls === "wetland") return "wetland";
    if (p.cls === "sand") return "sand";
    if (p.cls === "rock") return "rock";
    if (p.cls === "ice") return "ice";

    return "meadow";
  };

  const clearMesh = () => {
    generation++;
    loading = false;

    if (mesh) {
      scene?.remove(mesh);
      mesh.geometry.dispose();
      mesh = null;
    }

    meshCentre = null;
  };

  const gridPoints = (
    tf: TownFrame,
    centre: readonly [number, number],
  ): [number, number][] => {
    const side = GRID + 1;
    const points = new Array<[number, number]>(side * side);
    let q = 0;

    for (let y = 0; y <= GRID; y++) {
      for (let x = 0; x <= GRID; x++, q++) {
        const lx = centre[0] - HALF + x * CELL;
        const ly = centre[1] - HALF + y * CELL;
        points[q] = tf.toLngLat(lx, ly);
      }
    }

    return points;
  };

  const buildMesh = (
    tf: TownFrame,
    o: { lng: number; lat: number },
    points: readonly [number, number][],
    centre: readonly [number, number],
  ): Mesh | null => {
    if (!scene || !mat) return null;

    const side = GRID + 1;
    const heights = new Float64Array(points.length);

    for (let q = 0; q < points.length; q++) {
      const [lng, lat] = points[q];
      const h = groundAt(lng, lat);
      if (h === null) return null;
      heights[q] = h;
    }

    const scale = reliefScale.peek();
    const local = new Float64Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    const biomes = points.map(([lng, lat]) => biomeAt(lng, lat));

    const at = (x: number, y: number): number => {
      const cx = Math.max(0, Math.min(GRID, x));
      const cy = Math.max(0, Math.min(GRID, y));
      return heights[cy * side + cx];
    };

    const biomeAtGrid = (x: number, y: number): Land => {
      const cx = Math.max(0, Math.min(GRID, x));
      const cy = Math.max(0, Math.min(GRID, y));
      return biomes[cy * side + cx];
    };

    let q = 0;
    for (let y = 0; y <= GRID; y++) {
      for (let x = 0; x <= GRID; x++, q++) {
        const h = heights[q];
        const biome = biomes[q];

        local[q * 3] = centre[0] - HALF + x * CELL;
        local[q * 3 + 1] = centre[1] - HALF + y * CELL;

        // Water gets its own dedicated surface. Keep terrain underneath it,
        // but slightly lower so the two opaque surfaces can never z-fight.
        local[q * 3 + 2] = (biome === "water" ? h - 2 : h) * scale;

        const sx = (at(x + 1, y) - at(x - 1, y)) / (2 * CELL);
        const sy = (at(x, y + 1) - at(x, y - 1)) / (2 * CELL);
        const slope = Math.atan(Math.hypot(sx, sy)) * 180 / Math.PI;

        const rocky = Math.min(1, Math.max(0, (slope - 18) / 28));
        const alpine = Math.min(1, Math.max(0, (h - 1500) / 1300));

        const base = biomeColor[biome];
        const rockyBase =
          biome === "water" || biome === "sand" || biome === "wetland" || biome === "ice"
            ? base
            : mix3(base, rock, rocky * 0.75);

        let color =
          biome === "ice" || biome === "water"
            ? rockyBase
            : mix3(rockyBase, ice, alpine * alpine * 0.65);

        if (biome !== "water" && biome !== "ice") {
          const touchesWater =
            biomeAtGrid(x - 1, y) === "water" ||
            biomeAtGrid(x + 1, y) === "water" ||
            biomeAtGrid(x, y - 1) === "water" ||
            biomeAtGrid(x, y + 1) === "water";

          if (touchesWater) {
            const shoreAmount =
              biome === "sand" ? 0.7 :
              biome === "wetland" ? 0.2 :
              0.42;
            color = mix3(color, shore, shoreAmount);
          }
        }

        colors[q * 3] = color[0];
        colors[q * 3 + 1] = color[1];
        colors[q * 3 + 2] = color[2];
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

        if (((x + y) & 1) === 0) {
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

    const out = new Mesh(geo, mat);
    out.frustumCulled = false;
    return out;
  };

  const requestBuild = (
    tf: TownFrame,
    centre: readonly [number, number],
  ) => {
    if (loading || !origin) return;

    if (
      mesh &&
      meshCentre?.[0] === centre[0] &&
      meshCentre?.[1] === centre[1]
    ) {
      return;
    }

    loading = true;
    requestedCentre = [centre[0], centre[1]];

    const buildGeneration = generation;
    const buildOrigin = origin;
    const buildCentre: [number, number] = [centre[0], centre[1]];
    const points = gridPoints(tf, buildCentre);

    void Promise.all([loadGround(points), loadNature(points)])
      .then(() => {
        if (
          buildGeneration !== generation ||
          !scene ||
          !mat ||
          !origin ||
          origin.lng !== buildOrigin.lng ||
          origin.lat !== buildOrigin.lat
        ) {
          return;
        }

        const made = buildMesh(tf, buildOrigin, points, buildCentre);
        if (!made) return;

        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }

        mesh = made;
        meshCentre = buildCentre;
        scene.add(made);
      })
      .finally(() => {
        if (buildGeneration === generation) {
          loading = false;

          // The camera may have crossed another snap boundary while this
          // terrain window was loading. Render this one, then schedule the next.
          if (
            requestedCentre &&
            (
              requestedCentre[0] !== meshCentre?.[0] ||
              requestedCentre[1] !== meshCentre?.[1]
            )
          ) {
            map.triggerRepaint();
          } else {
            requestedCentre = null;
            map.triggerRepaint();
          }
        }
      });
  };

  return {
    id: LANDSCAPE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",

    onAdd(_m, gl) {
      host = acquireHost(map, gl);
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
          clearMesh();
          map.triggerRepaint();
        }),
        effect(() => {
          void opts.frame.value;
          origin = null;
          clearMesh();
          map.triggerRepaint();
        }),
      );
    },

    onRemove() {
      for (const stop of stops) stop();
      stops.length = 0;

      clearMesh();
      mat?.dispose();
      mat = null;
      scene = null;

      host?.release();
      host = null;
    },

    render(_gl, args) {
      const tf = opts.frame.peek();

      if (
        !host ||
        !scene ||
        !mat ||
        !tf ||
        reliefScale.peek() <= 0 ||
        map.getZoom() < LANDSCAPE_FROM_ZOOM
      ) {
        return;
      }

      const [lng, lat] = tf.toLngLat(0, 0);

      if (!origin || origin.lng !== lng || origin.lat !== lat) {
        origin = { lng, lat };
        clearMesh();
      }

      const mercatorMatrix = framer.mercator(args, host, origin);
      const eye = eyeOf(mercatorMatrix);

      if (!eye) return;

      const merc = mercatorLocal(origin);
      const [eyeLng, eyeLat] = merc.from(eye[0], eye[1]);
      const [eyeX, eyeY] = tf.toLocal(eyeLng, eyeLat);

      const centre: [number, number] = [
        Math.round(eyeX / CENTER_STEP) * CENTER_STEP,
        Math.round(eyeY / CENTER_STEP) * CENTER_STEP,
      ];

      if (
        !mesh ||
        meshCentre?.[0] !== centre[0] ||
        meshCentre?.[1] !== centre[1]
      ) {
        requestedCentre = centre;
        requestBuild(tf, centre);
      }

      if (!mesh) return;

      framer.set(mat.uniforms, args, host, origin);

      host.draw((renderer) => {
        renderer.render(scene!, camera);
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

    if (map.getLayer(LANDSCAPE_LAYER_ID)) {
      map.removeLayer(LANDSCAPE_LAYER_ID);
    }
  };
}
