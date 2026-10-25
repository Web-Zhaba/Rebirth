// @ts-expect-error node typings are not installed; vitest runs this file in Node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrast, PALETTE, type PaletteKey } from "./palette";

const P = PALETTE;
const SURFACES: PaletteKey[] = ["paper", "paperRaised", "paperShade"];

// Text colors against every surface they sit on (WCAG AA, 4.5:1 for normal text).
const TEXT: [PaletteKey, PaletteKey[]][] = [
  ["ink", [...SURFACES, "paperSunk", "okFill", "warnFill", "badFill", "infoFill"]],
  ["ink2", SURFACES],
  ["pencil", SURFACES],
  ["okText", [...SURFACES, "okFill"]],
  ["warnText", [...SURFACES, "warnFill"]],
  ["bad", [...SURFACES, "badFill"]],
  ["info", [...SURFACES, "infoFill"]],
  ["paper", ["ink", "ink2", "bad"]], // primary button and badge text
  ["duskInk", ["dusk"]],
];

// Components and signals (focus ring, status borders, icons): 3:1.
const UI: [PaletteKey, PaletteKey[]][] = [
  ["info", ["paper", "paperRaised"]], // focus ring
  ["ink", ["paper"]],
  ["warn", ["paper", "paperRaised"]],
  ["bad", ["paper", "paperRaised"]],
  ["ok", ["paper", "paperRaised"]],
  ["kbdBorder", ["paper"]],
];

const hex = (k: PaletteKey) => P[k];

describe("contrast of the palette (WCAG AA)", () => {
  for (const [fg, bgs] of TEXT) {
    for (const bg of bgs) {
      it(`text ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const [fg, bgs] of UI) {
    for (const bg of bgs) {
      it(`component ${fg} on ${bg} is at least 3:1`, () => {
        expect(contrast(hex(fg), hex(bg))).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("labels", () => {
  it("every <IconButton> carries a label", () => {
    const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const bad: string[] = [];
    for (const file of sources(decodeURIComponent(root))) {
      const text: string = readFileSync(file, "utf8");
      for (const m of text.matchAll(/<IconButton\b([^>]*?)\/?>/gs)) {
        if (!/\blabel=/.test(m[1]) || /\blabel=(""|\{""\})/.test(m[1])) bad.push(`${file}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
