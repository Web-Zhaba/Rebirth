// Things the engine and the view layers run EVERY frame even when nothing changed: the frame's own index arrays,
// the forest's job table and its caster hash, the seasonal colour ramp, and the residents' position maths.
// This file also estimates how much of a 16.6 ms frame (60 fps) each one takes.
import { crownAt, reedAt } from "../../../src/map/treeModels";
import { placeAt, standAt, type Rest, type Trip } from "../../../src/map/life";
import { copyJobsKey, emptyJobsKey, hashWords, sameJobsKey } from "../../../src/engine/scene/forest";
import { keepAt, thinReach } from "../../../src/engine/scene/forestTiles";
import { describe, expect, it } from "vitest";
import { measure, rng, table } from "./util";

describe("engine.frame() bookkeeping", () => {
  it("index arrays, casters key, drawable list", () => {
    const beforeListeners = new Set(Array.from({ length: 6 }, () => () => {}));
    const frameListeners = new Set(Array.from({ length: 4 }, () => () => {}));
    const drawables = Array.from({ length: 12 }, () => ({ shadowVersion: 1 })); // terrain, forest, town, dots, fields, smoke, clouds...
    measure("for (const f of [...beforeFrameListeners]) — engine.ts:208", () => void [...beforeListeners], { reps: 100_000, note: `${beforeListeners.size} listeners` });
    measure("for (const f of [...frameListeners]) — engine.ts:290", () => void [...frameListeners], { reps: 100_000 });
    let n = 0;
    measure("casters = [...scalars, ...drawables.map(shadowVersion)] — engine.ts:237", () => void (n = [1, 2, 3, ...drawables.map((d) => d.shadowVersion ?? 0)].length), { reps: 200_000 });
    expect(n).toBe(15);
    table("frame bookkeeping (per frame)", "code: engine.ts:208, 250, 291 — all of it allocation per frame, all of it small.");
  });
});

describe("the forest's per-frame gate (forest.ts update -> noteKey/sameJobsKey vs prepare/noteCasters)", () => {
  // A job table of `jobs` words: what prepare writes and what noteCasters used to hash every frame.
  const jobData = (jobs: number) => {
    const data = new ArrayBuffer(jobs * 36 * 4);
    const u32 = new Uint32Array(data);
    for (let i = 0; i < u32.length; i++) u32[i] = (i * 2654435761) >>> 0;
    return data;
  };
  // The mean tree/bush/reed/boulder share of the cover blocks under one tile (forest.ts blockShares, COVER_BLOCKS = 16).
  // A tile of a page at the same zoom reads all 256 blocks; a coarser page standing in reads (16 / 2^(15 - z))^2 of them.
  const blockShares = (blocks: Float32Array, pageZ: number): number[] => {
    const k = 2 ** (15 - pageZ);
    const B = 16;
    const u = 0; // the tile at the page's own north-west corner: the cheapest call and the dearest one are a factor 64 apart
    const v = 0;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const i1 = Math.max(i0, Math.ceil(u + B / k) - 1);
    const j1 = Math.max(j0, Math.ceil(v + B / k) - 1);
    const out = [0, 0, 0, 0];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (let g = 0; g < 4; g++) out[g] += blocks[(j * B + i) * 4 + g];
    const n = (i1 - i0 + 1) * (j1 - j0 + 1);
    return out.map((s) => s / n);
  };
  const blocks = (() => {
    const b = new Float32Array(16 * 16 * 4);
    const rnd = rng(5);
    for (let i = 0; i < b.length; i++) b[i] = rnd();
    return b;
  })();

  it("prices what a standing camera skips and what it still pays", () => {
    // --- the gate itself: every frame, hit or miss
    const key = emptyJobsKey();
    const probe = emptyJobsKey();
    // Every field noteKey fills, from the same numbers each call: `moved` shifts the last one compared, so a miss pays
    // for the whole comparison (the worst case for the gate).
    const fill = (k: typeof probe, moved: number) => {
      for (let i = 0; i < 3; i++) k.eye[i] = 4300000 + i * 1234.567 + moved;
      for (let i = 0; i < 16; i++) k.viewProj[i] = i * 0.0123 + moved;
      k.tanHalfY = 0.42;
      k.aspect = 1.7;
      k.near = 1;
      k.viewportH = 900;
      k.eyeAboveGround = 620;
      k.growOn = true;
      k.hasLook = true;
      k.occlusion = true;
      k.maskEpoch = 3;
      if (k.maskBox) for (let i = 0; i < 4; i++) k.maskBox[i] = 0.5 + i * 0.1;
      else k.maskBox = [0.5, 0.6, 0.7, 0.8];
      k.heights = 4021;
      k.drapeFetched = 900;
      k.drapePending = 0 + moved;
      k.drapeResident = 210;
    };
    fill(key, 0);
    copyJobsKey(probe, key);
    measure("noteKey + sameJobsKey, camera standing still", () => {
      fill(probe, 0);
      if (!sameJobsKey(probe, key)) throw new Error("the gate would miss");
    }, { reps: 200_000, note: "the hit: prepare and the caster hash are skipped" });
    measure("noteKey + sameJobsKey, camera moved", () => {
      fill(probe, 1);
      if (sameJobsKey(probe, key)) throw new Error("the gate would hit");
    }, { reps: 200_000, note: "a miss: prepare runs, as it did every frame before" });

    // --- what the hit skips: the caster hash of the whole job table (noteCasters)
    for (const jobs of [200, 400, 1000]) {
      const words = new Uint32Array(jobData(jobs), 0, jobs * 36);
      measure(`noteCasters: hashWords, ${jobs} jobs (${jobs * 36} words)`, () => void hashWords(words), { reps: 2000, note: "was every frame, now only when the table is rebuilt" });
    }
    // ... and what is left of it every frame: the job count, the growth and the crowns' bare share.
    const bare = [0.2, 0.2, 0.2, 0, 0, 0];
    measure("noteCasters: the cheap tail (jobCount, grow, 6 kinds' bare)", () => {
      let h = Math.imul(1000 + 1, 31) + Math.round(0.87 * 1000);
      h = Math.imul(h ^ 123456789, 16777619);
      for (let k = 0; k < 6; k++) h = Math.imul(h ^ Math.round(bare[k] * 1000), 16777619);
      if (h === 42) throw new Error("unreachable");
    }, { reps: 200_000, note: "every frame" });

    // --- what the hit skips: blockShares per tile of the walk (gfx.md 2.7 walks 41 x 41 tiles). A tile of a page at the
    // same zoom reads all 256 blocks of the page, a coarser page standing in reads (16 / 2^(15 - z))^2 of them.
    for (const pageZ of [15, 14, 13]) {
      const tiles = 41 * 41;
      const walk = measure(`blockShares, ${tiles} covered tiles over a z${pageZ} page`, () => {
        let sum = 0;
        for (let i = 0; i < tiles; i++) sum += blockShares(blocks, pageZ)[0];
        if (sum < 0) throw new Error("unreachable");
      }, { reps: 50 });
      console.log(`  -> z${pageZ}: ${(walk.median / tiles).toFixed(4)} ms a covered tile`);
    }

    // --- and the thinning: 30 bisections over every tile of the walk
    const want = (n: number) => Array.from({ length: n }, (_, i) => ({ n: 64 * (1 + (i % 3)), d: 200 + (i % 41) * 31 }));
    for (const tiles of [41 * 41, 83 * 83]) {
      const list = want(tiles);
      measure(`thinReach, ${tiles} tiles (30 bisections)`, () => void thinReach(list, 120_000, 700), { reps: 50 });
      if (keepAt(500, 1000) !== 1) throw new Error("unreachable");
    }

    // --- and the sort the walk ends with: every wanted tile (trees and details) nearest first.
    const wants = Array.from({ length: 200 }, (_, i) => ({ n: 64, d: 200 + ((i * 7919) % 4000) }));
    measure("sort 200 wanted tiles nearest first", () => void [...wants].sort((a, b) => a.d - b.d), { reps: 20_000 });
    table(
      "forest frame paths: the gate (forest.ts:262-300) and what a hit skips",
      "code: prepare (forest.ts:307-425) = walk + blockShares + thinReach + sort + the table; noteCasters (forest.ts:398-410) hashed 36 words a job every frame.",
    );
  });
});

