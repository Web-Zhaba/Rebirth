import type maplibregl from "maplibre-gl";
import { ColorManagement, HalfFloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat, UnsignedByteType, WebGLRenderTarget, WebGLRenderer } from "three";
import { invert4 } from "./frame";

// The shared three.js host: one WebGLRenderer living on MapLibre's own canvas and GL context, for custom layers that
// want three's scene graph and materials (clouds, ground shadows, restored buildings). Import this file only with a
// dynamic `import()`, so three.js stays out of the main chunk.
//
// Contract (proved by the step-0 spike of PLAN-clouds.md):
// - Colours: MapLibre writes palette hex values to its 8-bit canvas untouched (no sRGB conversion). To get the same
//   pixels from three, colour management is off and the output colour space is linear, so `new Color("#rrggbb")` and
//   raw ShaderMaterial output reach the canvas unchanged.
// - Blending: MapLibre custom layers composite with ONE / ONE_MINUS_SRC_ALPHA (premultiplied). `draw` leaves three's
//   own state cache and the GL state reset to GL defaults, so every material sets its blending explicitly (use
//   CustomBlending with OneFactor / OneMinusSrcAlphaFactor, depthTest false, depthWrite false for 2d layers).
// - Nothing needs restoring for MapLibre: it calls `context.setDirty()` and re-applies its base state after each
//   custom layer; `draw` additionally restores the framebuffer binding and viewport it found.

ColorManagement.enabled = false;

// A pair of matrices for one frame, from `args.defaultProjectionData`.
export interface Frame {
  // Globe mode: unit sphere (MapLibre frame, see frame.ts) -> clip. Mercator mode: mercator x, y in 0..1 and z in
  // the same mercator units (metres / metresPerMercator(lat)) -> clip. Float64.
  main: Float64Array;
  // inverse(main), Float64; null if singular.
  inv: Float64Array | null;
  // The same two in Float32, ready for uniforms.
  main32: Float32Array;
  inv32: Float32Array;
  // 0 = mercator, 1 = globe; between them while MapLibre blends the two projections.
  transition: number;
  // Mercator-mode matrix of the same view (what the transition blends towards).
  fallback: Float64Array;
}

export interface ThreeHost {
  readonly renderer: WebGLRenderer;
  readonly gl: WebGL2RenderingContext;
  // True when RGBA16F render targets can be rendered to.
  readonly floatTargets: boolean;
  // Bumped on every context restore; raw GL resources made earlier are gone.
  readonly generation: number;
  // Matrices of this frame; cached, so prerender and render of one frame share the work.
  frame(pd: maplibregl.CustomRenderMethodInput["defaultProjectionData"]): Frame;
  // Runs fn with clean three state on MapLibre's framebuffer, restoring binding and viewport afterwards. Returns
  // undefined when the context is lost.
  draw<T>(fn: (renderer: WebGLRenderer) => T): T | undefined;
  // A render target: RGBA16F when available, else RGBA8. Linear filtering, no depth, no mipmaps.
  makeTarget(width: number, height: number): WebGLRenderTarget;
  // Called after a lost context came back; create raw GL resources and render targets again here.
  onRestore(cb: () => void): () => void;
  // Drop one reference; the renderer is disposed with the last one.
  release(): void;
}

const hosts = new WeakMap<object, { host: ThreeHost; refs: number }>();

export function acquireHost(map: maplibregl.Map, gl: WebGL2RenderingContext): ThreeHost {
  const held = hosts.get(map);
  if (held) {
    held.refs++;
    return held.host;
  }
  const made = createHost(gl, () => {
    const h = hosts.get(map);
    if (h && --h.refs <= 0) {
      hosts.delete(map);
      made.destroy();
    }
  });
  hosts.set(map, { host: made.api, refs: 1 });
  return made.api;
}

function createHost(gl: WebGL2RenderingContext, onRelease: () => void): { api: ThreeHost; destroy: () => void } {
  const canvas = gl.canvas as HTMLCanvasElement;
  const renderer = new WebGLRenderer({ canvas, context: gl, antialias: false, alpha: true, premultipliedAlpha: true });
  renderer.autoClear = false;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(1); // sizes below are drawing-buffer pixels; never call setSize (it would reset MapLibre's canvas)
  const floatTargets = renderer.extensions.has("EXT_color_buffer_float");

  let generation = 0;
  let lost = gl.isContextLost();
  const restoreCbs = new Set<() => void>();
  const onLost = () => {
    lost = true;
  };
  const onRestored = () => {
    // three has already re-initialised itself (its listener was registered first); tell the layers.
    lost = false;
    generation++;
    for (const cb of [...restoreCbs]) cb();
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const f64 = (m: ArrayLike<number>) => Float64Array.from(m as ArrayLike<number>);
  let cached: Frame | null = null;
  const frame: ThreeHost["frame"] = (pd) => {
    const m = pd.mainMatrix as ArrayLike<number>;
    if (cached) {
      let same = cached.transition === pd.projectionTransition;
      for (let i = 0; same && i < 16; i++) if (cached.main[i] !== m[i]) same = false;
      if (same) return cached;
    }
    const main = f64(m);
    const inv = invert4(main);
    cached = {
      main,
      inv,
      main32: Float32Array.from(main),
      inv32: inv ? Float32Array.from(inv) : new Float32Array(16),
      transition: pd.projectionTransition,
      fallback: f64(pd.fallbackMatrix as ArrayLike<number>),
    };
    return cached;
  };

  const draw: ThreeHost["draw"] = (fn) => {
    if (lost || gl.isContextLost()) return undefined;
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const vp = gl.getParameter(gl.VIEWPORT) as Int32Array;
    renderer.resetState();
    renderer.setScissorTest(false);
    renderer.setViewport(vp[0], vp[1], vp[2], vp[3]);
    try {
      return fn(renderer);
    } finally {
      renderer.setRenderTarget(null);
      renderer.resetState();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(vp[0], vp[1], vp[2], vp[3]);
    }
  };

  const makeTarget = (width: number, height: number) =>
    new WebGLRenderTarget(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)), {
      type: floatTargets ? HalfFloatType : UnsignedByteType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });

  const api: ThreeHost = {
    renderer,
    gl,
    floatTargets,
    get generation() {
      return generation;
    },
    frame,
    draw,
    makeTarget,
    onRestore(cb) {
      restoreCbs.add(cb);
      return () => restoreCbs.delete(cb);
    },
    release: onRelease,
  };
  const destroy = () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
    restoreCbs.clear();
    renderer.dispose();
  };
  return { api, destroy };
}
