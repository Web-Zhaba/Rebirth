// Label layout: the pure collision pick (src/view/engine/labelLayout.ts) and the per-frame work the two DOM label
// layers do around it — place names (placeLabels.ts:128-165) and the game's own text (gameLabels.ts:128-180).
//
// Both layers run inside engine.onFrame(), i.e. after every frame: 60 times a second each, each projecting every
// candidate point (engine.project -> transformPoint) and then writing style.transform on the surviving label elements.
import { buildView, defaultCamera, type CameraState } from "../../../src/engine/camera/camera";
import { geodeticToEcef, sub } from "../../../src/engine/geo/ellipsoid";
import { transformPoint } from "../../../src/engine/camera/projection";
import { lineLabelAnchor, pickLabels, rotatedExtent, wrapExtent, type LabelBox } from "../../../src/view/engine/labelLayout";
import { describe, expect, it } from "vitest";
import { measure, rng, table } from "./util";

const boxes = (n: number, seed = 3): LabelBox[] => {
  const rnd = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ x: rnd() * 1600, y: rnd() * 900, w: 40 + rnd() * 60, h: 13, priority: Math.floor(rnd() * 400) + i / 1e6 }));
};

// pickLabels as it was before the grid (labelLayout.ts): every candidate against every shown box. Kept here to price
// the change in the same run, on the same boxes, rather than against a number from another day.
function pickPairwise(boxes: readonly LabelBox[]): number[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].priority - boxes[b].priority);
  const shown: number[] = [];
  for (const i of order) {
    const b = boxes[i];
    let free = true;
    for (const j of shown) {
      const o = boxes[j];
      if (Math.abs(b.x - o.x) * 2 < b.w + o.w + 2 * 4 && Math.abs(b.y - o.y) * 2 < b.h + o.h + 2 * 4) {
        free = false;
        break;
      }
    }
    if (free) shown.push(i);
  }
  return shown;
}

describe("label collision pick", () => {
  it("picks non-overlapping boxes in priority order", () => {
    for (const n of [50, 100, 300, 1000]) {
      const b = boxes(n);
      let shown = 0;
      measure(`pickLabels (grid) ${n} boxes`, () => void (shown = pickLabels(b).length), { reps: 50, note: `${n} candidates` });
      measure(`pickLabels (pairwise, before) ${n} boxes`, () => void pickPairwise(b), { reps: 50 });
      expect(shown).toBeGreaterThan(0);
      expect(pickLabels(b)).toEqual(pickPairwise(b));
    }
    // Worst case for a grid: every box overlaps the first one, so nothing else is ever shown.
    const dense = Array.from({ length: 400 }, (_, i) => ({ x: 800 + (i % 3), y: 400 + (i % 5), w: 60, h: 14, priority: i }));
    measure("pickLabels (grid) 400 fully overlapping boxes", () => void pickLabels(dense), { reps: 50 });
    measure("pickLabels (pairwise, before) 400 fully overlapping boxes", () => void pickPairwise(dense), { reps: 50 });
    // The game's own labels are a few dozen boxes: the grid must not cost more than the loop it replaced.
    const few = boxes(30);
    measure("pickLabels (grid) 30 boxes", () => void pickLabels(few), { reps: 200 });
    measure("pickLabels (pairwise, before) 30 boxes", () => void pickPairwise(few), { reps: 200 });
    table("pickLabels (labelLayout.ts:41-124: a 64 px grid over the padded boxes, then the same overlap test)", "called once per frame by each label layer.");
  });

  it("lays street names along their line", () => {
    for (const n of [20, 100, 400]) {
      const pts: [number, number][] = Array.from({ length: n }, (_, i) => [i * 4, Math.sin(i / 6) * 12]);
      measure(`lineLabelAnchor ${n}-point line`, () => void lineLabelAnchor(pts, 60), { reps: 200 });
    }
    measure("rotatedExtent", () => void rotatedExtent(70, 14, 0.4), { reps: 200_000 });
    measure("wrapExtent", () => void wrapExtent(140, 96), { reps: 200_000 });
    table("line labels (gameLabels.ts:145-152, per street label per frame)");
  });
});

describe("a frame of place names, as placeLabels.ts does it", () => {
  it("projects, culls and picks the names of the tiles in view", () => {
    const s: CameraState = defaultCamera();
    Object.assign(s, { lat: 47.27, lng: 11.4, h: 600, distance: 4000, pitch: 45, heading: 0 });
    const view = buildView(s, 1600, 900, () => 600);
    const rnd = rng(17);
    const all = Array.from({ length: 6000 }, () => ({ lat: 47.27 + (rnd() - 0.5) * 0.4, lng: 11.4 + (rnd() - 0.5) * 0.6, w: 40 + rnd() * 40, priority: Math.floor(rnd() * 900) }));
    const eye = view.eye;
    const far = 6 * s.distance + 2000;

    for (const n of [300, 1000, 3000, 6000]) {
      const places = all.slice(0, n);
      const found: LabelBox[] = [];
      measure(
        `project + cull ${n} names (placeLabels.ts:139-152)`,
        () => {
          found.length = 0;
          for (const p of places) {
            const e = geodeticToEcef(p.lat, p.lng, 600);
            if (Math.hypot(e[0] - eye[0], e[1] - eye[1], e[2] - eye[2]) > far) continue;
            const [x, y, , w] = transformPoint(view.viewProj, sub(e, eye));
            if (w <= 0) continue;
            const sx = ((x / w + 1) / 2) * 1600;
            const sy = ((1 - y / w) / 2) * 900;
            if (sx < -40 || sy < -40 || sx > 1640 || sy > 940) continue;
            found.push({ x: sx, y: sy, w: p.w, h: 17, priority: p.priority });
          }
        },
        { reps: 20, note: "" },
      );
      expect(found.length).toBeGreaterThan(0);
    }
    const cand = boxes(1000);
    measure("pickLabels on the survivors (1000 boxes)", () => void pickLabels(cand), { reps: 50 });
    measure("transformPoint x 1000 (engine.project inner call)", () => {
      for (let i = 0; i < 1000; i++) transformPoint(view.viewProj, sub(geodeticToEcef(47.27 + i * 1e-4, 11.4, 600), eye));
    }, { reps: 20 });
    table(
      "place names per frame",
      "code: placeLabels.ts:139-152 per candidate; the layer runs in engine.onFrame (every frame, engine.ts:290).",
    );
  });
});
