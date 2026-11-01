import { describe, expect, it } from "vitest";
import type { FeatureCollection } from "geojson";
import { buildLayer, CIRCLE_FLOATS, FILL_FLOATS, levelSquare, LINE_FLOATS, mercX, mercY, OVERLAY_PATTERN, packColor } from "./geometry";

const fc = (geometry: object, properties: object = {}): FeatureCollection => ({ type: "FeatureCollection", features: [{ type: "Feature", properties, geometry } as never] });

describe("overlay geometry", () => {
  it("packs colour bytes little-endian with opacity as alpha", () => {
    expect(packColor("#ff8000", 1)).toBe(0xff0080ff);
    expect(packColor("#abc", 0) & 0xffffff).toBe(0xccbbaa);
    expect(packColor("#000000", 0.5) >>> 24).toBe(128);
  });

  it("triangulates a square with a hole", () => {
    const sq = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
    const hole = [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006], [0.004, 0.004]];
    const g = buildLayer(fc({ type: "Polygon", coordinates: [sq, hole] }), { kind: "fill", color: "#fff" }, [0, 0]);
    expect(g.fills.length / FILL_FLOATS).toBe(8 * 3); // 8 triangles around the hole
  });

  it("fills carry their hatch pattern per vertex, by feature", () => {
    const sq = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]];
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { zone: "res" }, geometry: { type: "Polygon", coordinates: [sq] } },
        { type: "Feature", properties: { zone: "craft" }, geometry: { type: "Polygon", coordinates: [sq] } },
      ],
    };
    const g = buildLayer(data, { kind: "fill", color: "#000", pattern: (p) => (p.zone === "res" ? OVERLAY_PATTERN.res : OVERLAY_PATTERN.craft) }, [0, 0]);
    const patterns = new Set<number>();
    for (let i = 3; i < g.fills.length; i += FILL_FLOATS) patterns.add(g.fills[i]);
    expect([...patterns].sort()).toEqual([OVERLAY_PATTERN.res, OVERLAY_PATTERN.craft]);
    const plain = buildLayer(data, { kind: "fill", color: "#000" }, [0, 0]);
    expect(plain.fills[3]).toBe(OVERLAY_PATTERN.none);
  });

  it("lines carry the distance along the line and widths in mercator metres", () => {
    const anchor: [number, number] = [mercX(10), mercY(60)];
    const g = buildLayer(fc({ type: "LineString", coordinates: [[10, 60], [10.001, 60], [10.002, 60]] }), { kind: "line", color: "#fff", widthM: 5 }, anchor);
    expect(g.lines.length / LINE_FLOATS).toBe(2);
    expect(g.lines[0]).toBeCloseTo(0, 6); // starts at the anchor
    expect(g.lines[LINE_FLOATS + 4]).toBeCloseTo(g.lines[2] - g.lines[0], 3); // along at the second segment = first's length
    expect(g.lines[6]).toBeCloseTo(10, 6); // 5 m at 60 deg = 10 mercator metres
  });

  it("styles by feature properties and filters", () => {
    const data: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { ok: true }, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: { ok: false }, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
    };
    const g = buildLayer(data, { kind: "circle", radiusPx: 3, color: (p) => (p.ok ? "#00ff00" : "#ff0000"), filter: (p) => p.ok === true }, [0, 0]);
    expect(g.circles.length / CIRCLE_FLOATS).toBe(1);
  });

  it("level squares snap and grow in quarter octaves", () => {
    const a = levelSquare(1000, 1000, 1000);
    expect(a.side).toBeGreaterThanOrEqual(1000);
    expect(a.side).toBeLessThan(1000 * 1.19);
    expect(levelSquare(1010, 1000, 1000)).toEqual(a); // a small move keeps the square
  });
});
