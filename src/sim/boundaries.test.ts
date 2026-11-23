import { describe, expect, it } from "vitest";

// The sim runs in a Web Worker: its bundle must stay free of UI, view and renderer code. What it may read across the
// layers is a short list of pure leaf modules, pinned here; anything new goes through docs/ARCHITECTURE.md "Known
// cross-layer imports" first.

const sources = import.meta.glob("/src/sim/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const imports = (text: string) => [...text.matchAll(/^import\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)";/gms)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));

// map/ leaves the worker reads: the trip types (sim/life.ts, sim/protocol.ts) and the polygon clip of the heraldry flags.
const MAP_LEAVES = new Set(["../map/life", "../map/geometryClip"]);
// world/ leaves the worker reads: the baked land cover, the DEM sampler and the local metric frame.
const WORLD_LEAVES = new Set(["../world/landcover", "../world/terrain", "../world/frame"]);

describe("sim boundaries", () => {
  it("import no ui, view, engine, platform or pace module", () => {
    const bad: string[] = [];
    for (const [p, text] of Object.entries(sources))
      if (!/\.test\.ts$/.test(p)) // tests may assert through the UI's pure view models (findsView, museumView...)
        for (const { from } of imports(text)) if (/^(?:\.\.\/)+(ui|view|engine|platform|pace)(\/|$)/.test(from)) bad.push(`${p}: ${from}`);
    expect(bad).toEqual([]);
  });

  it("read only the agreed map and world leaves", () => {
    const bad: string[] = [];
    for (const [p, text] of Object.entries(sources))
      if (!/\.test\.ts$/.test(p))
        for (const { from } of imports(text)) {
          if (from.startsWith("../map/") && !MAP_LEAVES.has(from)) bad.push(`${p}: ${from}`);
          if (from.startsWith("../world/") && !WORLD_LEAVES.has(from)) bad.push(`${p}: ${from}`);
        }
    expect(bad).toEqual([]);
  });

  it("stay plain logic: no preact or signals", () => {
    const bad = Object.keys(sources).filter((p) => /from\s+"(preact|@preact\/signals)"/.test(sources[p]));
    expect(bad).toEqual([]);
  });
});
