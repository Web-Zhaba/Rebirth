import { describe, expect, it } from "vitest";
import type { VectorTile } from "@mapbox/vector-tile";
import { makeFrame } from "./frame";
import { lngLatToTile } from "./mercator";
import {
  clipPolylineToDiscs,
  dedupeFoundations,
  inDiscs,
  matchStreetName,
  parseOldWorldTile,
  ringArea,
  ringCentroid,
  segmentDiscInterval,
  tilePointToLngLat,
  tilesForDiscs,
  type XY,
} from "./oldworld";

const sq = (x: number, y: number, s: number): XY[] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
];

describe("oldworld geometry", () => {
  it("area and centroid", () => {
    const r = sq(2, 4, 10);
    expect(ringArea(r)).toBeCloseTo(100);
    const [cx, cy] = ringCentroid(r);
    expect(cx).toBeCloseTo(7);
    expect(cy).toBeCloseTo(9);
  });

  it("point in disc union", () => {
    const discs = [
      { x: 0, y: 0, r: 5 },
      { x: 20, y: 0, r: 5 },
    ];
    expect(inDiscs(3, 0, discs)).toBe(true);
    expect(inDiscs(22, 1, discs)).toBe(true);
    expect(inDiscs(10, 0, discs)).toBe(false);
  });

  it("segment-circle interval", () => {
    const d = { x: 0, y: 0, r: 5 };
    const iv = segmentDiscInterval([-10, 0], [10, 0], d)!;
    expect(iv[0]).toBeCloseTo(0.25);
    expect(iv[1]).toBeCloseTo(0.75);
    expect(segmentDiscInterval([-10, 6], [10, 6], d)).toBeNull();
    expect(segmentDiscInterval([1, 0], [2, 0], d)).toEqual([0, 1]);
  });

  it("clips a polyline exactly to a disc", () => {
    const out = clipPolylineToDiscs(
      [
        [-10, 0],
        [10, 0],
      ],
      [{ x: 0, y: 0, r: 5 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0][0][0]).toBeCloseTo(-5);
    expect(out[0][1][0]).toBeCloseTo(5);
  });

  it("clips across a union and splits when leaving", () => {
    const line: XY[] = [
      [-10, 0],
      [40, 0],
    ];
    const two = clipPolylineToDiscs(line, [
      { x: 0, y: 0, r: 5 },
      { x: 20, y: 0, r: 5 },
    ]);
    expect(two).toHaveLength(2);
    const overlap = clipPolylineToDiscs(line, [
      { x: 0, y: 0, r: 6 },
      { x: 8, y: 0, r: 6 },
    ]);
    expect(overlap).toHaveLength(1);
    expect(overlap[0][0][0]).toBeCloseTo(-6);
    expect(overlap[0][overlap[0].length - 1][0]).toBeCloseTo(14);
  });

  it("keeps a bent polyline continuous", () => {
    const out = clipPolylineToDiscs(
      [
        [-3, 0],
        [0, 0],
        [0, 3],
      ],
      [{ x: 0, y: 0, r: 10 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(3);
  });

  it("dedupes by osm key and by centroid", () => {
    const a = { id: "a", ring: sq(0, 0, 10), area: 100, osm: "7" };
    const b = { id: "b", ring: sq(50, 50, 10), area: 100, osm: "7" };
    const c = { id: "c", ring: sq(0.2, 0.2, 10), area: 100 };
    const d = { id: "d", ring: sq(30, 0, 10), area: 100 };
    expect(dedupeFoundations([a, b, c, d]).map((f) => f.id)).toEqual(["a", "d"]);
  });

  it("matches street names by proximity", () => {
    const named = [{ name: "Lenina", pts: [[0, 1], [100, 1]] as XY[] }];
    expect(matchStreetName([[10, 0], [60, 0]], named)).toBe("Lenina");
    expect(matchStreetName([[10, 20], [60, 20]], named)).toBeUndefined();
  });

  it("tile pixel to lng/lat is the inverse of lngLatToTile", () => {
    const f = lngLatToTile(37.9189, 59.1244, 14);
    const tx = Math.floor(f.x);
    const ty = Math.floor(f.y);
    const [lng, lat] = tilePointToLngLat(14, tx, ty, 4096, (f.x - tx) * 4096, (f.y - ty) * 4096);
    expect(lng).toBeCloseTo(37.9189, 6);
    expect(lat).toBeCloseTo(59.1244, 6);
  });

  it("covers the tiles touching a disc", () => {
    const frame = makeFrame(59.1244, 37.9189);
    const tiles = tilesForDiscs(frame, [{ x: 0, y: 0, r: 100 }]);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    const big = tilesForDiscs(frame, [{ x: 0, y: 0, r: 3000 }]);
    expect(big.length).toBeGreaterThan(4);
  });
});

describe("parseOldWorldTile", () => {
  const frame = makeFrame(59.1244, 37.9189);
  const f = lngLatToTile(37.9189, 59.1244, 14);
  const tx = Math.floor(f.x);
  const ty = Math.floor(f.y);
  const px = (f.x - tx) * 4096;
  const py = (f.y - ty) * 4096;
  const feat = (type: number, props: Record<string, unknown>, geom: { x: number; y: number }[][], id?: number) => ({
    type,
    id,
    properties: props,
    loadGeometry: () => geom,
  });
  const layer = (features: ReturnType<typeof feat>[]) => ({
    extent: 4096,
    length: features.length,
    feature: (i: number) => features[i],
  });
  // ~1.9 m per tile unit at z14 / 4096
  const sqT = (x: number, y: number, s: number) => [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
  ];
  const vt = {
    layers: {
      building: layer([
        feat(3, { render_height: 12 }, [sqT(px, py, 10)], 55),
        feat(3, {}, [sqT(px + 3000, py, 10)], 56),
      ]),
      transportation: layer([
        feat(2, { class: "minor" }, [[{ x: px - 200, y: py }, { x: px + 200, y: py }]]),
        feat(2, { class: "rail" }, [[{ x: px - 200, y: py }, { x: px + 200, y: py }]]),
        feat(2, { class: "minor", brunnel: "tunnel" }, [[{ x: px - 200, y: py }, { x: px + 200, y: py }]]),
      ]),
      transportation_name: layer([feat(2, { name: "Ulitsa", "name:ru": "Улица" }, [[{ x: px - 200, y: py + 1 }, { x: px + 200, y: py + 1 }]])]),
      poi: layer([feat(1, { name: "Shop", class: "shop", subclass: "bakery" }, [[{ x: px + 5, y: py + 5 }]], 9)]),
    },
  } as unknown as VectorTile;

  it("keeps features inside the discs only", () => {
    const out = parseOldWorldTile(vt, 14, tx, ty, frame, [{ x: 0, y: 0, r: 60 }]);
    expect(out.foundations).toHaveLength(1);
    expect(out.foundations[0].id).toBe("osm:55");
    expect(out.foundations[0].height).toBe(12);
    expect(out.streets).toHaveLength(1);
    expect(out.streets[0].cls).toBe("minor");
    expect(out.streets[0].name).toBe("Улица");
    const xs = out.streets[0].pts.map((p) => Math.hypot(p[0], p[1]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(60.001);
    expect(out.pois.map((p) => p.name)).toEqual(["Shop"]);
  });

  it("reads notable POIs, named or not, in a band beyond the disc; plain POIs only inside", () => {
    const at = (dx: number, dy: number) => [[{ x: px + dx, y: py + dy }]];
    const vt2 = {
      layers: {
        poi: layer([
          feat(1, { class: "school", subclass: "school" }, at(5, 5), 1), // unnamed, inside
          feat(1, { name: "Храм", class: "place_of_worship", subclass: "christian" }, at(150, 0), 2), // ~47 m out: in the band
          feat(1, { class: "castle", subclass: "castle" }, at(400, 0), 3), // ~125 m out: beyond the band
          feat(1, { name: "Кафе", class: "cafe", subclass: "cafe" }, at(150, 0), 4), // not notable, outside the disc
          feat(1, { class: "cafe", subclass: "cafe" }, at(5, 5), 5), // not notable, unnamed
        ]),
      },
    } as unknown as VectorTile;
    const out = parseOldWorldTile(vt2, 14, tx, ty, frame, [{ x: 0, y: 0, r: 20 }]);
    expect(out.spots.map((p) => p.id).sort()).toEqual(["osm:1", "osm:2"]);
    expect(out.spots.find((p) => p.id === "osm:1")!.name).toBeUndefined();
    expect(out.pois).toEqual([]);
  });

  it("returns nothing for a missing tile", () => {
    expect(parseOldWorldTile(null, 14, 0, 0, frame, [])).toEqual({ foundations: [], streets: [], pois: [], spots: [] });
  });
});
