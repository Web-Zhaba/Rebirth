import { describe, expect, it } from "vitest";
import { RULES } from "./rules";
import { MODELS } from "./models";
import { UI, BUILDING_TOOLS } from "./ui";
import { PLACE_TOOLS, PLACE_VARIANTS, toolOfTemplate } from "../map/tools";

// How the building folders (src/buildings/<id>/) stay the one place a building lives.

const sources = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const imports = (text: string) => [...text.matchAll(/^import\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)";/gms)].map((m) => ({ typeOnly: !!m[1], from: m[2] }));
const ids = Object.keys(RULES);

describe("building rules", () => {
  // The rules run in the sim worker: they import only leaf modules, so the worker gets no map, interface or renderer
  // code and the registry no import cycle.
  const RULE_FILES = Object.keys(sources).filter((p) => /^\/src\/buildings\/(\w+\/rules|rules|types|workshop)\.ts$/.test(p));
  const LEAVES = new Set(["../../i18n", "../types", "../workshop", "../../sim/weatherSigns", "../sim/weatherSigns"]);
  it("import only leaf modules", () => {
    expect(RULE_FILES.length).toBeGreaterThan(ids.length);
    const bad: string[] = [];
    for (const p of RULE_FILES)
      for (const { typeOnly, from } of imports(sources[p])) {
        const ok = typeOnly ? !/\/(map|ui|view|engine|world)\//.test(from) : LEAVES.has(from) || (p === "/src/buildings/rules.ts" && /^\.\/\w+\/rules$/.test(from));
        if (!ok) bad.push(`${p}: ${from}`);
      }
    expect(bad).toEqual([]);
  });
  it("are filed under their own id", () => {
    for (const [key, r] of Object.entries(RULES)) expect(r.id).toBe(key);
  });
});

describe("building registries", () => {
  it("give every building an interface and a model, or say it is drawn elsewhere", () => {
    expect(Object.keys(UI)).toEqual(ids);
    expect(Object.keys(MODELS)).toEqual(ids);
  });
  it("put every building on the build bar: a tool of its own or a kind of a group tool (a foundation dig has none)", () => {
    for (const id of ids) if (id !== "excavation") expect(toolOfTemplate(id), id).not.toBeNull();
    for (const id of BUILDING_TOOLS) expect(PLACE_TOOLS as string[]).toContain(id);
    for (const kinds of Object.values(PLACE_VARIANTS)) for (const k of kinds) expect(UI[k.id as keyof typeof UI].variant, k.id).toBeDefined();
  });
});

describe("template checks", () => {
  // A building's numbers and rules are in its folder; code elsewhere asks the rules (BUILDINGS[t].needs, .monument,
  // .evenings, isFarm...) or, for a system's own site, the system's constant (DIG.template, MUSEUM.template), instead
  // of comparing a template id. Only the balance scenario (src/pace) names buildings directly.
  it("are left to the building folders", () => {
    const found: string[] = [];
    const re = /(?:template|\.id)\s*[!=]==\s*"(\w+)"/g;
    expect([...'b.template === "tavern"'.matchAll(re)].map((m) => m[1])).toEqual(["tavern"]);
    for (const [p, text] of Object.entries(sources)) {
      if (p.startsWith("/src/buildings/") || p.startsWith("/src/pace/") || /\.test\.tsx?$/.test(p)) continue;
      for (const m of text.matchAll(re)) if (ids.includes(m[1])) found.push(`${p}: ${m[0]}`);
    }
    expect(found).toEqual([]);
  });
});
