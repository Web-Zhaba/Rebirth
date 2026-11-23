// The other per-frame CPU work of the renderer: camera view maths, the shadow cascade fit, the forest's tile choice,
// and the line-of-sight rays the label and marker layers cast (engine.behindTerrain -> camera/pick.pickGround).
//
// The ground under the ray is read through a synthetic height page + lngLatToTile + a Map lookup, i.e. the shape of
// HeightPages.heightAt (terrain/heightPages.ts:179) with its GPU-backed pool stood in for by one page.
import { buildView, cameraAxes, defaultCamera, liftEyeAboveGround, type CameraState } from "../../../src/engine/camera/camera";
import { pickGround } from "../../../src/engine/camera/pick";
import { frustumPlanes } from "../../../src/engine/camera/frustum";
import { ecefToGeodetic, geodeticToEcef } from "../../../src/engine/geo/ellipsoid";
import { lngLatToTile, tileKey } from "../../../src/engine/geo/mercator";
import { samplePage } from "../../../src/engine/bake/terrarium";
import { cascadeSplits, shadowFrame, shadowMatrix, sliceSphere, steadyRadius, ShadowCache } from "../../../src/engine/shadow/shadowMath";
import { SCATTER_ZOOM, steadyReach, strideLevel, thinReach, tileFrame } from "../../../src/engine/scene/forestTiles";
import { describe, expect, it } from "vitest";
import { measure, measureSlow, table } from "./util";

// One height page (258x258 f32) and the tile lookup in front of it: HeightPages.heightAt minus its pool.
const page = new Float32Array(258 * 258);
for (let i = 0; i < page.length; i++) page[i] = 600 + 120 * Math.sin(i / 2400) + 40 * Math.cos(i / 90);
const tiles = new Map<number, Float32Array>();
for (let x = 17_398; x <= 17_402; x++) for (let y = 11_398; y <= 11_402; y++) tiles.set(tileKey(15, x, y), page);

function groundAt(lat: number, lng: number): number | null {
  const t = lngLatToTile(lng, lat, 15);
  const p = tiles.get(tileKey(15, Math.floor(t.x), Math.floor(t.y)));
  if (!p) return null;
  return samplePage(p, t.x % 1, t.y % 1);
}

const stateAt = (distance: number, pitch: number, h = 600): CameraState => Object.assign(defaultCamera(), { lat: 47.27, lng: 11.4, h, distance, pitch, heading: 0 });

describe("camera per frame", () => {
  it("buildView, liftEyeAboveGround and the frustum planes", () => {
    const s = stateAt(4000, 55);
    measure("buildView (engine.ts:228, every frame)", () => void buildView(s, 1600, 900, groundAt), { reps: 2000 });
    measure("cameraAxes", () => void cameraAxes(s), { reps: 20_000 });
    measure("ecefToGeodetic", () => ecefToGeodetic([4.2e6, 1.1e6, 4.6e6]), { reps: 200_000 });
    measure("geodeticToEcef", () => geodeticToEcef(47.27, 11.4, 600), { reps: 200_000 });
    measure("groundAt (page lookup + bilinear sample)", () => groundAt(47.2702, 11.4003), { reps: 200_000 });
    // A pitched eye over a rising slope: the bisection runs its full 12 steps (camera.ts:76-91), each with a ground query.
    const steep = stateAt(400, 70, 600);
    let steps = 0;
    measure(
      "liftEyeAboveGround, 12 bisections (worst case)",
      () => {
        steep.pitch = 70;
        liftEyeAboveGround(steep, (lat, lng) => (steps++, (groundAt(lat, lng) ?? 0) + 300));
      },
      { reps: 200, note: "" },
    );
    const v = buildView(s, 1600, 900, groundAt);
    measure("frustumPlanes (scene/forest.ts:291, every frame the forest is on)", () => void frustumPlanes(v), { reps: 20_000 });
    table("camera per frame", "code: engine.ts:226-234 (clampState, liftEyeAboveGround, buildView, overlay.update).");
    expect(v.viewProj.length).toBe(16);
    expect(steps).toBeGreaterThan(0);
  });
});

