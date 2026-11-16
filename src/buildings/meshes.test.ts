import { describe, expect, it } from "vitest";
import { BUILDINGS } from "../sim/buildings";
import { buildTownModel, type TownOptions } from "../map/townModels";
import type { Model, XY } from "../map/modelGeometry";

// Pins the mesh of every building model: a hash of its vertices, colours, facade codes, indices and chimney tops for a
// spread of lots, seeds and options. A refactor of the model code must keep every hash; a change meant to alter how a
// building looks updates the snapshot in its own commit (`npx vitest run -u src/buildings/meshes.test.ts`).

const lot = (along: number, deep: number): XY[] => [[-along / 2, -deep / 2], [along / 2, -deep / 2], [along / 2, deep / 2], [-along / 2, deep / 2]];
const turn = (ring: XY[], a: number): XY[] => ring.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
// An L-shaped old foundation about the size of the lot.
const ell = (along: number, deep: number): XY[] => {
  const x = along / 2, y = deep / 2;
  return [[-x, -y], [x, -y], [x, 0], [0, 0], [0, y], [-x, y]];
};

// FNV-1a over the model's numbers rounded to 0.1 mm (and 1e-4 of a colour or a normal).
function hash(m: Model): string {
  let h = 0x811c9dc5;
  const add = (v: number) => {
    h ^= Math.round(v * 1e4) >>> 0;
    h = Math.imul(h, 0x01000193);
  };
  for (const list of [m.positions, m.normals, m.colors, m.facade, m.indices, (m.smoke ?? []).flat()]) {
    add(list.length);
    for (const v of list) add(v);
  }
  return `${(h >>> 0).toString(16).padStart(8, "0")} v${m.positions.length / 3}`;
}

describe("building meshes", () => {
  it("every template keeps its mesh", () => {
    const out: Record<string, string> = {};
    for (const t of Object.values(BUILDINGS)) {
      const rect = lot(t.along, t.deep);
      const front: XY = [0, -1];
      const a = Math.PI / 6;
      const cases: [string, XY[], TownOptions][] = [
        ["seed1", rect, { seed: 1, front }],
        ["seed2", rect, { seed: 2, front }],
        ["seed3", rect, { seed: 3, front }],
        ["ringSeed", rect, { front: [1, 0] }],
        ["level2", rect, { seed: 5, front, level: 2 }],
        ["upgrading", rect, { seed: 6, front, upgrading: true }],
        ["tint", rect, { seed: 7, front, tint: "#aa3344" }],
        ["noFront", rect, { seed: 8 }],
        ["ell", ell(t.along * 1.4, t.deep * 1.4), { seed: 9, front }],
        ["turned", turn(rect, a), { seed: 10, front: [Math.sin(a), -Math.cos(a)] }],
      ];
      for (const [name, ring, opts] of cases) out[`${t.id} ${name}`] = hash(buildTownModel(ring, t.height, t.id, opts));
    }
    expect(out).toMatchSnapshot();
  });
});
