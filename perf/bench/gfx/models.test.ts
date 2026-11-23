// Model meshes built on the CPU: trees (map/treeModels.ts), residents (map/villagerModel.ts), a town building
// (map/townModels.ts over modelGeometry.ts) and the legacy CPU tree scatter (map/treeScatter.ts).
//
// The forest is grown on the GPU now (engine/scene/forest.ts), so tree meshes are a start-up cost, but the residents'
// figures are rewritten EVERY frame while the camera is close (view/engine/life.ts:183-210), and a building model is
// rebuilt whenever an item's key changes (view/engine/models.ts:100-140).
import { Mesh, rgb, type XY } from "../../../src/map/modelGeometry";
import { buildTree, crownAt, KIND_INFO } from "../../../src/map/treeModels";
import { buildTownModel } from "../../../src/map/townModels";
import { insideRings, scatterDetails, scatterTrees, TREE_KINDS, type ForestPoly, type TreeKind } from "../../../src/map/treeScatter";
import { buildRig, orient, poseOf, villagerLook, writeVillager } from "../../../src/map/villagerModel";
import { describe, expect, it } from "vitest";
import { measure, measureSlow, ring, rng, table } from "./util";

describe("tree meshes", () => {
  it("builds every kind of tree and bush", () => {
    const sizes: string[] = [];
    for (const kind of TREE_KINDS) {
      const m = buildTree(kind as TreeKind, 0);
      sizes.push(`${kind} ${m.positions.length / 3}v/${m.indices.length / 3}t`);
      measure(`buildTree ${kind} (lod 0)`, () => void buildTree(kind as TreeKind, 0), { reps: 200 });
    }
    let verts = 0;
    measure(
      "buildTree all 6 kinds (view/engine/forest.ts:60, once)",
      () => {
        verts = 0;
        for (const kind of TREE_KINDS) verts += buildTree(kind as TreeKind, 0).positions.length / 3;
      },
      { reps: 20 },
    );
    table("tree meshes (start-up: engine/scene/treeAtlas.ts uploads them once)", sizes.join("  "));
    expect(verts).toBeGreaterThan(0);
  });
});

describe("resident figures (rewritten every frame while close)", () => {
  it("prices a rig, a pose and the per-frame vertex write", () => {
    const look = villagerLook(1234, 30, "f");
    const fine = buildRig(look, 1);
    const coarse = buildRig(look, 0);
    const out = new Float32Array(4096 * 9);
    const pose = orient(poseOf(fine, "walk", 1.5), 1, 0);
    const origin: [number, number, number] = [12, 34, 5];

    measure("villagerLook (a resident's look)", () => void villagerLook(1234, 30, "f"), { reps: 5000 });
    measure(`buildRig detail 1`, () => void buildRig(look, 1), { reps: 500, note: `${fine.vertices} vertices` });
    measure(`buildRig detail 0`, () => void buildRig(look, 0), { reps: 500, note: `${coarse.vertices} vertices` });
    measure("poseOf (walk, one figure)", () => void poseOf(fine, "walk", 1.5), { reps: 5000 });
    measure("orient", () => void orient(pose, 1, 0), { reps: 5000 });
    measure("writeVillager (9 floats a vertex)", () => void writeVillager(fine, pose, origin, out, 0), { reps: 2000, note: `${fine.vertices * 9 * 4} B a figure` });

    let n = 0;
    measure(
      "pose + write, one figure (what life.ts does per figure per frame)",
      () => {
        const p = orient(poseOf(fine, "walk", 1.5), 1, 0);
        n = writeVillager(fine, p, origin, out, 0) / 9;
      },
      { reps: 2000 },
    );
    expect(n).toBeGreaterThan(0);
    table(
      "resident figures",
      "code: view/engine/life.ts:169-203 per figure per frame; FIGURE_VERTICES = 120_000 (life.ts:33), RIGS_KEPT = 1500 (life.ts:43).",
    );
  });
});

