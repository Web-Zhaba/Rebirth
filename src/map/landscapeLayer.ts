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
import { PALETTE } from "../ui/palette";
import type { WeatherState } from "../sim/weather";
import type { Frame as TownFrame } from "../world/frame";
import { pointInRings, type Land } from "../world/landcover";
import { lngLatToTile } from "../world/mercator";
import { NATURE_MAXZOOM } from "../world/nature";
import { getLandTile, type LandTile } from "../world/tiles";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { mercatorLocal, projectPoints } from "./modelBuffers";
import { rgb } from "./modelGeometry";
import { groundAt, loadGround, reliefScale } from "./relief";
import { snowOpacity } from "./weatherMath";
import { weatherMapOn } from "./weatherSettings";
import { eyeOf } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";
import {
  clearTerrainSurfaceWindow,
  setTerrainSurfaceWindow,
  terrainSurfaceAt,
  TERRAIN_CENTER_STEP,
  TERRAIN_FINE_CELL,
  TERRAIN_FINE_HALF,
  TERRAIN_OUTER_CELL,
  TERRAIN_OUTER_HALF,
} from "./terrainSurface";

export const LANDSCAPE_LAYER_ID = "landscape-terrain";
export const LANDSCAPE_FROM_ZOOM = 12.5;

const HALF = TERRAIN_OUTER_HALF;
const CELL = TERRAIN_OUTER_CELL;
const GRID = Math.ceil((HALF * 2) / CELL);

// The fine patch, coarse patch and terrainSurfaceAt share these exact
// dimensions and globally aligned grid origins.
const FINE_HALF = TERRAIN_FINE_HALF;
const FINE_CELL = TERRAIN_FINE_CELL;
const FINE_GRID = Math.ceil((FINE_HALF * 2) / FINE_CELL);
const CENTER_STEP = TERRAIN_CENTER_STEP;

