import { describe, expect, it } from "vitest";
import { DEM_SIZE, PAGE_SIZE, samplePage } from "../engine/bake/terrarium";
import { neighboursNeeded, sampleBlock, slopeBlock, type DemBlock } from "./terrain";

const S = DEM_SIZE;
// Smooth-ish but irregular synthetic world height at global pixel (gx, gy).
const world = (gx: number, gy: number) => ((gx * 37 + gy * 91 + gx * gy) % 997) * 0.37 - 50;

function tileAt(tx: number, ty: number): Float32Array {
  const g = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) g[j * S + i] = world(tx * S + i, ty * S + j);
  return g;
}
function fullBlock(): DemBlock {
  const b: DemBlock = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) b.push(tileAt(dx, dy));
  return b;
}
// The page the engine would hold for the centre tile: border filled from the same neighbours.
function enginePage(block: DemBlock): Float32Array {
  const h = new Float32Array(PAGE_SIZE * PAGE_SIZE);
  for (let j = 0; j < PAGE_SIZE; j++)
    for (let i = 0; i < PAGE_SIZE; i++) {
      const x = i - 1;
      const y = j - 1;
      const tx = Math.floor(x / S);
      const ty = Math.floor(y / S);
      const t = block[(ty + 1) * 3 + tx + 1];
      h[j * PAGE_SIZE + i] = t
        ? t[(y - ty * S) * S + (x - tx * S)]
        : (block[4] as Float32Array)[Math.max(0, Math.min(S - 1, y)) * S + Math.max(0, Math.min(S - 1, x))];
    }
  return h;
}

describe("sampleBlock", () => {
  it("equals a single merged grid across the tile edges", () => {
    const block = fullBlock();
    for (const [px, py] of [
      [255.9, 100.2],
      [256, 100.2],
      [256.4, 100.2],
      [-0.3, 40.7],
      [0.2, -0.45],
      [128.5, 256.3],
      [255.5, 255.5],
    ])
      expect(sampleBlock(block, px, py)).toBeCloseTo(merged(px, py), 3);
  });

  it("is continuous across x = 256 (centre tile vs. its east neighbour)", () => {
    const block = fullBlock();
    const east: DemBlock = [null, null, null, block[4], block[5], null, null, null, null];
    // Sample just left of the edge in the centre tile and just right of it in the east tile (local px ~ 0).
    const eps = 1e-6;
    const left = sampleBlock(block, S - eps, 80.3);
    const right = sampleBlock(east, 0 + eps, 80.3);
    expect(left).toBeCloseTo(right, 3);
    // Both equal the merged grid at global x = 256.
    expect(left).toBeCloseTo(merged(S, 80.3), 3);
  });

  it("agrees with the engine's samplePage on the same tiles", () => {
    const block = fullBlock();
    const page = enginePage(block);
    for (const [u, v] of [
      [0, 0],
      [1, 1],
      [0.001, 0.999],
      [0.5, 0.5],
      [0.9987, 0.37],
      [0.0005, 0.62],
      [0.4, 0.0009],
      [0.77, 0.9995],
    ])
      expect(sampleBlock(block, u * S, v * S)).toBeCloseTo(samplePage(page, u, v), 3);
  });

  it("corner: missing diagonal falls back to the centre corner pixel, like the engine's border", () => {
    const block = fullBlock();
    block[0] = null; // no NW neighbour
    block[1] = null;
    block[3] = null;
    const page = enginePage(block);
    for (const [u, v] of [
      [0, 0],
      [0.001, 0.001],
    ])
      expect(sampleBlock(block, u * S, v * S)).toBeCloseTo(samplePage(page, u, v), 3);
    expect(sampleBlock(block, 0, 0)).toBeCloseTo(world(0, 0), 3);
  });

  it("corner: a present diagonal contributes", () => {
    const block = fullBlock();
    expect(sampleBlock(block, 0, 0)).toBeCloseTo(merged(0, 0), 3);
    const clamped = fullBlock();
    clamped[0] = null;
    clamped[1] = null;
    clamped[3] = null;
    expect(sampleBlock(block, 0, 0)).not.toBeCloseTo(sampleBlock(clamped, 0, 0), 3);
  });

  it("slope across an edge matches slope on a merged plane", () => {
    const plane = (gx: number) => gx * 2;
    const mk = (tx: number) => {
      const g = new Float32Array(S * S);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) g[j * S + i] = plane(tx * S + i);
      return g;
    };
    const block: DemBlock = [null, null, null, mk(-1), mk(0), mk(1), null, null, null];
    expect(slopeBlock(block, 255.9, 100, 10)).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 3);
    expect(slopeBlock(block, 0.1, 100, 10)).toBeCloseTo((Math.atan(0.2) * 180) / Math.PI, 3);
  });

  it("neighboursNeeded asks only for the edge sides in reach", () => {
    expect(neighboursNeeded(128, 128)).toEqual({ dx: [0], dy: [0] });
    expect(neighboursNeeded(1, 128)).toEqual({ dx: [0, -1], dy: [0] });
    expect(neighboursNeeded(255.5, 0.5)).toEqual({ dx: [0, 1], dy: [0, -1] });
  });
});

// Reference: bilinear on the merged global grid, pixel centres at +0.5.
function merged(px: number, py: number): number {
  const u = px - 0.5;
  const v = py - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const top = world(x0, y0) * (1 - fx) + world(x0 + 1, y0) * fx;
  const bottom = world(x0, y0 + 1) * (1 - fx) + world(x0 + 1, y0 + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}
