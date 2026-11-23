import { describe, expect, it } from "vitest";
import { copyJobsKey, dropOldest, emptyJobsKey, hashWords, sameJobsKey, type JobsKey } from "./forest";

// The gate that keeps the forest from rebuilding the same job table every frame (forest.ts update): its parts must see
// every input, or a change under a standing camera would never reach the scatter.

const filled = (): JobsKey => {
  const k = emptyJobsKey();
  for (let i = 0; i < 3; i++) k.eye[i] = 4300000 + i * 1234.5;
  for (let i = 0; i < 16; i++) k.viewProj[i] = i * 0.0125 + 0.3;
  k.tanHalfY = 0.42;
  k.aspect = 1.7;
  k.near = 1;
  k.viewportH = 900;
  k.eyeAboveGround = 620;
  k.growOn = true;
  k.hasLook = true;
  k.occlusion = true;
  k.maskEpoch = 3;
  k.maskBox = [0.5, 0.4, 0.6, 0.5];
  k.heights = 4021;
  k.drapeFetched = 900;
  k.drapePending = 0;
  k.drapeResident = 210;
  return k;
};

describe("the forest's frame key", () => {
  it("calls two frames with the same inputs equal", () => {
    expect(sameJobsKey(filled(), filled())).toBe(true);
    const a = filled();
    const b = filled();
    copyJobsKey(b, a);
    expect(sameJobsKey(a, b)).toBe(true);
    // An untouched key (no frame prepared yet) equals only itself.
    expect(sameJobsKey(emptyJobsKey(), emptyJobsKey())).toBe(true);
    expect(sameJobsKey(filled(), emptyJobsKey())).toBe(false);
  });

  it("notices every input on its own", () => {
    const change: Record<string, (k: JobsKey) => void> = {
      "eye x": (k) => (k.eye[0] += 1e-3),
      "eye y": (k) => (k.eye[1] += 1e-3),
      "eye z": (k) => (k.eye[2] += 1e-3),
      tanHalfY: (k) => (k.tanHalfY += 1e-3),
      aspect: (k) => (k.aspect += 1e-3),
      near: (k) => (k.near += 1e-3),
      viewportH: (k) => (k.viewportH += 1),
      eyeAboveGround: (k) => (k.eyeAboveGround += 1),
      growOn: (k) => (k.growOn = false),
      hasLook: (k) => (k.hasLook = false),
      occlusion: (k) => (k.occlusion = false),
      maskEpoch: (k) => (k.maskEpoch += 1),
      "mask box": (k) => (k.maskBox![2] = 0.66),
      "mask dropped": (k) => (k.maskBox = null),
      heights: (k) => (k.heights += 1),
      drapeFetched: (k) => (k.drapeFetched += 1),
      drapePending: (k) => (k.drapePending += 1),
      drapeResident: (k) => (k.drapeResident += 1),
    };
    for (const [what, mutate] of Object.entries(change)) {
      const b = filled();
      mutate(b);
      expect(sameJobsKey(filled(), b), what).toBe(false);
    }
    for (let i = 0; i < 16; i++) {
      const b = filled();
      b.viewProj[i] += 1e-3;
      expect(sameJobsKey(filled(), b), `viewProj ${i}`).toBe(false);
    }
  });

  it("snapshots instead of aliasing", () => {
    const probe = filled();
    const key = emptyJobsKey();
    copyJobsKey(key, probe);
    expect(sameJobsKey(probe, key)).toBe(true);
    // The frame moves on: the snapshot must keep what the job table was built from.
    probe.eye[0] += 25;
    probe.viewProj[15] += 1e-4;
    probe.maskBox![0] = 0.9;
    probe.drapePending = 7;
    expect(sameJobsKey(probe, key)).toBe(false);
    expect(key.eye[0]).toBe(4300000);
    expect(key.viewProj[15]).toBeCloseTo(15 * 0.0125 + 0.3, 12);
    expect(key.maskBox).toEqual([0.5, 0.4, 0.6, 0.5]);
    expect(key.drapePending).toBe(0);
  });
});

describe("the caster hash of the job table", () => {
  it("hashes the words it is given", () => {
    const words = (n: number, seed = 1) => {
      const w = new Uint32Array(n);
      for (let i = 0; i < n; i++) w[i] = (i * 2654435761 + seed) >>> 0;
      return w;
    };
    expect(hashWords(words(36))).toBe(hashWords(words(36)));
    expect(hashWords(words(36))).not.toBe(hashWords(words(36, 2)));
    expect(hashWords(new Uint32Array(0))).toBe(0);
    // A single changed word anywhere in the table moves the hash: the shadow pass sees every rebuilt table.
    const a = words(36 * 20);
    const b = words(36 * 20);
    b[36 * 20 - 1] ^= 1;
    expect(hashWords(a)).not.toBe(hashWords(b));
  });
});

describe("dropOldest", () => {
  const filledCache = (n: number) => new Map(Array.from({ length: n }, (_, i) => [i, { i }] as [number, { i: number }]));

  it("drops the oldest entries down to the wanted size", () => {
    const m = filledCache(100);
    expect(dropOldest(m, 75)).toBe(25);
    expect(m.size).toBe(75);
    expect(m.has(0)).toBe(false); // the oldest went
    expect(m.has(99)).toBe(true); // the newest stayed
  });

  it("leaves a cache under the size alone", () => {
    const m = filledCache(10);
    expect(dropOldest(m, 75)).toBe(0);
    expect(m.size).toBe(10);
  });

  it("keeps a tile that was used again: a hit re-inserts it at the end", () => {
    const m = filledCache(3);
    const hot = m.get(0)!;
    m.delete(0);
    m.set(0, hot);
    dropOldest(m, 2);
    expect(m.has(0)).toBe(true); // used last, so it is not the one dropped
    expect(m.has(1)).toBe(false);
  });
});
