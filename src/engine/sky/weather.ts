import type { Vec3 } from "../geo/ellipsoid";
import { registerWgsl } from "../gpu/wgsl";
import { NOISE_TILE_M, OVERCAST_MAX, SHADOW_MAX, SUN_FULL_DEG, SUN_OFF_DEG } from "../../map/clouds/shadowMath";
import { EARTH_RADIUS_M } from "../../map/three/frame";
import { BASE_SIZE, DETAIL_SIZE } from "../../map/clouds/noise3d";
import { PALETTE } from "../../ui/palette";
import weatherWgsl from "./weather.wgsl?raw";

// The weather the shading model reads (weather.wgsl): the cube pair and the noise volumes of the clouds as GPU
// textures, and one uniform of drift, shadow and ground parameters. Bound in group 0 with the frame uniform
// (frame/frameUniforms.ts); the game fills it (view/engine/weather.ts).

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);
const vec3 = (hex: string) => `vec3f(${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4)).join(", ")})`;
registerWgsl(
  "weather",
  Object.entries({
    EARTH_R: f(EARTH_RADIUS_M),
    NOISE_TILE: f(NOISE_TILE_M),
    SHADOW_MAX: f(SHADOW_MAX),
    OVERCAST_MAX: f(OVERCAST_MAX),
    SUN_OFF: f(sinDeg(SUN_OFF_DEG)),
    SUN_FULL: f(sinDeg(SUN_FULL_DEG)),
    SHADOW_DUSK: vec3(PALETTE.dusk),
  }).reduce((code, [k, v]) => code.replaceAll(`\${${k}}`, v), weatherWgsl),
);

export const WEATHER_FLOATS = 11 * 4;

export interface WeatherLook {
  weights: [number, number]; // the two drifting noise layers (map/clouds/shadowMath.ts driftPhases)
  ages: [number, number]; // game days
  offsets: [Vec3, Vec3];
  mix: number; // share of cube B
  shadows: boolean; // clouds on and cube A loaded
  wind: [westerlies: number, trades: number, period: number]; // degrees per game day, days
  days: number; // game days
  castHeight: number; // m
  shadowDrift: number; // degrees per game day
  snow: number; // 0..1
  wet: number; // 0..1
  ice: number; // 0..1
  town: { eye: Vec3; reach: number; east: Vec3; north: Vec3 } | null; // eye - town origin (f64), reach (m)
  groundFade: number; // 0 on the globe views .. 1 near the ground
  snowColour: Vec3; // sRGB
  iceColour: Vec3;
}

export const calmWeather = (): WeatherLook => ({
  weights: [1, 0],
  ages: [0, 0],
  offsets: [
    [0, 0, 0],
    [0, 0, 0],
  ],
  mix: 0,
  shadows: false,
  wind: [0, 0, 1],
  days: 0,
  castHeight: 0,
  shadowDrift: 0,
  snow: 0,
  wet: 0,
  ice: 0,
  town: null,
  groundFade: 0,
  snowColour: [1, 1, 1],
  iceColour: [1, 1, 1],
});

export class WeatherGpu {
  readonly buffer: GPUBuffer;
  readonly sampler: GPUSampler;
  readonly base: GPUTexture;
  readonly detail: GPUTexture;
  private cubes: [GPUTexture, GPUTexture];
  private views: [GPUTextureView, GPUTextureView];
  generation = 0; // bumped whenever a texture the bind group holds is replaced
  version = 0; // bumped on every upload or swap: a picture cached from the textures is stale
  noiseReady = false;
  private data = new Float32Array(WEATHER_FLOATS);

  constructor(private readonly device: GPUDevice) {
    this.buffer = device.createBuffer({ label: "weather", size: WEATHER_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = device.createSampler({ label: "weather", magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
    const volume = (n: number, label: string) =>
      device.createTexture({ label, size: [n, n, n], dimension: "3d", format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    this.base = volume(BASE_SIZE, "cloud base noise");
    this.detail = volume(DETAIL_SIZE, "cloud detail noise");
    this.cubes = [this.cube(1), this.cube(1)];
    this.views = [this.cubeView(this.cubes[0]), this.cubeView(this.cubes[1])];
    this.write(calmWeather());
  }

  get cubeSize(): number {
    return this.cubes[0].width;
  }

  // Cube A (the current interval) and cube B (the next one).
  get cubeViews(): readonly [GPUTextureView, GPUTextureView] {
    return this.views;
  }

  // Both cubes at a new face size (their contents are dropped).
  resizeCubes(size: number): void {
    if (size === this.cubeSize) return;
    for (const c of this.cubes) c.destroy();
    this.cubes = [this.cube(size), this.cube(size)];
    this.views = [this.cubeView(this.cubes[0]), this.cubeView(this.cubes[1])];
    this.generation++;
    this.version++;
  }

  // Six RGBA8 faces (map/clouds/weatherCube.ts buildCubeFace, GL face order) into cube 0 (A) or 1 (B).
  writeCube(which: 0 | 1, faces: readonly ArrayBuffer[]): void {
    const n = this.cubeSize;
    faces.forEach((buf, face) =>
      this.device.queue.writeTexture({ texture: this.cubes[which], origin: [0, 0, face] }, buf, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, 1]),
    );
    this.version++;
  }

  // Time moved on by one interval: B becomes A.
  swapCubes(): void {
    this.cubes = [this.cubes[1], this.cubes[0]];
    this.views = [this.views[1], this.views[0]];
    this.generation++;
    this.version++;
  }

  writeNoise(base: ArrayBuffer, detail: ArrayBuffer): void {
    const put = (t: GPUTexture, buf: ArrayBuffer, n: number) => this.device.queue.writeTexture({ texture: t }, buf, { bytesPerRow: n * 4, rowsPerImage: n }, [n, n, n]);
    put(this.base, base, BASE_SIZE);
    put(this.detail, detail, DETAIL_SIZE);
    this.noiseReady = true;
    this.version++;
  }

  write(l: WeatherLook): void {
    const d = this.data;
    const t = l.town;
    d.set([l.weights[0], l.weights[1], l.ages[0], l.ages[1]], 0);
    d.set([...l.offsets[0], l.mix], 4);
    d.set([...l.offsets[1], l.shadows ? 1 : 0], 8);
    d.set([...l.wind, l.days], 12);
    d.set([l.castHeight, l.shadowDrift, 0, 0], 16);
    d.set([l.snow, l.wet, l.ice, 0], 20);
    d.set(t ? [...t.eye, t.reach] : [0, 0, 0, 0], 24);
    d.set(t ? [...t.east, l.groundFade] : [1, 0, 0, 0], 28);
    d.set(t ? [...t.north, 0] : [0, 1, 0, 0], 32);
    d.set([...l.snowColour, 1], 36);
    d.set([...l.iceColour, 1], 40);
    this.device.queue.writeBuffer(this.buffer, 0, d);
  }

  private cube(size: number): GPUTexture {
    return this.device.createTexture({ label: "weather cube", size: [size, size, 6], format: "rgba8unorm", usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  }

  private cubeView(t: GPUTexture): GPUTextureView {
    return t.createView({ dimension: "cube" });
  }
}
