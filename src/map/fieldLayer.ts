import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { BufferAttribute, BufferGeometry, Camera, CustomBlending, DoubleSide, LessEqualDepth, Matrix4, Mesh, OneFactor, OneMinusSrcAlphaFactor, Scene, ShaderMaterial, Vector3, Vector4 } from "three";
import { calendar, DAYS_PER_SEASON } from "../sim/clock";
import { assignFields } from "../sim/fields";
import type { WeatherState } from "../sim/weather";
import { buildings, zones } from "../simClient";
import { FIELD_COLORS } from "../ui/palette";
import type { Frame as TownFrame } from "../world/frame";
import { buildFieldMesh } from "./fieldMesh";
import { fields3dOn, showWhile } from "./graphicsSettings";
import { projectPoints } from "./modelBuffers";
import { rgb, type XY } from "./modelGeometry";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { groundAt, loadGround, reliefScale } from "./relief";
import { eyeOf } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";
import { snowOpacity } from "./weatherMath";
import { weatherMapOn } from "./weatherSettings";

// The 3D farm fields (PLAN-3d-world.ru.md stage 6): the fields of the player's town (zones.fields, the same the 2D fill
// and the game read) drawn by three.js over the 2D fill, which stays under it and beyond its reach, as ploughland and
// crop up close. Import only with a dynamic `import()` (it pulls in three.js).
//
// One mesh holds every field (they are few): each polygon cut into 4 m cells draped on the relief a few centimetres
// above the ground (fieldMesh.ts), pulled a little toward the camera like the water so the terrain does not show
// through. Everything else is the fragment shader, procedural, in metres along and across the furrows (the longest edge
// of the field): ridges every 0.7 m with a fake normal lit by the sun, faded out before they get finer than a pixel.
// The stage of the year follows the game calendar (the admin season preview too), in seasons S = DAYS_PER_SEASON, with a
// per-field shift of a day or two so neighbours differ: winter, the ploughed soil under the snow (the weather's snowpack,
// the ridges poking through); early spring, dark fresh soil; from the field's sowing day (spring into early summer) green
// shoot rows that thicken to a dense green by midsummer and turn gold by the end of it; in the harvest window (the first
// half of autumn) a share proportional to the progress is cut, as a sharp band sweeping along the furrows: pale straw
// stubble in short rows against the standing gold; late autumn, ploughed again. A field no farm works (no active gumno
// within reach, sim/fields.ts assignFields) is fallow grass and weeds with no rows. A 2-4 m headland of grass rims every
// field, with patches of colour; rain darkens it all, the night tint and the sun come through the shared frame setter.
// Nothing moves, so it asks for no frames of its own.

export const FIELD_LAYER_ID = "fields-3d";
export const FIELD_FROM_ZOOM = 14.5; // closer than this the fields are 3D
const FIELD_FULL_ZOOM = 15.2; // from here it no longer fades into the flat fill
const FAR = 2500; // m: the fields fade out toward here
const LIFT = 0.03; // m above the ground
const RAIN_FULL = 4; // mm/h: full wetness
const ROW = "0.70"; // m between furrows
const JITTER = "2.4"; // days: the span of the per-field shift of the calendar
const SEASON = DAYS_PER_SEASON.toFixed(1);

const VERT = /* glsl */ `
attribute vec3 aG;
attribute vec3 aM;
attribute vec2 aLoc;
attribute vec2 aDir;
attribute vec4 aInfo;
attribute float aEdge;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
uniform vec3 uEye;
varying vec3 vM;
varying vec2 vLoc;
varying vec2 vDir;
varying vec4 vInfo;
varying float vEdge;
void main() {
  // pulled a little toward the camera along its ray: drawn over the ground it lies on, at the same place on the screen
  vec3 toEye = uEye - aM;
  float d = max(length(toEye), 1.0);
  vec3 lift = toEye * (min(d * 0.002, 25.0) / d);
  vec4 m = uM * vec4(aM + lift, 1.0);
  vec4 g = uG * vec4(aG + lift, 1.0);
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vM = aM;
  vLoc = aLoc;
  vDir = aDir;
  vInfo = aInfo;
  vEdge = aEdge;
}`;

