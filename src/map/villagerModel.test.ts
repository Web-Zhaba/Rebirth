import { describe, expect, it } from "vitest";
import { ACTIONS, buildRig, orient, PART, poseOf, villagerLook, writeVillager, type Rig } from "./villagerModel";

const standing = (rig: Rig, t: number): Float32Array => {
  const out = new Float32Array(rig.vertices * 9);
  writeVillager(rig, poseOf(rig, "idle", t), [0, 0, 0], out, 0);
  return out;
};

describe("villagerLook", () => {
  it("is the same for the same seed and age", () => {
    expect(villagerLook(7, 30)).toEqual(villagerLook(7, 30));
  });

  it("grows: stature does not drop until old age, and children are much shorter than adults", () => {
    const heights = [0, 2, 5, 10, 16, 30, 60].map((age) => villagerLook(99, age).stature);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    expect(heights[0]).toBeLessThan(heights[4] * 0.6);
    expect(villagerLook(99, 75).stature).toBeLessThan(heights[6]);
  });

  it("keeps sex, skin and shirt as the resident grows", () => {
    const a = villagerLook(12345, 4);
    const b = villagerLook(12345, 40);
    expect([b.sex, b.skin, b.shirt]).toEqual([a.sex, a.skin, a.shirt]);
  });

  it("gives beards to grown men only", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const adultWoman = villagerLook(seed, 30);
      const boy = villagerLook(seed, 8);
      if (adultWoman.sex === "f") expect(adultWoman.beard).toBe(false);
      if (boy.sex === "m") expect(boy.beard).toBe(false);
    }
  });

  it("takes a known sex over the drawn one and keeps the rest of the look", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = villagerLook(seed, 30, "m");
      const f = villagerLook(seed, 30, "f");
      expect([m.sex, f.sex]).toEqual(["m", "f"]);
      expect(m.skin).toEqual(f.skin);
    }
  });

  it("varies across seeds", () => {
    const hairs = new Set(Array.from({ length: 50 }, (_, s) => villagerLook(s, 30).hairStyle));
    expect(hairs.size).toBeGreaterThan(1);
  });
});

describe("buildRig", () => {
  const rig = buildRig(villagerLook(3, 25));

  it("packs eight parts of finite vertices with unit normals", () => {
    expect(rig.parts).toHaveLength(8);
    expect(rig.parts[0].start).toBe(0);
    expect(rig.parts[7].start + rig.parts[7].count).toBe(rig.vertices);
    expect(rig.data).toHaveLength(rig.vertices * 9);
    for (let i = 0; i < rig.data.length; i += 9) {
      expect(Number.isFinite(rig.data[i])).toBe(true);
      const n = Math.hypot(rig.data[i + 3], rig.data[i + 4], rig.data[i + 5]);
      expect(n).toBeCloseTo(1, 5);
    }
  });

  it("winds the closed parts outward", () => {
    // An arm is a sleeve over a ball hand, a leg a peg, a foot a ball: every face's normal points away from the part's
    // axis, a segment from `lo` up to `hi` (a point for the ball).
    for (const [part, x, z, lo, hi] of [
      [PART.armL, -0.25, 0, 0.94, 1.33],
      [PART.legL, -0.1, 0, 0.07, 0.74],
      [PART.footL, -0.1, 0.03, 0.05, 0.05],
    ] as const) {
      const { start, count } = rig.parts[part];
      expect(count).toBeGreaterThan(0);
      for (let v = start; v < start + count; v++) {
        const i = v * 9;
        const y = Math.min(hi, Math.max(lo, rig.data[i + 1]));
        const away = (rig.data[i] - x) * rig.data[i + 3] + (rig.data[i + 1] - y) * rig.data[i + 4] + (rig.data[i + 2] - z) * rig.data[i + 5];
        expect(away).toBeGreaterThan(-1e-6);
      }
    }
  });

  it("cuts the far figure coarser, with the same parts and height", () => {
    const far = buildRig(rig.look, 0);
    expect(far.parts).toHaveLength(8);
    expect(far.vertices).toBeLessThan(rig.vertices * 0.6);
    expect(far.top).toBeCloseTo(rig.top, 2);
  });

  it("cuts the torso at a straight waist: a ring of vertices lies on one height", () => {
    const { start, count } = rig.parts[PART.torso];
    const onWaist = [];
    for (let v = start; v < start + count; v++) if (Math.abs(rig.data[v * 9 + 1] - 0.8) < 1e-6) onWaist.push(v);
    expect(onWaist.length).toBeGreaterThanOrEqual(2 * 7);
  });

  it("is a child's proportion for a child: bigger head relative to the stature", () => {
    const child = buildRig(villagerLook(3, 1));
    const adult = buildRig(villagerLook(3, 30));
    expect(child.top / child.look.stature).toBeGreaterThan(adult.top / adult.look.stature);
  });
});

