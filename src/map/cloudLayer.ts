import type maplibregl from "maplibre-gl";
import { effect, signal, type ReadonlySignal } from "@preact/signals";
import { sunDirection } from "../sim/weather";
import { PALETTE } from "../ui/palette";
import { buildCloudData, buildCloudRows, buildShellMesh, cloudOpacity, interval, REBUILD_MIN, ROWS_PER_FRAME, TEX_H, TEX_W } from "./cloudTexture";

// Clouds on the globe (PLAN-weather.md section 5): a MapLibre custom layer drawing thin spherical shells whose fragments
// threshold a 3D noise against the cloud cover of the weather model. Visible only on the far views of the globe.

// Whether clouds are drawn: a choice of the player's, kept in localStorage.
const SHOW_KEY = "rebirth.clouds";
function readShown(): boolean {
  try {
    return localStorage.getItem(SHOW_KEY) !== "0";
  } catch {
    return true;
  }
}

export const cloudsOn = signal(readShown());

export function toggleClouds(): void {
  cloudsOn.value = !cloudsOn.value;
  try {
    localStorage.setItem(SHOW_KEY, cloudsOn.value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const LAYER_ID = "weather-clouds";
// Shell altitudes in metres above the globe radius, far more than the real 1.5-10 km so the parallax shows.
const SHELLS = [18000, 32000, 48000, 66000, 86000, 108000];
const MIN_OPACITY = 0.004;

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const VERT = (prelude: string, define: string) => `#version 300 es
precision highp float;
${prelude}
${define}
in vec2 a_merc;
in vec2 a_ll;
uniform float u_elev;
out vec2 v_ll;
void main() {
  v_ll = a_ll;
  gl_Position = projectTileFor3D(a_merc, u_elev);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_ll;
out vec4 o_color;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_mix;
uniform float u_opacity;
uniform float u_layer;   // 0 lowest shell .. 1 highest
uniform float u_shell;   // index, offsets the noise per shell
uniform vec3 u_sun;      // weather frame: x to (0E,0N), y to 90E, z north
uniform vec3 u_dusk;
uniform vec3 u_day;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.55;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s / 0.99;
}

void main() {
  float cl = cos(v_ll.y);
  vec3 d = vec3(cl * cos(v_ll.x), cl * sin(v_ll.x), sin(v_ll.y));
  vec2 uv = vec2(v_ll.x / 6.2831853 + 0.5, v_ll.y / 3.14159265 + 0.5);
  vec4 s = mix(texture(u_a, uv), texture(u_b, uv), u_mix);
  float cover = s.r;
  float precip = s.g;
  float temp = s.b * 80.0 - 40.0;
  if (cover < 0.04) discard;

  float n = fbm(d * 16.0 + vec3(0.0, 0.0, u_shell * 3.7));
  float v = cover + (n - 0.5) * 1.1 - u_layer * 0.14;
  float a = smoothstep(0.5, 0.74, v) * smoothstep(1.48, 1.36, abs(v_ll.y));
  if (a < 0.01) discard;

  float lit = smoothstep(-0.12, 0.3, dot(d, u_sun));
  vec3 col = mix(u_dusk * 1.25, u_day, lit);
  float wet = smoothstep(0.02, 0.45, precip);
  col = mix(col, col * vec3(0.74, 0.77, 0.82), wet);
  if (temp < 0.5) col = mix(col, vec3(0.80, 0.90, 1.0) * mix(0.55, 1.0, lit), wet);
  col *= mix(0.80, 1.0, u_layer) * (0.9 + 0.2 * n);

  float alpha = a * 0.5 * u_opacity;
  o_color = vec4(col * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`cloud shader: ${log}`);
  }
  return sh;
}

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  aMerc: number;
  aLl: number;
}

const UNIFORMS = [
  "u_projection_matrix",
  "u_projection_tile_mercator_coords",
  "u_projection_clipping_plane",
  "u_projection_transition",
  "u_projection_fallback_matrix",
  "u_elev",
  "u_a",
  "u_b",
  "u_mix",
  "u_opacity",
  "u_layer",
  "u_shell",
  "u_sun",
  "u_dusk",
  "u_day",
];

export interface CloudOptions {
  clock: ReadonlySignal<number>; // game minutes
  site: ReadonlySignal<{ seed: number; phase: number } | null>;
}

// Adds the layer on top of the style; returns a function that removes it.
export function attachCloudLayer(map: maplibregl.Map, opts: CloudOptions): () => void {
  let glr: WebGL2RenderingContext | null = null;
  let program: Program | null = null;
  let vbo: WebGLBuffer | null = null;
  let ibo: WebGLBuffer | null = null;
  let indexCount = 0;
  let texA: WebGLTexture | null = null;
  let texB: WebGLTexture | null = null;
  let builtK = NaN;
  let builtKey = "";
  let job: { data: Uint8Array; t: number; seed: number; phase: number; j: number } | null = null; // the next texture, in slices
  const dusk = hex(PALETTE.dusk);
  const day: [number, number, number] = [0.97, 0.97, 0.985];

  const upload = (tex: WebGLTexture, data: Uint8Array) => {
    const gl = glr!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TEX_W, TEX_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  };

  const makeTex = (): WebGLTexture => {
    const gl = glr!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };

  // Keeps texA at interval k and texB at k + 1, reusing the old B as the new A when time moved on by one step.
  const ensureTextures = (k: number, seed: number, phase: number) => {
    const key = `${seed}:${phase}`;
    const t0 = k * REBUILD_MIN;
    if (key !== builtKey || k < builtK || k > builtK + 1 || Number.isNaN(builtK)) {
      upload(texA!, buildCloudData(t0, seed, phase));
      upload(texB!, buildCloudData(t0 + REBUILD_MIN, seed, phase));
      job = null;
    } else if (k === builtK + 1) {
      // B becomes A; the new B is filled over the next frames (its weight is still near 0 right after the swap).
      [texA, texB] = [texB, texA];
      job = { data: new Uint8Array(TEX_W * TEX_H * 4), t: t0 + REBUILD_MIN, seed, phase, j: 0 };
    } else return;
    builtK = k;
    builtKey = key;
  };

  const stepJob = () => {
    const gl = glr!;
    const jb = job!;
    const j1 = Math.min(TEX_H, jb.j + ROWS_PER_FRAME);
    buildCloudRows(jb.data, jb.t, jb.seed, jb.phase, jb.j, j1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, jb.j, TEX_W, j1 - jb.j, gl.RGBA, gl.UNSIGNED_BYTE, jb.data.subarray(jb.j * TEX_W * 4, j1 * TEX_W * 4));
    jb.j = j1;
    if (j1 >= TEX_H) job = null;
    else map.triggerRepaint();
  };

  const layer: maplibregl.CustomLayerInterface = {
    id: LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      glr = gl as WebGL2RenderingContext;
      builtK = NaN;
      builtKey = "";
    },
    onRemove() {
      const gl = glr;
      if (gl) {
        if (program) gl.deleteProgram(program.prog);
        gl.deleteBuffer(vbo);
        gl.deleteBuffer(ibo);
        gl.deleteTexture(texA);
        gl.deleteTexture(texB);
      }
      program = null;
      vbo = ibo = texA = texB = null;
      glr = null;
    },
    render(_gl, args) {
      const gl = glr;
      if (!gl || !cloudsOn.peek()) return;
      const site = opts.site.peek();
      const opacity = cloudOpacity(map.getZoom());
      if (!site || opacity < MIN_OPACITY) return;

      if (!program || program.prog === null || !vbo) {
        const sd = args.shaderData;
        const prog = gl.createProgram()!;
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT(sd.vertexShaderPrelude, sd.define)));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`cloud program: ${gl.getProgramInfoLog(prog)}`);
        const u: Program["u"] = {};
        for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name);
        program = { prog, u, aMerc: gl.getAttribLocation(prog, "a_merc"), aLl: gl.getAttribLocation(prog, "a_ll") };
        const mesh = buildShellMesh();
        vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
        ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
        indexCount = mesh.indices.length;
        texA = makeTex();
        texB = makeTex();
        builtK = NaN;
      }
      const p = program;

      const t = opts.clock.peek();
      const { k, f } = interval(t);
      ensureTextures(k, site.seed, site.phase);
      if (job) stepJob();

      // WebGL2 vertex arrays are not part of MapLibre's state we can rely on: bind and unbind our own attributes.
      gl.useProgram(p.prog);
      const pd = args.defaultProjectionData;
      gl.uniformMatrix4fv(p.u.u_projection_matrix, false, pd.mainMatrix as unknown as Float32Array);
      gl.uniform4fv(p.u.u_projection_tile_mercator_coords, pd.tileMercatorCoords);
      gl.uniform4fv(p.u.u_projection_clipping_plane, pd.clippingPlane);
      gl.uniform1f(p.u.u_projection_transition, pd.projectionTransition);
      gl.uniformMatrix4fv(p.u.u_projection_fallback_matrix, false, pd.fallbackMatrix as unknown as Float32Array);
      gl.uniform1f(p.u.u_mix, f);
      gl.uniform1f(p.u.u_opacity, opacity);
      gl.uniform3fv(p.u.u_sun, sunDirection(t, site.phase));
      gl.uniform3fv(p.u.u_dusk, dusk);
      gl.uniform3fv(p.u.u_day, day);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texA);
      gl.uniform1i(p.u.u_a, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texB);
      gl.uniform1i(p.u.u_b, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.enableVertexAttribArray(p.aMerc);
      gl.vertexAttribPointer(p.aMerc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(p.aLl);
      gl.vertexAttribPointer(p.aLl, 2, gl.FLOAT, false, 16, 8);

      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.frontFace(gl.CCW);
      SHELLS.forEach((h, i) => {
        gl.uniform1f(p.u.u_elev, h);
        gl.uniform1f(p.u.u_layer, i / (SHELLS.length - 1));
        gl.uniform1f(p.u.u_shell, i + (site.seed % 97));
        gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0);
      });
      gl.disable(gl.CULL_FACE);
      gl.depthMask(true);
      gl.disableVertexAttribArray(p.aMerc);
      gl.disableVertexAttribArray(p.aLl);
      gl.activeTexture(gl.TEXTURE0);
    },
  };

  let ready = false;
  let stop: (() => void) | null = null;
  const setup = () => {
    map.addLayer(layer);
    ready = true;
    stop = effect(() => {
      void opts.clock.value;
      void opts.site.value;
      void cloudsOn.value;
      map.triggerRepaint();
    });
  };
  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
  return () => {
    stop?.();
    if (ready && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  };
}
