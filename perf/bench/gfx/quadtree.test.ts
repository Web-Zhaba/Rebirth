// Terrain quadtree selection + node vertex building: the biggest per-frame CPU loop of the renderer
// (src/engine/terrain/quadtree.ts selectNodes, terrain.ts update, terrain/nodeMesh.ts buildNodeVertices).
//
// The heights come from a fake HeightRanges (quadtree.ts:31): the real one reads HeightPages (GPU-backed), so the walk
// is measured with a deterministic range that changes zoom like a streaming page would.
import { buildView, defaultCamera, type CameraState } from "../../../src/engine/camera/camera";
import { ecefToGeodetic } from "../../../src/engine/geo/ellipsoid";
import { buildNodeVertices, NODE_FLOATS, nodeOrigin } from "../../../src/engine/terrain/nodeMesh";
import { MAX_ZOOM, NodeCache, selectNodes, type HeightRanges, type SelectView, type Selection } from "../../../src/engine/terrain/quadtree";
import { describe, expect, it } from "vitest";
import { measure, measureSlow, table } from "./util";

const TAU = 8; // quadtree.ts DEFAULT_TAU
const MAX_NODES = 1020; // terrain.ts: min(MAX_NODES 4096, SLOTS 1024) - 4

// A DEM that is fully resident: a range per tile, zoom-tracked, and a version that bumps as pages arrive.
function fakeHeights(): { h: HeightRanges; bump: () => void } {
  let v = 1;
  return {
    h: {
      range: (z, x, y) => ({ min: 200 + ((x * 7 + y * 13) % 60) * 10, max: 1800 + ((x * 3 + y * 5) % 40) * 10, z: Math.min(z, 11) }),
      source: (z, x, y) => (Math.min(z, 11) << 26) ^ (x << 13) ^ y,
      version: () => v,
    },
    bump: () => v++,
  };
}

function selView(distance: number, pitch: number, heading = 0, h = 700): SelectView {
  const s: CameraState = defaultCamera();
  Object.assign(s, { lat: 47.27, lng: 11.4, h, distance, pitch, heading });
  const v = buildView(s, 1600, 900, () => h);
  const g = ecefToGeodetic(v.eye);
  return {
    eye: v.eye,
    eyeLat: g.lat,
    eyeLng: g.lng,
    eyeAlt: g.h,
    right: v.right,
    up: v.up,
    forward: v.forward,
    near: v.near,
    tanHalfY: v.tanHalfY,
    aspect: v.aspect,
    viewportH: v.viewportH,
  };
}

const OPTS = { tau: TAU, maxZoom: MAX_ZOOM, maxNodes: MAX_NODES };

describe("selectNodes: the per-frame quadtree walk", () => {
  it("measures a cold cache, a steady view and a streaming one", () => {
    const charts: [string, SelectView, () => void, number][] = [
      ["street level, distance 600 m, pitch 50", selView(600, 50), () => {}, 0],
      ["town, distance 4 km, pitch 55", selView(4000, 55), () => {}, 0],
      ["region, distance 120 km, pitch 60", selView(120_000, 60), () => {}, 0],
      ["orbit, distance 3000 km, pitch 0", selView(3_000_000, 0), () => {}, 0],
    ];

    let sel: Selection | null = null;
    for (const [name, v] of charts) {
      const { h } = fakeHeights();
      // Cold: a new NodeCache every call, i.e. what a camera jump to a fresh place costs (makeNode per new node).
      measureSlow(`cold NodeCache + select · ${name}`, () => void (sel = selectNodes(v, new NodeCache(), h, new Set(), OPTS)), { runs: 5 });
      expect(sel!.nodes.length).toBeGreaterThan(0);

      // Warm: the same cache, frame after frame — the steady state of standing still.
      const cache = new NodeCache();
      cache.frame = 0;
      cache.get(0, 0, 0);
      let frame = 0;
      const warm = selectNodes(v, cache, h, new Set(), OPTS);
      measure(`warm select · ${name} (${warm.nodes.length} nodes, ${warm.visited} visited)`, () => {
        cache.frame = ++frame;
        selectNodes(v, cache, h, new Set(), OPTS);
      }, { reps: 20 });
      expect(warm.visited).toBeGreaterThan(0);
    }
    table(
      "quadtree selection per frame (selectNodes)",
      `code: quadtree.ts:352-372 visit() recursion; terrain.ts:255 uses maxNodes = min(4096, 1024) - 4 = ${MAX_NODES}.`,
    );
  });

  it("measures a moving camera and the shadow casters pass", () => {
    const { h, bump } = fakeHeights();
    const cache = new NodeCache();
    let frame = 0;
    // A slow pan: the view moves 5 m a frame, as a drag at 300 m/s of ground does at 60 fps.
    let lng = 11.4;
    const moving = selView(4000, 55);
    measure(
      "panning view (tile cache reused)",
      () => {
        cache.frame = ++frame;
        lng += 0.00005;
        moving.eyeLng = lng;
        selectNodes(moving, cache, h, new Set(), OPTS);
      },
      { reps: 20 },
    );

    // Pages keep arriving: the version bumps every frame, so refreshBounds runs its source() check per visited node.
    measure(
      "steady view, height pages streaming (version bump each frame)",
      () => {
        cache.frame = ++frame;
        bump();
        selectNodes(moving, cache, h, new Set(), OPTS);
      },
      { reps: 20 },
    );

    // Shadows on: terrain.ts passes casters (an out-of-view selection kept for what casts into the sun's map).
    const casters = { at: { eye: moving.eye, eyeLat: moving.eyeLat, eyeLng: moving.eyeLng, eyeAlt: moving.eyeAlt }, radius: 4000 };
    measure(
      "steady view + shadow casters (radius 4000 m)",
      () => {
        cache.frame = ++frame;
        selectNodes(moving, cache, h, new Set(), { ...OPTS, casters });
      },
      { reps: 20 },
    );

    // terrain.ts:71 sweeps the cache every 120th frame.
    measure(`NodeCache.sweep with ${cache.size} nodes (every 120th frame)`, () => cache.sweep(), { reps: 5 });
    table("quadtree selection: moving camera, streaming pages, casters", "code: terrain.ts:210 sweep every 120 frames; terrain.ts:263-268 casters while shadows are on.");
  });

  it("measures node vertex building (VERTEX_BUILDS_PER_FRAME = 64)", () => {
    const out = new Float32Array(NODE_FLOATS);
    const origin = nodeOrigin(15, 17_400, 11_400, 900);
    measure("buildNodeVertices (z15 tile)", () => buildNodeVertices(15, 17_400, 11_400, origin, out, 0, 900), { reps: 200, note: `${NODE_FLOATS * 4} B per node` });
    measure("nodeOrigin", () => nodeOrigin(15, 17_400, 11_400, 900), { reps: 5000 });
    table(
      "terrain node vertex build",
      "code: terrain.ts:34 VERTEX_BUILDS_PER_FRAME = 64, terrain.ts:496 build() per new node; the comment at terrain.ts:25 claims ~20 us a node.",
    );
    expect(out.some((v) => v !== 0)).toBe(true);
  });
});
