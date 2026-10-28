import { describe, expect, it, vi } from "vitest";
import { makeIdentityCache } from "./roadNetCache";

describe("identity cache", () => {
  it("builds once per object identity", () => {
    const build = vi.fn(() => ({}));
    const get = makeIdentityCache<object, object>(build);
    const a = {};
    const b = {};

    expect(get(a)).toBe(get(a));
    expect(get(b)).toBe(get(b));
    expect(get(a)).not.toBe(get(b));
    expect(build).toHaveBeenCalledTimes(2);
  });
});
