import { describe, expect, it } from "vitest";
import { buildCubeFace, cloudType, dirToLngLat, dirToTexel, FACES, stormCells, texelDir } from "./weatherCube";

const AX: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: number[], b: number[]) => Math.acos(Math.min(1, dot(a, b)));

describe("cube mapping", () => {
  it("face centres are the axes in GL order", () => {
    for (let f = 0; f < FACES; f++) {
      const d = texelDir(f, 1, 1, 3); // odd size has a centre texel
      expect(dot(d, AX[f])).toBeCloseTo(1, 12);
    }
  });

  it("round trips texel -> dir -> texel and dirs are unit length", () => {
    const n = 16;
    for (let f = 0; f < FACES; f++)
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const d = texelDir(f, i, j, n);
          expect(Math.hypot(...d)).toBeCloseTo(1, 12);
          expect(dirToTexel(d[0], d[1], d[2], n)).toEqual({ face: f, i, j });
        }
  });

  it("is continuous across every face edge", () => {
    const n = 32;
    // Texel centres one step outside the face (in its own basis) land on the neighbouring face; the texel they hit
    // there must be within ~1.5 texel steps of the edge texel (no seam, no mirrored or rotated neighbour).
    const maxAng = (3 * 2) / n;
    for (let f = 0; f < FACES; f++)
      for (let k = 0; k < n; k++)
        for (const [i, j, di, dj] of [[0, k, -1, 0], [n - 1, k, 1, 0], [k, 0, 0, -1], [k, n - 1, 0, 1]]) {
          const d = texelDir(f, i, j, n);
          const probe = texelDir(f, i + di, j + dj, n); // virtual texel outside: the formula extends past the edge
          const hit = dirToTexel(probe[0], probe[1], probe[2], n);
          expect(hit.face).not.toBe(f);
          expect(angle(d, texelDir(hit.face, hit.i, hit.j, n))).toBeLessThan(maxAng);
        }
  });

  it("dirToLngLat at poles and the antimeridian", () => {
    expect(dirToLngLat(0, 1, 0).lat).toBeCloseTo(90, 9);
    expect(dirToLngLat(0, -1, 0).lat).toBeCloseTo(-90, 9);
    expect(dirToLngLat(0, 0, 1)).toEqual({ lng: 0, lat: 0 });
    expect(dirToLngLat(1, 0, 0).lng).toBeCloseTo(90, 9);
    expect(dirToLngLat(-1, 0, 0).lng).toBeCloseTo(-90, 9);
    expect(Math.abs(dirToLngLat(0, 0, -1).lng)).toBeCloseTo(180, 9);
    const d = dirToLngLat(Math.sin(2) * Math.cos(0.5), Math.sin(0.5), Math.cos(2) * Math.cos(0.5));
    expect(d.lng).toBeCloseTo((2 * 180) / Math.PI, 9);
    expect(d.lat).toBeCloseTo((0.5 * 180) / Math.PI, 9);
  });
});

describe("cube data", () => {
  it("fills RGBA8 faces and summarises storms", () => {
    const n = 24;
    const faces: Uint8Array[] = [];
    for (let f = 0; f < FACES; f++) {
      const out = new Uint8Array(n * n * 4);
      expect(buildCubeFace(f, n, 1000, 7, 0.1, out)).toBeGreaterThanOrEqual(0);
      let cover = 0;
      for (let k = 0; k < out.length; k += 4) cover += out[k];
      expect(cover).toBeGreaterThan(0);
      faces.push(out);
    }
    const cells = stormCells(faces, n);
    expect(cells.length % 4).toBe(0);
    expect(cells.length / 4).toBeLessThanOrEqual(64);
  });

  it("is deterministic", () => {
    const a = new Uint8Array(16 * 16 * 4);
    const b = new Uint8Array(16 * 16 * 4);
    buildCubeFace(2, 16, 500, 3, 0.2, a);
    buildCubeFace(2, 16, 500, 3, 0.2, b);
    expect(a).toEqual(b);
  });

  it("type is higher in a warm wet tropical cell than at 60N in winter", () => {
    expect(cloudType(27, 0.6, 5)).toBeGreaterThan(cloudType(-10, 0.6, 60) + 0.4);
    expect(cloudType(27, 0.6, 5)).toBeGreaterThan(0.6);
    expect(cloudType(-10, 0, 60)).toBe(0);
    expect(cloudType(40, 1, 0)).toBeLessThanOrEqual(1);
  });

  it("orders storm cells by strength", () => {
    const n = 4;
    const f = new Uint8Array(n * n * 4);
    f[5 * 4 + 1] = 255;
    f[5 * 4 + 2] = 255;
    f[6 * 4 + 1] = 200;
    f[6 * 4 + 2] = 200;
    const cells = stormCells([f], n, 3);
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(cells[3]).toBeCloseTo(1, 5);
  });
});