const FRAG = /* glsl */ `
uniform vec3 uEye;
uniform vec3 uLight;
uniform float uSun;
uniform vec4 uTint;
uniform float uDay;
uniform float uRain;
uniform float uSnow;
uniform float uIn;
uniform vec3 uSoil;
uniform vec3 uSoilDry;
uniform vec3 uShoot;
uniform vec3 uCrop;
uniform vec3 uRipe;
uniform vec3 uStraw;
uniform vec3 uStubble;
uniform vec3 uGrass;
uniform vec3 uFallow;
uniform vec3 uFallowDry;
uniform vec3 uSnowCol;
varying vec3 vM;
varying vec2 vLoc;
varying vec2 vDir;
varying vec4 vInfo; // worked (0/1), the field's hash, its extent along the furrows (min, max) from its own origin
varying float vEdge;
float hash(vec2 p) {
  return fract(sin(dot(mod(p, 1024.0), vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float dist = length(uEye - vM);
  float fw = max(length(fwidth(vLoc)), 1e-3); // metres per pixel
  float hsh = vInfo.y;
  vec2 dir = normalize(vDir);
  vec2 perp = vec2(-dir.y, dir.x);
  float along = dot(vLoc, dir);
  float a = dot(vLoc, perp) / ${ROW};
  float ph = 6.2832 * a;
  float fade = 1.0 - smoothstep(0.2, 0.5, fw / ${ROW}); // the rows fade before they get finer than a pixel
  float ridge = 0.5 + 0.5 * sin(ph); // 0 in the furrow .. 1 on the ridge
  vec2 pp = vLoc + hsh * 97.0;
  float blotch = noise(pp * 0.06) * 0.6 + noise(pp * 0.23) * 0.4;
  float fine = noise(pp * 1.7);
  // the calendar, in seasons, shifted a little for this field
  float u = (uDay + (hsh - 0.5) * ${JITTER}) / ${SEASON};
  float dryYear = clamp(smoothstep(1.4, 2.2, u) + smoothstep(2.8, 3.1, u) + (1.0 - smoothstep(0.0, 0.5, u)), 0.0, 1.0);
  // the headland: a strip of grass along the edge, ragged
  float edge = vEdge + (noise(vLoc * 0.4 + hsh * 31.0) - 0.5) * 1.2;
  float hw = 2.0 + 2.0 * fract(hsh * 7.3);
  float headland = 1.0 - smoothstep(hw - 0.5, hw + 0.5, edge);
  vec3 grass = mix(uGrass, uFallowDry, dryYear * 0.7) * (0.86 + 0.28 * fine) * (0.92 + 0.16 * blotch);
  vec3 col;
  float amp = 0.0; // how high the ridges stand
  if (vInfo.x > 0.5) {
    // ---- a field a farm works ----
    float sowT = 0.3 + 0.9 * fract(hsh * 13.7);
    float g = smoothstep(sowT + 0.05, 1.7, u); // the crop's growth
    float cov = clamp(mix(g * 0.55, 1.0, smoothstep(0.55, 1.0, g)), 0.0, 1.0);
    float ripe = smoothstep(1.7, 2.0, u);
    float prog = clamp((u - 2.0) / 0.5, 0.0, 1.0); // the share harvested
    float plough = clamp(smoothstep(2.7, 2.8, u) + smoothstep(3.0, 3.01, u) + (1.0 - smoothstep(-0.1, 0.0, u)), 0.0, 1.0);
    // soil: ridges dried, a little different in patches
    vec3 soil = mix(uSoil, uSoilDry, ridge * 0.6 * fade + 0.2 * blotch) * (0.9 + 0.2 * blotch);
    // the crop in rows on the ridges, or covering all of it when dense
    float t = ridge + 0.15 * (fine - 0.5);
    float rows = smoothstep(1.0 - cov * 1.15 - 0.08, 1.0 - cov * 1.15 + 0.08, t) * smoothstep(0.0, 0.05, g);
    float mask = mix(cov * 0.8 * smoothstep(0.0, 0.05, g), rows, fade);
    vec3 crop = mix(uShoot, uCrop, smoothstep(0.1, 0.7, g));
    crop = mix(crop, uRipe, ripe) * (0.88 + 0.24 * blotch) * (0.94 + 0.12 * fine);
    vec3 standing = mix(soil, crop, mask);
    // the cut part: a band that sweeps along the furrows
    float span = max(vInfo.w - vInfo.z, 1.0);
    float uh = (along - vInfo.z) / span;
    if (hsh > 0.5) uh = 1.0 - uh;
    float aa = fw / span;
    float cut = prog >= 0.999 ? 1.0 : (1.0 - smoothstep(prog - aa, prog + aa, uh)) * step(0.001, prog);
    float dash = smoothstep(0.35, 0.65, noise(vec2(along * 1.4, floor(a) * 7.0)));
    vec3 stubble = mix(uStraw * (0.92 + 0.14 * fine), uStubble, ridge * 0.55 * dash * fade + 0.1 * (1.0 - fade)) * (0.9 + 0.16 * blotch);
    col = mix(standing, stubble, cut);
    col = mix(col, soil, plough);
    amp = mix(1.0, 0.45, cov * (1.0 - cut) * (1.0 - plough)) * mix(1.0, 0.5, cut * (1.0 - plough));
    col = mix(col, grass, headland);
    amp *= 1.0 - headland;
  } else {
    // ---- fallow: grass and weeds, no rows ----
    col = mix(uFallow, uFallowDry, dryYear) * (0.84 + 0.32 * blotch) * (0.92 + 0.16 * fine);
    col = mix(col, grass, headland * 0.5);
    col = mix(col, uFallowDry * 1.05, smoothstep(0.62, 0.8, noise(pp * 0.3 + 11.0)) * 0.35);
  }
  // light: the ridges as a fake normal, the furrow bottoms a little darker
  float slope = cos(ph) * 0.75 * amp * fade;
  vec3 n = normalize(vec3(-perp * slope, 1.0));
  float shade = clamp(dot(n, uLight) / max(uLight.z, 0.25), 0.55, 1.35);
  col *= shade * (1.0 - 0.22 * (1.0 - ridge) * amp * fade) * mix(0.86, 1.0, uSun);
  // snow settles in the furrows first and leaves the ridges standing out
  float thr = 0.5 + 0.5 * sin(ph) * amp * fade;
  float cover = smoothstep(thr * 0.7 - 0.05 + (blotch - 0.5) * 0.25, thr * 0.7 + 0.2 + (blotch - 0.5) * 0.25, uSnow * 1.1);
  col = mix(col, uSnowCol * mix(0.9, 1.0, shade * 0.5) * mix(0.86, 1.0, uSun), cover);
  col *= 1.0 - 0.3 * uRain * (1.0 - cover); // rain darkens the soil and the crop
  float alpha = uIn * (1.0 - smoothstep(${FAR}.0 * 0.75, ${FAR}.0, dist)) * smoothstep(0.0, 0.8, vEdge + (noise(vLoc * 0.7) - 0.5) * 0.5 + 0.15);
  gl_FragColor = vec4(mix(col, uTint.rgb, uTint.a) * alpha, alpha);
}`;

