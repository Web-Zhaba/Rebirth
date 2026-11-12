// Bakes the biome map: the RESOLVE Ecoregions 2017 polygons (Dinerstein et al. 2017,
// CC BY 4.0, https://storage.googleapis.com/teow2016/Ecoregions2017.zip) rasterised onto an equirectangular grid as
// one 8-bit class id per pixel (src/world/biomes.ts BIOMES, ids from 1), written as a greyscale PNG. The sea and lakes
// take the class of the nearest land, since the drape's coastline (OSM) differs from RESOLVE's and water is decided
// by the drape alone.
// Usage: node scripts/bake-biomes.mjs <Ecoregions2017 .shp/.dbf path without extension> [out.png] [preview.png]
//
// The shapefile, dBase and PNG formats are read and written here directly: the script runs once per dataset update,
// and the three formats need about as much code as wiring a library would.
import { readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const W = 4096;
const H = 2048;

// RESOLVE BIOME_NUM -> game class id (src/world/biomes.ts BIOMES, same order). Unlisted numbers (lakes) stay 0.
const CLASS_OF = {
  1: 1, // tropical moist broadleaf -> rainforest
  2: 2, // tropical dry broadleaf -> dry tropical forest
  3: 2, // tropical conifer -> dry tropical forest
  7: 3, // tropical grassland, savanna -> savanna
  4: 4, // temperate broadleaf and mixed
  5: 5, // temperate conifer
  6: 6, // boreal forest -> taiga
  8: 7, // temperate grassland -> steppe
  9: 8, // flooded grassland -> swamp
  10: 9, // montane grassland -> mountain meadow
  11: 10, // tundra
  12: 11, // mediterranean
  13: 12, // desert and xeric shrubland
  14: 13, // mangroves
};
const ICE = 14; // the "Rock and Ice" ecoregion (its BIOME_NUM is N/A)

// Preview colours (the far colours of src/world/biomes.ts), for checking the bake by eye.
const PREVIEW = [
  "#16324c", "#1f3a1c", "#3d4a26", "#7a7140", "#33482a", "#26362a", "#263224", "#77754a",
  "#3f5236", "#6b6a4d", "#6a6a55", "#5d6040", "#a08a5c", "#2b4028", "#dfe8e6",
];

const [base, out = "src/world/biomes.png", preview] = process.argv.slice(2);
if (!base) {
  console.error("usage: node scripts/bake-biomes.mjs <Ecoregions2017 path without extension> [out.png] [preview.png]");
  process.exit(2);
}

// dBase records: the fields we need, as trimmed strings.
function readDbf(buf, names) {
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields = [];
  for (let o = 32, at = 1; buf[o] !== 0x0d; o += 32) {
    const name = buf.toString("latin1", o, o + 11).replace(/\0.*$/, "");
    const len = buf[o + 16];
    fields.push({ name, at, len });
    at += len;
  }
  const want = names.map((n) => fields.find((f) => f.name === n) ?? (() => { throw new Error(`no field ${n}`); })());
  const rows = [];
  for (let i = 0; i < count; i++) {
    const r = headerLen + i * recordLen;
    rows.push(Object.fromEntries(want.map((f) => [f.name, buf.toString("utf8", r + f.at, r + f.at + f.len).trim()])));
  }
  return rows;
}

// Polygon records (type 5): for each, the flat [lng, lat, ...] ring of every part.
function* readShp(buf) {
  for (let o = 100; o < buf.length; ) {
    const len = buf.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = buf.readInt32LE(c);
    const rings = [];
    if (type === 5) {
      const parts = buf.readInt32LE(c + 36);
      const points = buf.readInt32LE(c + 40);
      const pts = c + 44 + parts * 4;
      for (let p = 0; p < parts; p++) {
        const from = buf.readInt32LE(c + 44 + p * 4);
        const to = p + 1 < parts ? buf.readInt32LE(c + 48 + p * 4) : points;
        const r = new Float64Array((to - from) * 2);
        for (let i = from; i < to; i++) {
          r[(i - from) * 2] = buf.readDoubleLE(pts + i * 16);
          r[(i - from) * 2 + 1] = buf.readDoubleLE(pts + i * 16 + 8);
        }
        rings.push(r);
      }
    }
    yield rings;
    o = c + len;
  }
}

// Even-odd scanline fill of one feature's rings at pixel centres, edges bucketed by row.
function fill(grid, rings, id) {
  const rows = new Map();
  for (const r of rings) {
    const n = r.length;
    for (let a = 0, b = n - 2; a < n; b = a, a += 2) {
      const xa = ((r[a] + 180) / 360) * W;
      const ya = ((90 - r[a + 1]) / 180) * H;
      const xb = ((r[b] + 180) / 360) * W;
      const yb = ((90 - r[b + 1]) / 180) * H;
      if (ya === yb) continue;
      const j0 = Math.max(0, Math.ceil(Math.min(ya, yb) - 0.5));
      const j1 = Math.min(H - 1, Math.ceil(Math.max(ya, yb) - 0.5) - 1);
      for (let j = j0; j <= j1; j++) {
        const cy = j + 0.5;
        let xs = rows.get(j);
        if (!xs) rows.set(j, (xs = []));
        xs.push(xa + ((cy - ya) * (xb - xa)) / (yb - ya));
      }
    }
  }
  for (const [j, xs] of rows) {
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil(xs[s] - 0.5));
      const i1 = Math.min(W, Math.ceil(xs[s + 1] - 0.5));
      grid.fill(id, j * W + i0, j * W + i1);
    }
  }
}

// Every 0 pixel takes the class of the nearest classed one: breadth-first from all of them at once, wrapping east-west.
function fillWater(grid) {
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i]) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++];
    const x = i % W;
    const y = (i - x) / W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      const k = ny * W + ((x + dx + W) % W);
      if (!grid[k]) {
        grid[k] = grid[i];
        queue[tail++] = k;
      }
    }
  }
}

function png(width, height, channels, pixels) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 2;
  const stride = width * channels;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); // filter 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const rows = readDbf(readFileSync(`${base}.dbf`), ["ECO_NAME", "BIOME_NUM", "BIOME_NAME"]);
const grid = Buffer.alloc(W * H);
const seen = new Map();
let n = 0;
for (const rings of readShp(readFileSync(`${base}.shp`))) {
  const row = rows[n++];
  const id = row.ECO_NAME === "Rock and Ice" ? ICE : (CLASS_OF[Number(row.BIOME_NUM)] ?? 0);
  const key = `${row.BIOME_NUM} ${row.BIOME_NAME} -> ${id}`;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  if (id && rings.length) fill(grid, rings, id);
}
for (const [k, c] of [...seen].sort()) console.log(`${String(c).padStart(4)}  ${k}`);
const landMask = Buffer.from(grid);
const land = grid.reduce((s, v) => s + (v ? 1 : 0), 0);
fillWater(grid);
const file = png(W, H, 1, grid);
writeFileSync(out, file);
console.log(`${n} ecoregions, ${((land / grid.length) * 100).toFixed(1)}% land pixels, ${out}: ${(file.length / 1024).toFixed(0)} KB`);

if (preview) {
  // Half size, the sea in blue (PREVIEW[0]) so the coast reads.
  const pw = W / 2;
  const ph = H / 2;
  const rgb = Buffer.alloc(pw * ph * 3);
  const hex = PREVIEW.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const i = y * 2 * W + x * 2;
      rgb.set(hex[landMask[i] ? grid[i] : 0], (y * pw + x) * 3);
    }
  writeFileSync(preview, png(pw, ph, 3, rgb));
}
