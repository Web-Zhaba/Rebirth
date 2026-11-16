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
  // The files left out besides the folders and the balance scenario (src/pace) speak of other things spelt like
  // buildings, each listed with what it is:
  const LISTS = new Set(["/src/map/tools.ts", "/src/ui/buildMenu.ts", "/src/sim/tech.ts", "/src/sim/services.ts"]); // tools and their categories (a single-building tool has the building's id), the tech tree's unlock keys, the services in the order of their coverage bits
  const OSM = new Set(["/src/sim/heritage.ts", "/src/sim/items.ts", "/src/map/heritageModels.ts"]); // OpenStreetMap kinds of old buildings (school, museum, shop...)
  const scanned = Object.entries(sources).filter(([p]) => !p.startsWith("/src/buildings/") && !p.startsWith("/src/pace/") && !p.startsWith("/src/world/") && !/\.test\.tsx?$/.test(p)); // world/: OpenStreetMap tags (orchard, garden)
  const idsIn = (text: string, re: RegExp): string[] => [...new Set([...text.matchAll(re)].map((m) => m[1]).filter((t) => ids.includes(t)))];

  it("are left to the building folders: no comparison with a template id", () => {
    const re = /(?:template|\.id)\s*[!=]==\s*"(\w+)"/g;
    expect(idsIn('b.template === "tavern"; t.id !== "well"', re)).toEqual(["tavern", "well"]);
    expect(scanned.flatMap(([p, text]) => idsIn(text, re).map((t) => `${p}: ${t}`))).toEqual([]);
  });

  it("no switch over template ids", () => {
    const re = /case\s+"(\w+)"\s*:/g;
    expect(idsIn('case "smithy": case "x":', re)).toEqual(["smithy"]);
    expect(scanned.filter(([p]) => !OSM.has(p)).flatMap(([p, text]) => idsIn(text, re).map((t) => `${p}: ${t}`))).toEqual([]);
  });

  // Nor does code elsewhere keep a list or a table of buildings: what some of them do is a field of their rules.
  it("no list of buildings", () => {
    const list = /\[\s*"\w+"(?:\s*,\s*"\w+")+\s*\]/g;
    const found: string[] = [];
    for (const [p, text] of scanned) if (!LISTS.has(p)) for (const m of text.matchAll(list)) if (idsIn(m[0], /"(\w+)"/g).length >= 2) found.push(`${p}: ${m[0]}`);
    expect(found).toEqual([]);
  });

  // The direct keys of each object literal (and interface or type body) of a source, by the brace that opens it.
  function keysByObject(text: string): string[][] {
    const keyAt = new Map<number, string>();
    for (const m of text.matchAll(/[{,;]\s*(\w+)\??\s*:/g)) keyAt.set(m.index! + m[0].indexOf(m[1]), m[1]);
    const open: string[][] = [];
    const out: string[][] = [];
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === "{") open.push([]);
      else if (c === "}") out.push(open.pop() ?? []);
      else if (keyAt.has(i) && open.length) open[open.length - 1].push(keyAt.get(i)!);
    }
    return out;
  }
  const ICONS = "/src/ui/icons.ts"; // the icon library: keyed by icon name (a building's ui.ts picks one)
  it("no table keyed by buildings", () => {
    const keyed = (text: string) => keysByObject(text).map((keys) => [...new Set(keys.filter((k) => ids.includes(k)))]).filter((k) => k.length >= 2);
    expect(keyed("const T = {\n  smithy: 1,\n  pottery: { a: 1 }, other: 3 };\nconst r = { school: 1, x: 2 }; const s = { museum: 0 };")).toEqual([["smithy", "pottery"]]);
    const found = scanned.filter(([p]) => !LISTS.has(p) && !OSM.has(p) && p !== ICONS).flatMap(([p, text]) => keyed(text).map((k) => `${p}: ${k.join(", ")}`));
    expect(found).toEqual([]);
  });
});