export interface FieldLayerOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
}

const shapeKey = (f: { id: number; pts: readonly (readonly number[])[] }) => `${f.id}:${f.pts.map((p) => `${p[0]},${p[1]}`).join(";")}`;

export function createFieldLayer(map: maplibregl.Map, opts: FieldLayerOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mat: ShaderMaterial | null = null;
  let mesh: Mesh | null = null;
  let origin: { lng: number; lat: number } | null = null;
  let want = ""; // what the mesh should show: the fields' revision, the farms, the frame and the relief
  let have = "";
  let working = new Set<number>();
  let counts = { fields: 0, worked: 0, verts: 0, tris: 0 };
  const stops: (() => void)[] = [];
  const shapes = new Map<string, ReturnType<typeof buildFieldMesh>>(); // by field id and outline
  const camera = new Camera();
  const framer = frameSetter(opts.light);

  const colour = (hex: string) => new Vector3(...rgb(hex));

  const reset = () => {
    if (mesh) (scene?.remove(mesh), mesh.geometry.dispose());
    mesh = null;
    have = "";
  };

  // Builds the one mesh of all the fields; false while the ground under them loads.
  const build = (tf: TownFrame, o: { lng: number; lat: number }): boolean => {
    const fields = zones.peek()?.fields ?? [];
    const k = reliefScale.peek();
    const parts = fields.map((f) => {
      const key = shapeKey(f);
      let m = shapes.get(key);
      if (!m) shapes.set(key, (m = buildFieldMesh(f.pts as XY[])));
      return { f, m };
    });
    if (shapes.size > fields.length * 2 + 8) {
      const live = new Set(fields.map(shapeKey));
      for (const key of shapes.keys()) if (!live.has(key)) shapes.delete(key);
    }
    let n = 0, tris = 0;
    for (const { m } of parts) (n += m.xy.length / 2), (tris += m.index.length / 3);
    const lngLat: [number, number][] = [];
    for (const { m } of parts) for (let v = 0; v < m.xy.length / 2; v++) lngLat.push(tf.toLngLat(m.xy[v * 2], m.xy[v * 2 + 1]));
    let ground: (number | null)[] = [];
    if (k > 0) {
      ground = lngLat.map(([a, b]) => groundAt(a, b));
      if (ground.some((h) => h === null)) {
        void loadGround(lngLat.filter((_, q) => ground[q] === null)).then(() => map.triggerRepaint());
        return false;
      }
    }
    const base = new Float64Array(n * 3);
    const loc = new Float32Array(n * 2), dir = new Float32Array(n * 2), info = new Float32Array(n * 4), edge = new Float32Array(n);
    const index: number[] = [];
    let at = 0;
    for (const { f, m } of parts) {
      const cnt = m.xy.length / 2;
      if (!cnt) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of f.pts) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
      const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2); // the origin of the field's own coordinates
      const shift = cx * m.dir[0] + cy * m.dir[1];
      const hsh = ((Math.imul(f.id + 1, 2654435761) >>> 0) % 100000) / 100000;
      const worked = working.has(f.id) ? 1 : 0;
      for (let v = 0; v < cnt; v++, at++) {
        base[at * 3] = m.xy[v * 2];
        base[at * 3 + 1] = m.xy[v * 2 + 1];
        base[at * 3 + 2] = LIFT + (k > 0 ? ground[at]! * k : 0);
        loc[at * 2] = m.xy[v * 2] - cx;
        loc[at * 2 + 1] = m.xy[v * 2 + 1] - cy;
        dir[at * 2] = m.dir[0];
        dir[at * 2 + 1] = m.dir[1];
        info.set([worked, hsh, m.along[0] - shift, m.along[1] - shift], at * 4);
        edge[at] = m.edge[v];
      }
      for (const i of m.index) index.push(i + at - cnt);
    }
    reset();
    counts = { fields: fields.length, worked: working.size, verts: n, tris };
    have = want;
    if (!n) return true;
    const { g, m } = projectPoints(base, tf.toLngLat, o);
    const geo = new BufferGeometry();
    geo.setAttribute("aG", new BufferAttribute(g, 3));
    geo.setAttribute("aM", new BufferAttribute(m, 3));
    geo.setAttribute("aLoc", new BufferAttribute(loc, 2));
    geo.setAttribute("aDir", new BufferAttribute(dir, 2));
    geo.setAttribute("aInfo", new BufferAttribute(info, 4));
    geo.setAttribute("aEdge", new BufferAttribute(edge, 1));
    geo.setIndex(new BufferAttribute(n > 65535 ? Uint32Array.from(index) : Uint16Array.from(index), 1));
    mesh = Object.assign(new Mesh(geo, mat!), { frustumCulled: false });
    scene!.add(mesh);
    return true;
  };

  // devtools: what is drawn now
  if (import.meta.env.DEV) Object.assign(window, { fieldMat: () => mat, fieldStats: () => ({ ...counts, drawn: !!mesh, day: mat?.uniforms.uDay.value }) });

  return {
    id: FIELD_LAYER_ID,
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
          uSun: { value: 0 },
          uTint: { value: new Vector4() },
          uEye: { value: new Vector3() },
          uDay: { value: 0 },
          uRain: { value: 0 },
          uSnow: { value: 0 },
          uIn: { value: 1 },
          uSoil: { value: colour(FIELD_COLORS.soil) },
          uSoilDry: { value: colour(FIELD_COLORS.soilDry) },
          uShoot: { value: colour(FIELD_COLORS.shoot) },
          uCrop: { value: colour(FIELD_COLORS.crop) },
          uRipe: { value: colour(FIELD_COLORS.ripe) },
          uStraw: { value: colour(FIELD_COLORS.straw) },
          uStubble: { value: colour(FIELD_COLORS.stubbleRow) },
          uGrass: { value: colour(FIELD_COLORS.grass) },
          uFallow: { value: colour(FIELD_COLORS.fallow) },
          uFallowDry: { value: colour(FIELD_COLORS.fallowDry) },
          uSnowCol: { value: colour(FIELD_COLORS.snow) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        transparent: true,
        blending: CustomBlending, // premultiplied, as MapLibre composites its custom layers
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
        depthTest: true,
        depthWrite: true,
        depthFunc: LessEqualDepth,
      });
      stops.push(
        // the fields, the farms that work them and the ground: the mesh is rebuilt when any of them changes
        effect(() => {
          const z = zones.value;
          const fs = z?.fields ?? [];
          const assign = assignFields(fs, buildings.value ?? {});
          working = new Set(assign.keys());
          want = `${opts.frame.value ? 1 : 0}|${z?.rev ?? 0}|${fs.length}|${[...assign].join(",")}|${reliefScale.value}`;
          if (want !== have) map.triggerRepaint();
        }),
        effect(() => {
          void opts.frame.value;
          reset();
          shapes.clear();
          map.triggerRepaint();
        }),
      );
    },
    onRemove() {
      for (const s of stops) s();
      stops.length = 0;
      reset();
      mat?.dispose();
      mat = null;
      host?.release();
      host = null;
      scene = null;
    },
    render(_gl, args) {
      const tf = opts.frame.peek();
      const zoom = map.getZoom();
      if (!host || !scene || !mat || !tf || zoom < FIELD_FROM_ZOOM) return;
      const [lng, lat] = tf.toLngLat(0, 0);
      if (!origin || origin.lng !== lng || origin.lat !== lat) {
        origin = { lng, lat };
        reset();
      }
      if (want !== have && !build(tf, origin)) return;
      if (!mesh) return;
      const M = framer.mercator(args, host, origin);
      const eye = eyeOf(M);
      if (!eye) return;
      const u = mat.uniforms;
      framer.set(u, args, host, origin);
      (u.uEye.value as Vector3).set(...eye);
      const cal = calendar(opts.light?.clock.peek() ?? 0);
      u.uDay.value = cal.dayOfYear - 1 + (cal.hour * 60 + cal.minute) / 1440;
      const w = opts.weather.peek();
      const cover = weatherMapOn.peek() && w ? 1 : 0;
      u.uRain.value = w && !w.now.snow ? Math.min(1, w.now.precip / RAIN_FULL) : 0;
      u.uSnow.value = cover ? snowOpacity(w!.snowpack) / snowOpacity(1) : 0;
      const t = Math.min(1, (zoom - FIELD_FROM_ZOOM) / (FIELD_FULL_ZOOM - FIELD_FROM_ZOOM));
      u.uIn.value = t * t * (3 - 2 * t);
      host.draw((r) => r.render(scene!, camera));
    },
  };
}

// Adds the layer over the 2D fills (and the weather on them), under the 3D models, the forest and the outlines; the
// weather fills are kept under it (weatherLayer.ts ABOVE_GROUND).
export function attachFieldLayer(map: maplibregl.Map, opts: FieldLayerOptions): () => void {
  const layer = createFieldLayer(map, opts);
  const before = () => ["building-models", "forest-trees", "buildings-outline", "weather-haze", "night-tint"].find((id) => map.getLayer(id));
  let disposed = false;
  let stopShow: (() => void) | null = null;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(FIELD_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    map.off("styledata", add);
    stopShow = showWhile(map, FIELD_LAYER_ID, fields3dOn);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    stopShow?.();
    map.off("styledata", add);
    if (map.getLayer(FIELD_LAYER_ID)) map.removeLayer(FIELD_LAYER_ID);
  };
}
