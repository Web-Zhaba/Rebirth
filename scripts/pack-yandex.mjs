// Checks a Yandex Games build against the archive rules (https://yandex.ru/dev/games/doc/ru/console/add-new-game):
// index.html at the root, at most 100 MB unpacked, file names without spaces or non-ASCII, relative asset paths.
// Lists the external hosts the bundle mentions: the ones the game actually fetches must be requested on the
// console's CSP tab. With an output path, also writes the zip for the console.
// Usage: node scripts/pack-yandex.mjs <build dir> [out.zip]
//
// The zip is written here rather than by an OS tool: Windows PowerShell 5.1 `Compress-Archive` stores entry names
// with backslashes (`assets\index.js`), which the portal serves as files named that way, so every asset 404s.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const MAX_BYTES = 100 * 1024 * 1024;
// Hosts the Yandex Games CSP allows by default, and link-only hosts (credits) the game never fetches.
const KNOWN = [/(^|\.)yandex\.[a-z]+$/, /(^|\.)yandex\.net$/, /^yastatic\.net$/, /^www\.w3\.org$/];

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/pack-yandex.mjs <build dir> [out.zip]");
  process.exit(2);
}

const files = [];
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(dir);

const errors = [];
const rel = (p) => relative(dir, p).replaceAll("\\", "/");

if (!files.some((p) => rel(p) === "index.html")) errors.push("index.html is not at the archive root");

const total = files.reduce((n, p) => n + statSync(p).size, 0);
if (total > MAX_BYTES) errors.push(`unpacked size ${(total / 1048576).toFixed(1)} MB is over 100 MB`);

for (const p of files) {
  if (!/^[\x21-\x7e]+$/.test(rel(p))) errors.push(`file name with a space or non-ASCII character: ${rel(p)}`);
}

const html = readFileSync(join(dir, "index.html"), "utf8");
for (const m of html.matchAll(/\b(?:src|href)="(\/[^"/][^"]*)"/g)) errors.push(`absolute path in index.html: ${m[1]}`);

const hosts = new Map();
for (const p of files.filter((p) => /\.(js|css|html)$/.test(p))) {
  for (const m of readFileSync(p, "utf8").matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (KNOWN.some((re) => re.test(host))) continue;
    hosts.set(host, (hosts.get(host) ?? new Set()).add(rel(p)));
  }
}

console.log(`${files.length} files, ${(total / 1048576).toFixed(2)} MB unpacked`);
if (hosts.size) {
  console.log("External hosts in the bundle (request the fetched ones on the CSP tab; links in credits need nothing):");
  for (const [h, where] of [...hosts].sort()) console.log(`  ${h}  (${[...where].join(", ")})`);
}
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log("Yandex Games archive checks passed.");

const out = process.argv[3];
if (out) {
  writeFileSync(out, zip(files.map((p) => ({ name: rel(p), data: readFileSync(p) }))));
  console.log(`Wrote ${out} (${(statSync(out).size / 1048576).toFixed(2)} MB)`);
}

// A plain deflate zip with forward-slash entry names (the only separator the format allows).
function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01, fixed so the same build gives the same zip
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // made by
    local.copy(head, 6, 4, 30); // version needed .. name length: same fields as the local header
    // extra, comment, disk, internal and external attributes stay 0
    head.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
