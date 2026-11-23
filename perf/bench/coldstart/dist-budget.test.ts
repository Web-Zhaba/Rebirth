// Bundle-budget guard rails, measured on whatever is in dist/ (read the numbers, do not invent them).
// Run: npx vitest run perf/bench/coldstart/dist-budget.test.ts --reporter=verbose
// Build first: npx vite build
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { constants, gzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../../../dist", import.meta.url));
const exists = existsSync(join(ROOT, "index.html"));

interface F {
  rel: string;
  raw: number;
  gz: number;
}

const files: F[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push({ rel: relative(ROOT, p).replaceAll("\\", "/"), raw: statSync(p).size, gz: gzipSync(readFileSync(p), { level: constants.Z_BEST_COMPRESSION }).length });
  }
};
if (exists) walk(ROOT);

const sum = (a: F[]): number => a.reduce((s, f) => s + f.raw, 0);
const sumGz = (a: F[]): number => a.reduce((s, f) => s + f.gz, 0);
const kb = (n: number): string => (n / 1024).toFixed(1);
const kind = (rel: string): string => {
  const e = extname(rel);
  if (e === ".woff2" || e === ".woff") return "font";
  if (e === ".png" || e === ".svg") return "image";
  if (e === ".css") return "css";
  if (e === ".js") return "js";
  return "other";
};

describe("dist bundle budget", () => {
  it("reports the shipped bytes and their kinds", () => {
    if (!exists) {
      console.log("dist/ is not built; run `npx vite build` first");
      return;
    }
    const byKind = new Map<string, F[]>();
    for (const f of files) byKind.set(kind(f.rel), [...(byKind.get(kind(f.rel)) ?? []), f]);
    console.log("\nkind   files     raw kB    gzip kB   share of dist (gzip)");
    for (const [k, list] of [...byKind].sort((a, b) => sumGz(b[1]) - sumGz(a[1])))
      console.log(`${k.padEnd(6)} ${String(list.length).padStart(5)} ${kb(sum(list)).padStart(10)} ${kb(sumGz(list)).padStart(10)} ${((sumGz(list) / sumGz(files)) * 100).toFixed(1).padStart(8)}%`);
    console.log(`${"ALL".padEnd(6)} ${String(files.length).padStart(5)} ${kb(sum(files)).padStart(10)} ${kb(sumGz(files)).padStart(10)}`);

    const top = [...files].sort((a, b) => b.gz - a.gz).slice(0, 10);
    console.log("\ntop 10 by gzip:");
    for (const f of top) console.log(`${kb(f.gz).padStart(9)} kB gz ${kb(f.raw).padStart(9)} kB raw  ${f.rel}`);

    // The one big chunk is the whole game: if it ever splits, these numbers move and the budget should be re-read.
    const main = files.find((f) => /assets\/main-.*\.js$/.test(f.rel))!;
    const js = files.filter((f) => kind(f.rel) === "js");
    expect(main, "dist has a single main chunk").toBeTruthy();
    expect(Number(kb(main.gz))).toBeGreaterThan(300);
    expect(sumGz(js) / sumGz(files)).toBeGreaterThan(0.4); // JS dominates the shipped bytes
  });

  it("keeps the font assets honest: woff2 only, Bitter 3 weights x 2 subsets, Golos 2 x 2", () => {
    if (!exists) return;
    const fonts = files.filter((f) => kind(f.rel) === "font");
    const woff2 = fonts.filter((f) => f.rel.endsWith(".woff2"));
    const woff = fonts.filter((f) => f.rel.endsWith(".woff"));
    console.log(`\nfonts: ${fonts.length} files, ${kb(sum(fonts))} kB raw — woff2 ${woff2.length}/${kb(sum(woff2))} kB, woff ${woff.length}/${kb(sum(woff))} kB`);
    // 6 Bitter + 4 Golos Text (400 and 700: the single 500 the UI used is gone), cyrillic and latin each.
    expect(woff2.length).toBe(10);
    // A .woff fallback is one no browser that supports woff2 ever asks for: tokens.css declares woff2 only.
    expect(woff.length).toBe(0);
    expect(sum(fonts)).toBeLessThan(140 * 1024); // 127 kB now; 321.5 with the woff fallbacks and Golos 500
  });
});
