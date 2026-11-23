// Which @fontsource subset files the browser actually fetches for Cyrillic and Latin glyphs, per family and weight.
// Answers: do the per-subset CSS files (no unicode-range) make the browser download more, and is any face missing?
// Run (with `npx vite preview --host 127.0.0.1 --port 4188` serving dist/):
//   node perf/bench/coldstart/font-probe.mjs http://127.0.0.1:4188/
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:4188/";
const PORT = 9336;
const profile = mkdtempSync(join(tmpdir(), "fontprobe-"));
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
   "--no-default-browser-check", "--disable-extensions", "--enable-unsafe-webgpu", "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let version;
for (let i = 0; i < 150; i++) {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) { version = await r.json(); break; } } catch {}
  await sleep(150);
}
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url });
await sleep(8000); // the UI is up by then (measured: ~300 ms) and the engine has drawn its first frames

const probe = await send("Runtime.evaluate", {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const seen = () => performance.getEntriesByType('resource')
      .filter(e => /\\.woff2?$/.test(e.name)).map(e => e.name.split('/').pop());
    const before = seen();
    const out = [];
    for (const family of ["Bitter", "'Golos Text'"]) {
      for (const w of [400, 500, 600, 700, 800]) {
        const got = [];
        for (const [label, text] of [["cyr", "Ж"], ["lat", "R"]]) {
          const faces = await document.fonts.load(w + " 16px " + family, text);
          got.push(label + ":" + faces.length);
        }
        out.push(family + " " + w + " -> " + got.join(" "));
      }
    }
    const after = seen();
    const fresh = after.filter(f => !before.includes(f));
    // A rendered width per face: Cyrillic in a face that has no Cyrillic falls back to the system font,
    // so the width of "ЖЖЖ" differs from the width in the family that does have it.
    const cv = document.createElement('canvas').getContext('2d');
    const widths = [];
    for (const [family, w] of [["Bitter", 400], ["Bitter", 800], ["'Golos Text'", 400], ["'Golos Text'", 700]]) {
      cv.font = w + " 32px " + family;
      widths.push(family + " " + w + " ЖЖЖ=" + cv.measureText("ЖЖЖ").width.toFixed(1) + " RRR=" + cv.measureText("RRR").width.toFixed(1));
    }
    cv.font = "32px serif";
    widths.push("serif ЖЖЖ=" + cv.measureText("ЖЖЖ").width.toFixed(1) + " RRR=" + cv.measureText("RRR").width.toFixed(1));
    return JSON.stringify({ before, after, fresh, loadResults: out, widths,
      faces: [...document.fonts].map(f => f.family + " " + f.weight + " " + f.style + " " + f.status) }, null, 1);
  })()`,
});
console.log(`\n=== font probe (${version?.Browser}) ===`);
console.log(probe?.result?.value ?? JSON.stringify(probe));
ws.close(); chrome.kill(); await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
