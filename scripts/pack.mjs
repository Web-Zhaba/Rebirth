// Checks a portal build against that portal's archive rules and, with an output path, writes the zip to upload.
// Every portal wants index.html at the root and relative asset paths; names stay ASCII without spaces (Yandex demands
// it, the rest serve such names unreliably). Lists the external hosts the bundle mentions: on Yandex the ones the
// game actually fetches must be requested on the console's CSP tab.
// Usage: node scripts/pack.mjs <yandex|crazygames|itch> <build dir> [out.zip]
//
// The zip is written here rather than by an OS tool: Windows PowerShell 5.1 `Compress-Archive` stores entry names
// with backslashes (`assets\index.js`), which the portals serve as files named that way, so every asset 404s.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const MB = 1024 * 1024;
// Link-only hosts (credits) the game never fetches.
const LINKS = [/^www\.w3\.org$/];
const TARGETS = {
  // https://yandex.ru/dev/games/doc/ru/console/add-new-game
  yandex: { maxBytes: 100 * MB, own: [/(^|\.)yandex\.[a-z]+$/, /(^|\.)yandex\.net$/, /^yastatic\.net$/] },
  // https://docs.crazygames.com/requirements/technical/ (the 50 MB initial-download limit is checked by hand)
  crazygames: { maxBytes: 250 * MB, maxFiles: 1500, own: [/(^|\.)crazygames\.com$/] },
  // https://itch.io/docs/creators/html5
  itch: { maxBytes: 500 * MB, maxFiles: 1000, maxFileBytes: 200 * MB, maxPath: 240, own: [] },
};

const [target, dir, out] = process.argv.slice(2);
const rules = TARGETS[target];
if (!rules || !dir) {
  console.error(`usage: node scripts/pack.mjs <${Object.keys(TARGETS).join("|")}> <build dir> [out.zip]`);
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
if (total > rules.maxBytes) errors.push(`unpacked size ${(total / MB).toFixed(1)} MB is over ${rules.maxBytes / MB} MB`);
if (rules.maxFiles && files.length > rules.maxFiles) errors.push(`${files.length} files, over ${rules.maxFiles}`);

for (const p of files) {
  const name = rel(p);
  if (!/^[\x21-\x7e]+$/.test(name)) errors.push(`file name with a space or non-ASCII character: ${name}`);
  if (rules.maxPath && name.length > rules.maxPath) errors.push(`path over ${rules.maxPath} characters: ${name}`);
  if (rules.maxFileBytes && statSync(p).size > rules.maxFileBytes) errors.push(`file over ${rules.maxFileBytes / MB} MB: ${name}`);
}

const html = readFileSync(join(dir, "index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="(\/[^"/][^"]*)"/g)) errors.push(`absolute path in index.html: ${m[1]}`);

const known = [...rules.own, ...LINKS];
const hosts = new Map();
for (const p of files.filter((p) => /\.(js|css|html)$/.test(p))) {
  for (const m of readFileSync(p, "utf8").matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase();
    if (known.some((re) => re.test(host))) continue;
    hosts.set(host, (hosts.get(host) ?? new Set()).add(rel(p)));
  }
}

console.log(`${target}: ${files.length} files, ${(total / MB).toFixed(2)} MB unpacked`);
if (hosts.size) {
  console.log("External hosts in the bundle (on Yandex, request the fetched ones on the CSP tab; links in credits need nothing):");
  for (const [h, where] of [...hosts].sort()) console.log(`  ${h}  (${[...where].join(", ")})`);
}
if (errors.length) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}
console.log(`${target} archive checks passed.`);

if (out) {
  writeFileSync(out, zip(files.map((p) => ({ name: rel(p), data: readFileSync(p) }))));
  console.log(`Wrote ${out} (${(statSync(out).size / MB).toFixed(2)} MB)`);
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