interface LandscapeOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
  getCameraLift: () => number;
  setCameraLift: (lift: number) => void;
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
uniform float uSnow;
uniform vec3 uSnowCol;
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

  float snowNoise = 0.55 + 0.45 * hash2(vP.xy / 7.0 + 19.0);
  float snow =
    uSnow *
    smoothstep(0.45, 0.9, n.z) *
    smoothstep(0.45, 0.72, snowNoise);

  col = mix(
    col,
    uSnowCol * mix(0.82, 1.0, light),
    snow
  );

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
  let meshes: Mesh[] = [];
  let origin: { lng: number; lat: number } | null = null;
  let lastCameraCollisionCheck = -Infinity;
  let cameraGroundLoading = false;
  let loading = false;
  let generation = 0;
  let meshCentre: [number, number] | null = null;
  let requestedCentre: [number, number] | null = null;

  const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const camera = new Camera();
  const framer = frameSetter(opts.light);
  const stops: (() => void)[] = [];

  const biomeColor: Record<Land, readonly number[]> = {
    // The terrain under a water polygon is only the seabed; the actual water surface
    // is drawn by waterLayer. Use a warm seabed colour so tiny vector-tile seams
    // cannot leak the blue 2D-style fill through the shoreline.
    water: rgb(PALETTE.mapSand),
    forest: rgb(PALETTE.mapForest),
    meadow: rgb(PALETTE.mapGrass),
    wetland: rgb(PALETTE.mapWetland),
    sand: rgb(PALETTE.mapSand),
    rock: rgb(PALETTE.mapRock),
    ice: rgb(PALETTE.mapIce),
  };

  const rock = rgb(PALETTE.mapRock);
  const ice = rgb(PALETTE.mapIce);
  const sand = rgb(PALETTE.mapSand);

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

    for (const mesh of meshes) {
      scene?.remove(mesh);
      mesh.geometry.dispose();
    }
    meshes = [];

    meshCentre = null;
    clearTerrainSurfaceWindow();
  };

  const gridPoints = (
    tf: TownFrame,
    centre: readonly [number, number],
    half: number,
    cell: number,
    grid: number,
  ): [number, number][] => {
    const side = grid + 1;
    const points = new Array<[number, number]>(side * side);
    let q = 0;

    for (let y = 0; y <= grid; y++) {
      for (let x = 0; x <= grid; x++, q++) {
        const lx = centre[0] - half + x * cell;
        const ly = centre[1] - half + y * cell;
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
    half: number,
    cell: number,
    grid: number,
    cutInnerPatch: boolean,
    shouldCancel: () => boolean,
  ): Promise<Mesh | null> => {
    if (!scene || !mat) return null;

    const side = grid + 1;
    const heights = new Float64Array(points.length);

    // Keep each batch short enough that the browser can service input and paint
    // while terrain is first generated. The close-up threshold used to run all
    // height and polygon classification work in one uninterrupted task.
    const batchSize = 4096;
    for (let start = 0; start < points.length; start += batchSize) {
      const end = Math.min(points.length, start + batchSize);
      for (let q = start; q < end; q++) {
        const [lng, lat] = points[q];
        const h = groundAt(lng, lat);
        if (h === null) return null;
        heights[q] = h;
      }
      if (end < points.length) {
        await yieldToBrowser();
        if (shouldCancel()) return null;
      }
    }

    const scale = reliefScale.peek();
    const local = new Float64Array(points.length * 3);
    const colors = new Float32Array(points.length * 3);
    const biomes = new Array<Land>(points.length);
    for (let start = 0; start < points.length; start += batchSize) {
      const end = Math.min(points.length, start + batchSize);
      for (let q = start; q < end; q++) {
        const [lng, lat] = points[q];
        biomes[q] = biomeAt(lng, lat);
      }
      if (end < points.length) {
        await yieldToBrowser();
        if (shouldCancel()) return null;
      }
    }

    const at = (x: number, y: number): number => {
      const cx = Math.max(0, Math.min(grid, x));
      const cy = Math.max(0, Math.min(grid, y));
      return heights[cy * side + cx];
    };

    const biomeAtGrid = (x: number, y: number): Land => {
      const cx = Math.max(0, Math.min(grid, x));
      const cy = Math.max(0, Math.min(grid, y));
      return biomes[cy * side + cx];
    };

    let q = 0;
    for (let y = 0; y <= grid; y++) {
      for (let x = 0; x <= grid; x++, q++) {
        const h = heights[q];
        const biome = biomes[q];

        local[q * 3] = centre[0] - half + x * cell;
        local[q * 3 + 1] = centre[1] - half + y * cell;

        // Keep only the terrain's seabed underneath a water polygon. DEM pixels
        // close to the coast often contain land elevation, so h - 2m can leave
        // blue-tinted raised shelves above sea level. A fixed negative seabed
        // keeps the water surface authoritative for oceans, seas and lakes.
        local[q * 3 + 2] = (biome === "water" ? -3 : h) * scale;

        const sx = (at(x + 1, y) - at(x - 1, y)) / (2 * cell);
        const sy = (at(x, y + 1) - at(x, y - 1)) / (2 * cell);
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
            // Do not reuse the cartographic shore tint here: it is bluish and
          // belongs to the 2D style. The custom world needs a warm sand/pebble
          // transition on land, so beaches blend toward sand and exposed gravel.
          const sandAmount =
            biome === "sand" ? 0.82 :
            biome === "wetland" ? 0.16 :
            0.58;
          color = mix3(color, sand, sandAmount);

          if (biome !== "sand" && biome !== "wetland") {
            color = mix3(color, rock, 0.12);
          }
          }
        }

        colors[q * 3] = color[0];
        colors[q * 3 + 1] = color[1];
        colors[q * 3 + 2] = color[2];

        if ((q & 4095) === 4095) {
          await yieldToBrowser();
          if (shouldCancel()) return null;
        }
      }
    }

    const projected = projectPoints(local, tf.toLngLat, o);
    const indices: number[] = [];

    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const cx = -half + (x + 0.5) * cell;
        const cy = -half + (y + 0.5) * cell;
        if (
          cutInnerPatch &&
          Math.abs(cx) < FINE_HALF + cell * 0.5 &&
          Math.abs(cy) < FINE_HALF + cell * 0.5
        ) {
          continue;
        }

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

  if (import.meta.env.DEV) {
    Object.assign(window, {
      landscapeStats: () => ({
        active: meshes.length > 0,
        loading,
        centre: meshCentre ? [...meshCentre] : null,
        meshCount: meshes.length,
        vertices: meshes.reduce((sum, mesh) => sum + (mesh.geometry.getAttribute("aM")?.count ?? 0), 0),
        triangles: meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? 0) / 3, 0),
        relief: reliefScale.peek(),
        zoom: map.getZoom(),
        snow:
          weatherMapOn.peek() && opts.weather.peek()
            ? snowOpacity(opts.weather.peek()!.snowpack) / snowOpacity(1)
            : 0,
      }),
    });
  }

  const requestBuild = (
    tf: TownFrame,
    centre: readonly [number, number],
  ) => {
    if (loading || !origin) return;

    if (
      meshes.length > 0 &&
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
    const outerPoints = gridPoints(tf, buildCentre, HALF, CELL, GRID);
    const finePoints = gridPoints(tf, buildCentre, FINE_HALF, FINE_CELL, FINE_GRID);

    // Loading DEM/vector tiles does not require every mesh vertex. A sparse
    // 480m coverage lattice finds the same source tiles without converting every
    // vertex before the mesh is built. Mesh construction itself yields in batches.
    const coveragePoints: [number, number][] = [];
    const side = GRID + 1;
    const coverageStride = 2;
    for (let y = 0; y <= GRID; y += coverageStride) {
      for (let x = 0; x <= GRID; x += coverageStride) {
        coveragePoints.push(outerPoints[y * side + x]);
      }
    }

    void Promise.all([loadGround(coveragePoints), loadNature(coveragePoints)])
      .then(async () => {
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

        const isCurrentBuild = () =>
          buildGeneration === generation &&
          !!scene &&
          !!mat &&
          !!origin &&
          origin.lng === buildOrigin.lng &&
          origin.lat === buildOrigin.lat;

        const outer = await buildMesh(
          tf,
          buildOrigin,
          outerPoints,
          buildCentre,
          HALF,
          CELL,
          GRID,
          true,
          isCurrentBuild,
        );

        if (!outer || !isCurrentBuild()) {
          outer?.geometry.dispose();
          return;
        }

        const fine = await buildMesh(
          tf,
          buildOrigin,
          finePoints,
          buildCentre,
          FINE_HALF,
          FINE_CELL,
          FINE_GRID,
          false,
          isCurrentBuild,
        );

        if (!fine || !isCurrentBuild()) {
          outer.geometry.dispose();
          fine?.geometry.dispose();
          return;
        }

        for (const old of meshes) {
          scene.remove(old);
          old.geometry.dispose();
        }

        meshes = [outer, fine];
        meshCentre = buildCentre;
        scene.add(outer, fine);
        setTerrainSurfaceWindow(tf, buildCentre);
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
          uSnow: { value: 0 },
          uSnowCol: { value: new Vector3(...rgb(PALETTE.mapIce)) },
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

      // Recover the camera eye from MapLibre's render matrix. This guard is
      // intentionally throttled: recomputing matrix inversion and four DEM
      // samples on every WebGL frame caused severe stalls while zooming.
      const now = performance.now();
      if (now - lastCameraCollisionCheck >= 160) {
        lastCameraCollisionCheck = now;
        const cameraMatrix = framer.mercator(args, host, origin);
        const eye = eyeOf(cameraMatrix);

        if (eye) {
          const merc = mercatorLocal(origin);
          const [eyeLng, eyeLat] = merc.from(eye[0], eye[1]);
          const cameraGround = terrainSurfaceAt(eyeLng, eyeLat, tf);

          if (cameraGround === null) {
            if (!cameraGroundLoading) {
              cameraGroundLoading = true;
              void loadGround([[eyeLng, eyeLat]])
                .finally(() => {
                  cameraGroundLoading = false;
                  map.triggerRepaint();
                });
            }
          } else {
            const currentLift = opts.getCameraLift();
            const unliftedEyeAltitude = eye[2] - currentLift;
            const requiredAltitude = cameraGround * reliefScale.peek() + 35;
            const desiredLift = Math.max(0, requiredAltitude - unliftedEyeAltitude);

            if (Math.abs(desiredLift - currentLift) > 8) {
              opts.setCameraLift(desiredLift);
            }
          }
        }
      }

      // The custom terrain window must follow MapLibre's orbit target, not
      // the camera eye. Following the eye shifted the detailed inner patch away
      // from the town whenever the camera was pitched, which made buildings,
      // roads and the ground disagree at precisely the point the player sees.
      const mapCenter = map.getCenter();
      const [targetX, targetY] = tf.toLocal(mapCenter.lng, mapCenter.lat);

      const centre: [number, number] = [
        Math.round(targetX / CENTER_STEP) * CENTER_STEP,
        Math.round(targetY / CENTER_STEP) * CENTER_STEP,
      ];

      if (
        meshes.length === 0 ||
        meshCentre?.[0] !== centre[0] ||
        meshCentre?.[1] !== centre[1]
      ) {
        requestedCentre = centre;
        requestBuild(tf, centre);
      }

      if (meshes.length === 0) return;

      framer.set(mat.uniforms, args, host, origin);

      const weather = opts.weather.peek();
      mat.uniforms.uSnow.value =
        weatherMapOn.peek() && weather
          ? snowOpacity(weather.snowpack) / snowOpacity(1)
          : 0;

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

    // The terrain must be rendered before every object that relies on its
    // depth buffer. Inserting it just before labels made it run after houses,
    // trees, fields and water, so the ground could not occlude their buried
    // vertices even when their elevations were correct.
    const terrainDependent = new Set([
      "clearings-fill",
      "zones-fill",
      "buildings-planned-fill",
      "fields-3d",
      "forest-trees",
      "building-models",
      "building-lamps",
      "water-3d",
    ]);

    const order = map.getLayersOrder();
    const before = order.find((id) => terrainDependent.has(id))
      ?? (map.getLayer("place-labels") ? "place-labels" : undefined);

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
