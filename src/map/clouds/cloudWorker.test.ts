import { describe, expect, it } from "vitest";
import { handleCloudMessage } from "./cloudWorker";

describe("cloud worker protocol", () => {
  it("answers a cube request with 6 transferable faces and storms", () => {
    const { out, transfer } = handleCloudMessage({ t: "cube", id: 5, t0: 120, seed: 3, phase: 0.1, size: 16 });
    expect(out.t).toBe("cube");
    if (out.t !== "cube") return;
    expect(out.id).toBe(5);
    expect(out.t0).toBe(120);
    expect(out.faces).toHaveLength(6);
    for (const f of out.faces) expect(f.byteLength).toBe(16 * 16 * 4);
    expect(transfer).toEqual(out.faces);
    expect(out.storms.counts).toHaveLength(6);
    expect(out.storms.cells.length % 4).toBe(0);
  });

  it("answers a noise request with both volumes", () => {
    const { out, transfer } = handleCloudMessage({ t: "noise", id: 9 });
    expect(out.t).toBe("noise");
    if (out.t !== "noise") return;
    expect(out.base.byteLength).toBe(64 ** 3 * 4);
    expect(out.detail.byteLength).toBe(32 ** 3 * 4);
    expect(transfer).toHaveLength(2);
  });

  it("reports errors with the request id", () => {
    const { out } = handleCloudMessage({ t: "bogus", id: 4 } as never);
    expect(out).toMatchObject({ t: "error", id: 4 });
  });
});
