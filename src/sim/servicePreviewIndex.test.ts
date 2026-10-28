import { describe, expect, it, vi } from "vitest";
import { makeTripleIdentityCache } from "./servicePreviewIndex";

describe("service preview identity cache", () => {
  it("reuses a tuple and invalidates when any input identity changes", () => {
    const build = vi.fn(() => ({}));
    const get = makeTripleIdentityCache<object, object, object, object>(build);
    const roads = {};
    const buildings = {};
    const residents = {};
    const buildings2 = {};
    const residents2 = {};

    expect(get(roads, buildings, residents)).toBe(get(roads, buildings, residents));
    expect(get(roads, buildings2, residents)).not.toBe(get(roads, buildings, residents));
    expect(get(roads, buildings, residents2)).not.toBe(get(roads, buildings, residents));
    expect(build).toHaveBeenCalledTimes(3);
  });
});
