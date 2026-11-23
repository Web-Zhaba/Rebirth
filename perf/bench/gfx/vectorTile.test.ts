// Decoding one OpenMapTiles vector tile, as the drape bake worker does it (src/engine/bake/drapeWorker.ts:66:
// `parseSource(new VectorTile(new PbfReader(await res.arrayBuffer())))`).
//
// No network here: a synthetic MVT tile of a z12 forest-and-village square is encoded once with pbf's PbfWriter, then
// decoded over and over. Sizes match what the real source layer carries: landcover polygons (a big forest with many
// rings, fields, meadow), water polygons, waterway lines, and the `place` points of the label worker.
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader, PbfWriter } from "pbf";
import { parseSource } from "../../../src/engine/bake/drape";
import { describe, expect, it } from "vitest";
import { measure, rng, table } from "./util";

const EXTENT = 4096;
const TILE = 4096;

type Pt = [number, number];
const zig = (v: number) => (v << 1) ^ (v >> 31);

// One ring as MVT geometry commands: MoveTo, LineTo deltas, ClosePath.
function ringGeometry(pts: readonly Pt[], close: boolean): number[] {
  const out: number[] = [(1 << 3) | 1, zig(pts[0][0]), zig(pts[0][1])];
  if (pts.length > 1) {
    out.push(((pts.length - 1) << 3) | 2);
    let px = pts[0][0];
    let py = pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      out.push(zig(pts[i][0] - px), zig(pts[i][1] - py));
      px = pts[i][0];
      py = pts[i][1];
    }
  }
  if (close) out.push((1 << 3) | 7);
  return out;
}

function ringPts(n: number, cx: number, cy: number, r: number, rnd: () => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.7 + 0.6 * rnd());
    out.push([Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr)]);
  }
  return out;
}

interface Feat {
  tags: [string, string | number][];
  rings: Pt[][];
  type: 1 | 2 | 3;
}

// Keys/values of one layer interned the way the MVT encoder does it (index into the layer's key/value tables).
function writeLayer(w: PbfWriter, name: string, feats: readonly Feat[], extent = EXTENT): void {
  const keys: string[] = [];
  const values: (string | number)[] = [];
  const intern = (k: string, v: string | number) => {
    let ki = keys.indexOf(k);
    if (ki < 0) keys.push(k), (ki = keys.length - 1);
    let vi = values.indexOf(v);
    if (vi < 0) values.push(v), (vi = values.length - 1);
    return [ki, vi];
  };
  const tagged = feats.map((f) => ({ f, tags: f.tags.flatMap(([k, v]) => intern(k, v)) }));
  w.writeVarintField(15, 2); // version
  w.writeStringField(1, name);
  keys.forEach((k) => w.writeStringField(3, k));
  values.forEach((v) =>
    typeof v === "string"
      ? w.writeMessage(4, (o: string, pbf) => pbf.writeStringField(1, o), v)
      : w.writeMessage(4, (o: number, pbf) => pbf.writeVarintField(5, o), v),
  );
  tagged.forEach(({ f, tags }, i) => {
    w.writeMessage(
      2,
      (o: { id: number; tags: number[]; type: number; geom: number[] }, pbf) => {
        pbf.writeVarintField(1, o.id);
        pbf.writePackedVarint(2, o.tags);
        pbf.writeVarintField(3, o.type);
        pbf.writePackedVarint(4, o.geom);
      },
      { id: i + 1, tags, type: f.type, geom: f.rings.flatMap((r) => ringGeometry(r, f.type === 3)) },
    );
  });
  w.writeVarintField(5, extent);
}