describe("orient", () => {
  const rig = buildRig(villagerLook(21, 30));
  const placed = (dx: number, dy: number) => {
    const out = new Float32Array(rig.vertices * 9);
    writeVillager(rig, orient(poseOf(rig, "idle", 0), dx, dy), [0, 0, 0], out, 0);
    return out;
  };

  it("stands the figure up along z with its feet on the ground", () => {
    const out = placed(0, 1);
    let lowest = Infinity;
    let highest = -Infinity;
    for (let i = 0; i < out.length; i += 9) (lowest = Math.min(lowest, out[i + 2])), (highest = Math.max(highest, out[i + 2]));
    expect(Math.abs(lowest)).toBeLessThan(1e-4);
    expect(highest).toBeCloseTo(rig.look.scale * rig.top, 2);
  });

  it("turns the toes to the heading: the feet's centre lies ahead of the origin along it", () => {
    for (const [dx, dy] of [[0, 1], [1, 0], [-0.6, 0.8]]) {
      const out = placed(dx, dy);
      let ahead = 0;
      let n = 0;
      for (const part of [PART.footL, PART.footR]) {
        const { start, count } = rig.parts[part];
        for (let v = start; v < start + count; v++, n++) ahead += out[v * 9] * dx + out[v * 9 + 1] * dy;
      }
      expect(ahead / n).toBeGreaterThan(0.02);
    }
  });

  it("keeps the normals unit and winds the faces the same way (a rotation, no mirror)", () => {
    const out = placed(0.6, 0.8);
    for (let i = 0; i < out.length; i += 9) expect(Math.hypot(out[i + 3], out[i + 4], out[i + 5])).toBeCloseTo(1, 5);
  });
});

describe("poseOf", () => {
  const rig = buildRig(villagerLook(21, 30));

  it("stands every action on the ground: the lowest point is at y = 0", () => {
    for (const action of ACTIONS)
      for (const t of [0, 0.37, 1.9]) {
        const pose = poseOf(rig, action, t);
        expect(pose).toHaveLength(8);
        const out = new Float32Array(rig.vertices * 9);
        writeVillager(rig, pose, [0, 0, 0], out, 0);
        let lowest = Infinity;
        for (let i = 0; i < out.length; i += 9) lowest = Math.min(lowest, out[i + 1]);
        expect(Math.abs(lowest)).toBeLessThan(1e-4);
      }
  });

  it("turns a walking leg to where its foot stands", () => {
    const pose = poseOf(rig, "walk", 0.25);
    const out = new Float32Array(rig.vertices * 9);
    writeVillager(rig, pose, [0, 0, 0], out, 0);
    for (const [leg, foot] of [
      [PART.legL, PART.footL],
      [PART.legR, PART.footR],
    ] as const) {
      // the leg's lowest vertices lie over the foot, ahead or behind with it
      const l = rig.parts[leg];
      let low = Infinity;
      let z = 0;
      for (let v = l.start; v < l.start + l.count; v++) if (out[v * 9 + 1] < low) (low = out[v * 9 + 1]), (z = out[v * 9 + 2]);
      expect(Math.sign(z)).toBe(Math.sign(pose[foot].t[2]));
      expect(Math.abs(z - pose[foot].t[2])).toBeLessThan(0.08 * rig.look.scale + 0.02);
    }
  });

  it("moves the feet when walking and the hands when working", () => {
    const at = (action: "walk" | "work", t: number) => poseOf(rig, action, t);
    expect(at("walk", 0.1)[PART.footL].t).not.toEqual(at("walk", 0.4)[PART.footL].t);
    expect(at("work", 0.1)[PART.armR].m).not.toEqual(at("work", 1.0)[PART.armR].m);
  });

  it("lays the figure down when sleeping: its height is the body's depth, not its stature", () => {
    const out = new Float32Array(rig.vertices * 9);
    writeVillager(rig, poseOf(rig, "sleep", 0), [0, 0, 0], out, 0);
    let top = -Infinity;
    for (let i = 0; i < out.length; i += 9) top = Math.max(top, out[i + 1]);
    expect(top).toBeLessThan(0.5 * rig.look.scale * rig.top);
  });

  it("turns the head when idle", () => {
    const a = standing(rig, 0);
    const b = standing(rig, 2);
    expect(a).not.toEqual(b);
  });
});
