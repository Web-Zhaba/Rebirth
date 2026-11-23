import { describe, expect, it } from "vitest";
import hizWgsl from "./hiz.wgsl?raw";
import { singleSample } from "./hiz";

// The Hi-Z pass is written for a multisampled depth texture; with the antialiasing off the same pass reads a plain one.
// Three lines differ, and they are pinned here: if hiz.wgsl changes shape, the transform has to change with it instead
// of silently leaving the binding multisampled (which is a validation error, and a black canvas).

const SOURCE = ["var depth: texture_depth_multisampled_2d;", "let samples = textureNumSamples(depth);", "textureLoad(depth, p, s)"];
const isSource = (line: string): boolean => SOURCE.some((s) => line.includes(s));

describe("singleSample", () => {
  it("swaps the binding, the sample count and the load", () => {
    const one = singleSample(hizWgsl);
    expect(one).toContain("var depth: texture_depth_2d;");
    expect(one).toContain("let samples = 1u;");
    expect(one).toContain("textureLoad(depth, p, 0)");
    expect(one).not.toContain("texture_depth_multisampled_2d");
    expect(one).not.toContain("textureNumSamples(");
  });

  it("changes those three lines and nothing else", () => {
    const many = hizWgsl.split("\n");
    const one = singleSample(hizWgsl).split("\n");
    expect(one.length).toBe(many.length);
    const differing = many.map((line, i) => (line === one[i] ? -1 : i)).filter((i) => i >= 0);
    expect(differing.length).toBe(3);
    for (const i of differing) expect(isSource(many[i])).toBe(true);
  });

  it("keeps every other line byte for byte: both passes and the comments", () => {
    const many = hizWgsl.split("\n");
    const one = singleSample(hizWgsl).split("\n");
    for (let i = 0; i < many.length; i++) if (!isSource(many[i])) expect(one[i]).toBe(many[i]);
  });
});
