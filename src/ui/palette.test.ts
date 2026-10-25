// @ts-expect-error node typings are not installed; vitest runs this file in Node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mixHex, PALETTE, toKebab } from "./palette";

const css: string = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

describe("palette.ts and tokens.css", () => {
  it("every palette color is a token with the same value", () => {
    for (const [key, value] of Object.entries(PALETTE)) {
      const decl = `--${toKebab(key)}: ${value.toLowerCase()};`;
      expect(css.toLowerCase().includes(decl), `tokens.css lacks "${decl}"`).toBe(true);
    }
  });

  it("mixes colors", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.7)).toBe("#102030");
  });
});
