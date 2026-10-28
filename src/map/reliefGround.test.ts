import { describe, expect, it, vi } from "vitest";

vi.mock("../world/tiles", () => ({
  getDemTile: vi.fn(async () => new Float32Array(256 * 256).fill(123)),
}));

describe("groundAt DEM cache", () => {
  it("does not keep a missing tile cached after loadGround resolves", async () => {
    const { groundAt, loadGround } = await import("./relief");
    const point: [number, number] = [12.345, 45.678];

    expect(groundAt(...point)).toBeNull();

    await loadGround([point]);

    expect(groundAt(...point)).toBe(123);
  });
});