describe("a town building model", () => {
  it("prices a house-sized mesh (map/townModels.ts -> modelGeometry.ts)", () => {
    const foot: XY[] = ring(12, 5, 0, 0, rng(11));
    const m = buildTownModel(foot, 5.5, "izba", { seed: 3 });
    measureSlow("buildTownModel (izba, 12-vertex footprint)", () => void buildTownModel(foot, 5.5, "izba", { seed: 3 }), { runs: 5 });
    console.log(`   izba: ${m.positions.length / 3} vertices, ${m.indices.length / 3} triangles, ${m.smoke?.length ?? 0} smoke emitters`);
    // view/engine/models.ts:100-140 rebuilds the changed items of a list of hundreds when it changes.
    measure("buildTownModel x 20 (a street of houses rebuilt)", () => {
      for (let i = 0; i < 20; i++) buildTownModel(foot, 5.5, "izba", { seed: i });
    }, { runs: 5, reps: 1 });
    table("town model (once per changed building item, not per frame)", "code: view/engine/models.ts:140 rebuild() with the item cache.");
    expect(Mesh).toBeTruthy();
    expect(rgb("#ffffff")[0]).toBe(1);
  });
});

describe("the legacy CPU tree scatter (map/treeScatter.ts)", () => {
  it("prices a scatter over a 4 km2 forest patch", () => {
    const rnd = rng(7);
    const poly = (n: number, r: number, cx: number, cy: number): ForestPoly => ({ rings: [ring(n, r, cx, cy, rnd)], bbox: [cx - r, cy - r, cx + r, cy + r] });
    const forests: ForestPoly[] = [poly(400, 300, 0, 0), poly(300, 220, 400, 150), poly(200, 180, -380, 200)];
    const rect: [number, number, number, number] = [-1000, -1000, 1000, 1000];
    const blocked = () => false;
    let trees = 0;
    measure("scatterTrees over 4 km2 (10 m spacing, 3 forest polys)", () => void (trees = scatterTrees({ forests, rect, spacing: 10, lat: 47.27, blocked }).length / 6), { reps: 5 });
    measure("insideRings (one candidate point)", () => void insideRings(10.5, 20.25, forests[0].rings), { reps: 20000 });
    const details = forests.map((f) => ({ ...f, mix: { bush: { share: 0.3, size: [2, 3] as [number, number] }, reed: { share: 0.1, size: [1, 2] as [number, number] } } }));
    measure("scatterDetails over 4 km2", () => void scatterDetails({ polys: details, rect, blocked }), { reps: 5 });
    console.log(`   scatterTrees: ${trees} trees in the patch`);
    expect(KIND_INFO.conifer.tall).toBe(12);
    expect(crownAt(0).a.length).toBeGreaterThan(0);
    table("legacy CPU scatter (off the per-frame path: engine/scene/forestScatter.wgsl replaced it)");
  });
});

// Not the exported function (models.ts keeps `merge` private): the same algorithm over the same arrays, so the number
// is what view/engine/models.ts:227-241 pays when the town's item list changes.
function mergeEquivalent(packs: { v: Float32Array; i: Uint32Array }[]): { vertices: Float32Array; indices: Uint32Array } {
  const VF = 15; // TOWN_VERTEX_FLOATS (scene/townMesh.ts:19)
  let nv = 0;
  let ni = 0;
  for (const p of packs) (nv += p.v.length / VF), (ni += p.i.length);
  const vertices = new Float32Array(nv * VF);
  const indices = new Uint32Array(ni);
  let v = 0;
  let k = 0;
  for (const p of packs) {
    vertices.set(p.v, v * VF);
    for (let j = 0; j < p.i.length; j++) indices[k + j] = p.i[j] + v;
    v += p.v.length / VF;
    k += p.i.length;
  }
  return { vertices, indices };
}

describe("the town's merged mesh (rebuilt whenever an item changes)", () => {
  it("prices merge + upload of the whole town", () => {
    const VF = 15;
    const house = buildTownModel(ring(12, 5, 0, 0, rng(11)), 5.5, "izba", { seed: 3 });
    const v = Float32Array.from({ length: (house.positions.length / 3) * VF }, (_, i) => i % 7);
    const i = Uint32Array.from(house.indices);
    for (const n of [300, 800]) {
      const packs = Array.from({ length: n }, () => ({ v, i }));
      let bytes = 0;
      measure(`merge ${n} buildings (${(n * v.length * 4) / 1048576} MB of vertices)`, () => {
        const m = mergeEquivalent(packs);
        bytes = m.vertices.byteLength + m.indices.byteLength;
      }, { reps: 2, note: "models.ts:227-241 equivalent" });
      if (n === 800) console.log(`   merged town: ${(bytes / 1048576).toFixed(1)} MB uploaded on every change (models.ts:145-150 -> townMesh.upload)`);
    }
    table("town mesh merge (once per changed item list, NOT per frame)", "code: view/engine/models.ts:142-147 (merge + setRoads/setBuildings) -> scene/townMesh.ts:281-291 (new GPUBuffers + writeBuffer).");
  });
});