describe("shadow cascades per frame", () => {
  it("fits and keys the cascades", () => {
    const s = stateAt(4000, 45);
    const v = buildView(s, 1600, 900, groundAt);
    const sun = geodeticToEcef(0, 0, 1);
    const unit: [number, number, number] = [0.35, 0.55, 0.76];
    const splits = cascadeSplits(120, 5000, 4);
    const centre = ecefToGeodetic(v.target);
    const c: [number, number, number] = geodeticToEcef(centre.lat, centre.lng, 600);
    measure("cascadeSplits (4)", () => void cascadeSplits(120, 5000, 4), { reps: 20_000 });
    measure("sliceSphere", () => void sliceSphere(splits[0], splits[1], 1.1, 0.33), { reps: 20_000 });
    measure("steadyRadius", () => void steadyRadius(900, 1050), { reps: 200_000 });
    measure("shadowFrame (one cascade)", () => void shadowFrame(unit, c, 900, 2048), { reps: 20_000 });
    const f = shadowFrame(unit, c, 900, 2048);
    const out = new Float64Array(16);
    measure("shadowMatrix (one cascade)", () => void shadowMatrix(f, v.eye, out), { reps: 20_000 });
    // ShadowMap.update builds `inputs` as a fresh array per cascade per frame and compares it element by element.
    const cache = new ShadowCache();
    const inputs = () => [f.origin[0], f.origin[1], f.origin[2], unit[0], unit[1], unit[2], f.radius, 2048, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    cache.store(inputs());
    measure("ShadowCache.matches (per cascade per frame)", () => void cache.matches(inputs()), { reps: 200_000 });
    measure("4 cascades: frame + matrix + key (shadowMap.ts:117-146)", () => {
      for (let i = 0; i < 4; i++) {
        const fr = shadowFrame(unit, c, 900 + i * 100, 2048);
        shadowMatrix(fr, v.eye, out);
        cache.matches(inputs());
      }
    }, { reps: 2000 });
    table("shadow cascades", "code: shadowMap.ts:117 update() per cascade; maps 2048^2 x 4 (SHADOW_SETUP.high, shadowMap.ts:20).");
    expect(sun.length).toBe(3);
  });
});

describe("the forest's tile choice per frame (scene/forest.ts prepare)", () => {
  it("walks the tiles around the eye and thins them", () => {
    const frame = tileFrame(17_400, 11_400);
    measure("tileFrame (a tile never seen)", () => void tileFrame(17_401, 11_401), { reps: 2000, note: `zoom ${SCATTER_ZOOM}` });
    expect(frame.width).toBeGreaterThan(0);
    // The tile loop: span = maxFar / tileWidth + 1 tiles each way (forest.ts:288-300), ~40 x 40 = 1600 tiles at a
    // ground-level view; each does a frustum test and two page lookups.
    measure("tile loop over 41 x 41 tiles (frustum + page lookups)", () => {
      const planes = frustumPlanes(buildView(stateAt(4000, 55), 1600, 900, groundAt));
      let n = 0;
      for (let y = 0; y < 41; y++)
        for (let x = 0; x < 41; x++) {
          const t = frame;
          const c: [number, number, number] = [t.centre[0] - 4e6, t.centre[1] - 1e6, t.centre[2] - 4.4e6];
          const d = Math.hypot(c[0], c[1], c[2]);
          if (d > 12_000) continue;
          for (const p of planes) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] < 0) {
            n++;
            break;
          }
        }
      if (n < 0) throw new Error("unreachable");
    }, { reps: 200 });
    const tilesOfN = Array.from({ length: 1600 }, (_, i) => ({ n: 200 + (i % 40) * 25, d: 100 + i * 8 }));
    measure("thinReach (30 bisections over 1600 tiles)", () => void thinReach(tilesOfN, 120_000, 700), { reps: 200 });
    measure("steadyReach", () => void steadyReach(3000, 3200), { reps: 200_000 });
    measure("strideLevel", () => void strideLevel(4200, 3000), { reps: 200_000 });
    table("forest CPU per frame", "code: forest.ts:279-410 prepare(); the scatter itself is a compute pass (forest.ts:414).");
  });
});

describe("line-of-sight rays (labels, markers)", () => {
  it("prices pickGround from street level and from orbit", () => {
    const near = buildView(stateAt(600, 50), 1600, 900, groundAt).eye;
    const far = buildView(stateAt(3_000_000, 0), 1600, 900, groundAt).eye;
    const dirAt = (v: ReturnType<typeof buildView>, nx: number, ny: number): [number, number, number] => {
      const x = nx * v.tanHalfY * v.aspect;
      const y = ny * v.tanHalfY;
      const r: [number, number, number] = [v.forward[0] + v.right[0] * x + v.up[0] * y, v.forward[1] + v.right[1] * x + v.up[1] * y, v.forward[2] + v.right[2] * x + v.up[2] * y];
      const l = Math.hypot(r[0], r[1], r[2]);
      return [r[0] / l, r[1] / l, r[2] / l];
    };
    const nearView = buildView(stateAt(600, 50), 1600, 900, groundAt);
    const orbitView = buildView(stateAt(3_000_000, 0), 1600, 900, groundAt);
    const down = dirAt(nearView, 0, 0);
    const grazing = dirAt(nearView, 0.9, 0.2);
    const planet = dirAt(orbitView, 0, 0);

    let calls = 0;
    const counting = (lat: number, lng: number) => (calls++, groundAt(lat, lng));
    const countCalls = (eye: typeof near, dir: [number, number, number]): number => {
      calls = 0;
      pickGround(eye, dir, counting);
      return calls;
    };
    const hit = pickGround(near, down, groundAt);
    measure("pickGround, street level, centre of the screen", () => void pickGround(near, down, groundAt), { reps: 500, note: "" });
    measure("pickGround, street level, grazing ray", () => void pickGround(near, grazing, groundAt), { reps: 20 });
    measure("pickGround, from orbit", () => void pickGround(far, planet, groundAt), { reps: 100 });
    // labelSight (view/engine/labelSight.ts:11) allows RAYS_PER_FRAME = 48 rays a frame.
    measure("48 rays a frame (labelSight budget, worst case)", () => {
      for (let i = 0; i < 48; i++) pickGround(near, i % 2 ? down : grazing, groundAt);
    }, { reps: 20 });
    console.log(`   ground queries per ray: centre ${countCalls(near, down)}, grazing ${countCalls(near, grazing)}, orbit ${countCalls(far, planet)}`);
    table(
      "line-of-sight rays",
      "code: engine.ts:161 behindTerrain -> camera/pick.ts:13 pickGround (MAX_STEPS 4000); labelSight.ts:11 48 rays a frame; markers place() per marker per frame (view/engine/view.ts:48-58).",
    );
    expect(hit).not.toBeNull();
  });
});