// A z12 tile of mixed land: a big forest of many rings, fields, meadow, water, rivers and place points.
function syntheticTile(): Uint8Array {
  const rnd = rng(42);
  const landcover: Feat[] = [];
  const box = (n: number, verts: number, cls: string, sub: string) => {
    for (let i = 0; i < n; i++) {
      const cx = Math.round(rnd() * TILE);
      const cy = Math.round(rnd() * TILE);
      const r = Math.round(20 + rnd() * 380);
      landcover.push({ tags: [["class", cls], ["subclass", sub]], rings: [ringPts(verts, cx, cy, r, rnd)], type: 3 });
    }
  };
  box(120, 80, "wood", "forest"); // the wood, many rings: it also emits a forestEdge feature each (drape.ts:92)
  box(90, 24, "farmland", "field");
  box(70, 18, "grass", "meadow");
  box(20, 30, "grass", "scrub");
  box(10, 20, "wetland", "marsh");
  const water: Feat[] = [];
  for (let i = 0; i < 12; i++) {
    water.push({ tags: [["class", "lake"]], rings: [ringPts(60 + Math.round(rnd() * 60), Math.round(rnd() * TILE), Math.round(rnd() * TILE), Math.round(60 + rnd() * 400), rnd)], type: 3 });
  }
  const waterway: Feat[] = [];
  for (let i = 0; i < 25; i++) {
    const pts: Pt[] = [];
    let x = rnd() * TILE;
    let y = rnd() * TILE;
    for (let k = 0; k < 40; k++) {
      pts.push([Math.round(x), Math.round(y)]);
      x += (rnd() - 0.5) * 260;
      y += (rnd() - 0.5) * 260;
    }
    waterway.push({ tags: [["class", rnd() < 0.5 ? "river" : "stream"]], rings: [pts], type: 2 });
  }
  const place: Feat[] = [];
  for (let i = 0; i < 200; i++) place.push({ tags: [["name", `village ${i}`], ["class", "village"]], rings: [[[Math.round(rnd() * TILE), Math.round(rnd() * TILE)]]], type: 1 });

  const w = new PbfWriter();
  w.writeMessage(3, (f: Feat[], pbf) => writeLayer(pbf, "landcover", f), landcover);
  w.writeMessage(3, (f: Feat[], pbf) => writeLayer(pbf, "water", f), water);
  w.writeMessage(3, (f: Feat[], pbf) => writeLayer(pbf, "waterway", f), waterway);
  w.writeMessage(3, (f: Feat[], pbf) => writeLayer(pbf, "place", f), place);
  return w.finish() as Uint8Array;
}

describe("vector tile decode (drape worker path)", () => {
  it("decodes a synthetic z12 tile with pbf + @mapbox/vector-tile", () => {
    const bytes = syntheticTile();
    const kb = bytes.length / 1024;
    let layers = 0;
    measure("new VectorTile(new PbfReader(bytes))", () => void (layers = Object.keys(new VectorTile(new PbfReader(bytes)).layers).length), { reps: 50 });
    expect(layers).toBe(4);

    const vt = new VectorTile(new PbfReader(bytes));
    let feats = 0;
    measure("parseSource (landGeometry of every drawn feature)", () => void (feats = parseSource(vt).features.length), { reps: 50 });
    measure(
      "full worker decode: PbfReader + VectorTile + parseSource",
      () => void parseSource(new VectorTile(new PbfReader(bytes))),
      { reps: 50 },
    );
    // A single big polygon's rings, as VectorTileFeature.loadGeometry returns them.
    const land = new VectorTile(new PbfReader(bytes)).layers.landcover;
    measure("loadGeometry of one 80-vertex forest ring", () => void land.feature(0).loadGeometry(), { reps: 2000 });
    const src = parseSource(new VectorTile(new PbfReader(bytes)));
    const verts = src.features.reduce((a, f) => a + f.rings.reduce((b, r) => b + r.length / 2, 0), 0);
    table(
      "deco vector tile (one tile per drape page, cached 16 pages per source tile)",
      `tile ${kb.toFixed(0)} KB, ${src.features.length} drawn features, ${verts} vertices. code: drapeWorker.ts:66, drape.ts:80-110 parseSource.`,
    );
    expect(feats).toBeGreaterThan(200);
    expect(verts).toBeGreaterThan(1000);
  });
});