describe("seasonal colours and residents' positions (view layers, every frame)", () => {
  it("prices crownAt/reedAt and placeAt/standAt", () => {
    const rnd = rng(21);
    measure("crownAt (per frame, view/engine/forest.ts:119)", () => void crownAt(123_456), { reps: 100_000 });
    measure("reedAt", () => void reedAt(123_456), { reps: 100_000 });

    // A town of ~600 residents: their trips and rest spots are walked every frame while the camera is close
    // (view/engine/life.ts:96-203).
    const trips: Trip[] = Array.from({ length: 300 }, (_, i) => {
      const pts: [number, number][] = Array.from({ length: 6 }, () => [rnd() * 800 - 400, rnd() * 800 - 400]);
      return { id: i, kind: i % 7 === 0 ? "cart" : "walk", pts, depart: rnd() * 600, speed: 1.2, who: i, sex: i % 2 ? "f" : "m", age: 20 + Math.floor(rnd() * 40) };
    });
    const rests: Rest[] = Array.from({ length: 300 }, (_, i) => ({ who: 1000 + i, sex: i % 2 ? "m" : "f", age: 30, home: [rnd() * 200, rnd() * 200], work: { at: [rnd() * 200, rnd() * 200], from: 480, to: 1020 } }));
    measure("placeAt (one walker)", () => void placeAt(trips[0], 600), { reps: 100_000 });
    measure("standAt (one resting resident)", () => void standAt(rests[0], trips.slice(0, 3), 600), { reps: 100_000 });
    measure("600 residents: placeAt/standAt (one frame, life.ts:139-180)", () => {
      for (const t of trips) placeAt(t, 600);
      for (const r of rests) standAt(r, trips, 600);
    }, { reps: 20 });
    table(
      "view layer maths per frame",
      "code: view/engine/life.ts:96-203 per frame while close (every 50 ms otherwise); rounds are counted, not measured: 0.0111 ms a figure to pose+write (models benchmark).",
    );
    expect(trips.length).toBe(300);
  });
});
