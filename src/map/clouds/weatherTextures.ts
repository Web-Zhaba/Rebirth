import { CubeTexture, Data3DTexture, DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";
import { requestCube, requestNoise, type CubeResult } from "./cloudData";
import { BASE_SIZE, DETAIL_SIZE } from "./noise3d";
import type { CloudSite } from "./settings";
import type { ThreeHost } from "./three";
import { STORM_MAX } from "./weatherCube";

// GPU copies of the weather cube pair and the noise volumes (PLAN-clouds.md section 4), shared by the cloud layer and
// the ground shadows so each cube is built and uploaded once. Cube A holds interval k, cube B interval k + 1; shaders
// mix them by `mix` so fronts glide between rebuilds.

export const REBUILD_MIN = 30; // game minutes between two cubes

// Interval of game minute t and how far through it we are (0..1).
export function interval(t: number): { k: number; f: number } {
  const k = Math.floor(t / REBUILD_MIN);
  return { k, f: t / REBUILD_MIN - k };
}

export interface WeatherTextures {
  cubeA: CubeTexture; // swapped with cubeB when time moves on by one interval
  cubeB: CubeTexture;
  mix: number; // 0 = A, 1 = B; held at 0 while B is not uploaded yet
  base: Data3DTexture | null; // 64³ RGBA8 noise, null until it arrives
  detail: Data3DTexture | null; // 32³ RGBA8 noise
  storms: Float32Array; // STORM_MAX vec4: xyz direction (MapLibre frame), w strength; of the cube nearer in time
  stormCount: number;
  ready: boolean; // cube A uploaded: something can be drawn
  version: number; // bumped on every upload, so a cached render knows it is stale
}

interface Slot {
  k: number; // interval held, NaN when empty
  key: string; // site and size it was built for
  loaded: boolean;
  storms: Float32Array;
  stormCount: number;
}

const emptySlot = (): Slot => ({ k: Number.NaN, key: "", loaded: false, storms: new Float32Array(STORM_MAX * 4), stormCount: 0 });

function makeCube(): CubeTexture {
  const cube = new CubeTexture([]);
  cube.format = RGBAFormat;
  cube.type = UnsignedByteType;
  cube.minFilter = LinearFilter;
  cube.magFilter = LinearFilter;
  cube.generateMipmaps = false;
  cube.flipY = false;
  return cube;
}

function makeVolume(buf: ArrayBuffer, n: number): Data3DTexture {
  const tex = new Data3DTexture(new Uint8Array(buf), n, n, n);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export interface WeatherTextureSource {
  // Call once per frame from any layer; idempotent for the same arguments. Returns null with no site.
  update(t: number, site: CloudSite | null, size: number): WeatherTextures | null;
  // Called when an upload landed (repaint the map there).
  subscribe(cb: () => void): () => void;
  release(): void;
}

const sources = new WeakMap<ThreeHost, { src: WeatherTextureSource; refs: number }>();

export function acquireWeatherTextures(host: ThreeHost): WeatherTextureSource {
  const held = sources.get(host);
  if (held) {
    held.refs++;
    return held.src;
  }
  const { api, destroy, state } = createSource(() => {
    const h = sources.get(host);
    if (h && --h.refs <= 0) {
      sources.delete(host);
      unRestore();
      destroy();
    }
  });
  // After a context restore the textures must be uploaded again.
  const unRestore = host.onRestore(() => {
    for (const tex of [state.cubeA, state.cubeB, state.base, state.detail]) if (tex) tex.needsUpdate = true;
  });
  sources.set(host, { src: api, refs: 1 });
  return api;
}

function createSource(onRelease: () => void) {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of [...listeners]) cb();
  };
  const state: WeatherTextures = {
    cubeA: makeCube(),
    cubeB: makeCube(),
    mix: 0,
    base: null,
    detail: null,
    storms: new Float32Array(STORM_MAX * 4),
    stormCount: 0,
    ready: false,
    version: 0,
  };
  // slots[0] backs cubeA, slots[1] cubeB; a swap exchanges both together.
  let slots: [Slot, Slot] = [emptySlot(), emptySlot()];
  let noiseAsked = false;
  let disposed = false;

  const upload = (cube: CubeTexture, slot: Slot, res: CubeResult, size: number) => {
    cube.images = res.faces.map((buf) => {
      const face = new DataTexture(new Uint8Array(buf), size, size, RGBAFormat, UnsignedByteType);
      face.flipY = false;
      return face;
    });
    cube.needsUpdate = true;
    slot.loaded = true;
    slot.storms = res.storms.cells.length ? Float32Array.from(res.storms.cells) : new Float32Array(0);
    slot.stormCount = slot.storms.length / 4;
    state.version++;
  };

  const fill = (which: 0 | 1, k: number, key: string, site: CloudSite, size: number) => {
    const slot = slots[which];
    slot.k = k;
    slot.key = key;
    slot.loaded = false;
    requestCube(k * REBUILD_MIN, site.seed, site.phase, size).then(
      (res) => {
        // The slot may have been swapped or refilled meanwhile: find the one still waiting for this cube.
        if (disposed) return;
        const i = slots.findIndex((s) => s.k === k && s.key === key && !s.loaded);
        if (i < 0) return;
        upload(i === 0 ? state.cubeA : state.cubeB, slots[i], res, size);
        notify();
      },
      (e: unknown) => console.warn("cloud cube failed", e),
    );
  };

  const update: WeatherTextureSource["update"] = (t, site, size) => {
    if (!site) return null;
    if (!noiseAsked) {
      noiseAsked = true;
      requestNoise().then(
        (n) => {
          if (disposed) return;
          state.base = makeVolume(n.base, BASE_SIZE);
          state.detail = makeVolume(n.detail, DETAIL_SIZE);
          state.version++;
          notify();
        },
        (e: unknown) => {
          noiseAsked = false;
          console.warn("cloud noise failed", e);
        },
      );
    }
    const { k, f } = interval(t);
    const key = `${site.seed}:${site.phase}:${size}`;
    const [a, b] = slots;
    if (a.key === key && b.key === key && a.k === k - 1 && b.k === k) {
      // Time moved on by one interval: B becomes A, the old A is refilled as the new B.
      slots = [b, a];
      [state.cubeA, state.cubeB] = [state.cubeB, state.cubeA];
      fill(1, k + 1, key, site, size);
      state.version++;
    } else {
      if (a.key !== key || a.k !== k) fill(0, k, key, site, size);
      if (slots[1].key !== key || slots[1].k !== k + 1) fill(1, k + 1, key, site, size);
    }
    const [sa, sb] = slots;
    state.ready = sa.loaded;
    state.mix = sb.loaded ? f : 0;
    const near = state.mix >= 0.5 ? sb : sa;
    state.storms = near.storms;
    state.stormCount = near.stormCount;
    return state;
  };

  const api: WeatherTextureSource = {
    update,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    release: onRelease,
  };
  const destroy = () => {
    disposed = true;
    listeners.clear();
    for (const tex of [state.cubeA, state.cubeB, state.base, state.detail]) tex?.dispose();
  };
  return { api, destroy, state };
}
