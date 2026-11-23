// dist/ inventory: raw / gzip / brotli bytes per file, totals by kind, and the startup (first frame) path.
// Run: node perf/bench/coldstart/analyze-dist.mjs [distDir]
// gzip is zlib.gzipSync(level 9) (the same deflate the servers use for `Content-Encoding: gzip`);
// brotli is zlib.brotliCompressSync with the default quality 11.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

const root = process.argv[2] ?? "dist";
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push({ path: p, rel: relative(root, p).replaceAll("\\", "/"), raw: st.size });
  }
};
walk(root);

for (const f of files) {
  const buf = readFileSync(f.path);
  f.gzip = gzipSync(buf, { level: constants.Z_BEST_COMPRESSION }).length;
  try {
    f.brotli = brotliCompressSync(buf, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }).length;
  } catch {
    f.brotli = null;
  }
}

const kb = (n) => (n / 1024).toFixed(1).padStart(9);
const kindOf = (rel) => {
  const e = extname(rel);
  if (e === ".woff2" || e === ".woff") return "font";
  if (e === ".png") return "image";
  if (e === ".css") return "css";
  if (e === ".js") return "js";
  return "other";
};

files.sort((a, b) => b.raw - a.raw);
console.log("\n=== all dist files (raw, gzip, brotli in KiB) ===");
console.log("  raw(kB)    gzip(kB)  brotli(kB)  kind   file");
for (const f of files) console.log(`${kb(f.raw)} ${kb(f.gzip)} ${kb(f.brotli ?? 0)}  ${kindOf(f.rel).padEnd(6)} ${f.rel}`);

const totals = {};
for (const f of files) {
  const k = kindOf(f.rel);
  totals[k] ??= { n: 0, raw: 0, gzip: 0, brotli: 0 };
  totals[k].n++;
  totals[k].raw += f.raw;
  totals[k].gzip += f.gzip;
  totals[k].brotli += f.brotli ?? 0;
}
console.log("\n=== totals by kind (KiB) ===");
console.log("kind    files    raw       gzip      brotli");
let all = { raw: 0, gzip: 0, brotli: 0, n: files.length };
for (const [k, v] of Object.entries(totals)) {
  console.log(`${k.padEnd(7)} ${String(v.n).padStart(4)} ${kb(v.raw)} ${kb(v.gzip)} ${kb(v.brotli)}`);
  all.raw += v.raw; all.gzip += v.gzip; all.brotli += v.brotli;
}
console.log(`${"ALL".padEnd(7)} ${String(all.n).padStart(4)} ${kb(all.raw)} ${kb(all.gzip)} ${kb(all.brotli)}`);

console.log("\n=== top 10 by raw ===");
for (const f of files.slice(0, 10))
  console.log(`${kb(f.raw)} raw ${kb(f.gzip)} gz ${kb(f.brotli ?? 0)} br  ${f.rel}`);

console.log("\n=== top 10 by gzip ===");
for (const f of [...files].sort((a, b) => b.gzip - a.gzip).slice(0, 10))
  console.log(`${kb(f.gzip)} gz ${kb(f.raw)} raw  ${f.rel}`);

const fonts = files.filter((f) => kindOf(f.rel) === "font");
const byFmt = (ext) => fonts.filter((f) => f.rel.endsWith(ext));
const sum = (arr) => arr.reduce((a, f) => a + f.raw, 0);
console.log("\n=== fonts ===");
console.log(`woff2: ${byFmt(".woff2").length} files, ${kb(sum(byFmt(".woff2")))} KiB raw`);
console.log(`woff : ${byFmt(".woff").length} files, ${kb(sum(byFmt(".woff")))} KiB raw`);
console.log(`all  : ${fonts.length} files, ${kb(sum(fonts))} KiB raw (${((sum(fonts) / all.raw) * 100).toFixed(1)}% of dist)`);
