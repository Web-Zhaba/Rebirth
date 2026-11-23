// Cold-start network measurement of the built page, through the Chrome DevTools Protocol.
// No puppeteer: Node 22's global fetch + WebSocket speak CDP directly.
// Run (with `npx vite preview --host 127.0.0.1 --port 4188` serving dist/):
//   node perf/bench/coldstart/cdp-coldstart.mjs http://127.0.0.1:4188/ perf/bench/coldstart/coldstart.json
//
// Records every network request the page makes with the bytes Chrome actually received, then reports what was
// transferred before the first contentful paint, before `load`, and before the game's own UI first rendered.
// Limitation: headless Chrome on this machine exposes the WebGPU API, but the adapter may still be software —
// the numbers are the network side of the cold start, not GPU frame times.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:4188/";
const outFile = process.argv[3] ?? "perf/bench/coldstart/coldstart.json";
const PORT = 9335;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const profile = mkdtempSync(join(tmpdir(), "coldstart-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--enable-unsafe-webgpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let version;
for (let i = 0; i < 150; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) { version = await r.json(); break; }
  } catch {}
  await sleep(150);
}
if (!version) throw new Error("devtools endpoint never came up");
const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let navigatedFrame = null;
let nextId = 1;
const pending = new Map();
const requests = new Map();
const lifecycle = {};
const consoleLines = [];
const t0 = Date.now();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id); return; }
  const at = Date.now() - t0;
  const p = msg.params;
  if (msg.method === "Network.requestWillBeSent") {
    requests.set(p.requestId, { url: p.request.url, type: p.type, at, bytes: 0, status: null, mime: null });
  } else if (msg.method === "Network.responseReceived") {
    const r = requests.get(p.requestId);
    if (r) { r.status = p.response.status; r.mime = p.response.mimeType; r.fromCache = p.response.fromDiskCache === true; }
  } else if (msg.method === "Network.loadingFinished") {
    const r = requests.get(p.requestId);
    if (r) r.bytes = p.encodedDataLength;
  } else if (msg.method === "Page.lifecycleEvent") {
    // about:blank (the target is created there) fires its own paint/load events first: keep the navigated frame's.
    if (p.frameId === navigatedFrame) lifecycle[p.name] ??= at;
  } else if (msg.method === "Runtime.consoleAPICalled") {
    consoleLines.push({ at, type: p.type, text: p.args.map((a) => a.value ?? a.description ?? a.type).join(" ") });
  }
};
const send = (method, params = {}) =>
  new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });

await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable", { maxTotalBufferSize: 100_000_000, maxResourceBufferSize: 10_000_000 });
await send("Page.enable");
await send("Page.setLifecycleEventsEnabled", { enabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

const nav = await send("Page.navigate", { url });
navigatedFrame = nav?.frameId ?? null;
if (nav?.errorText) console.log(`navigation error: ${nav.errorText}`);

// Poll the page for the milestones the network log cannot show: the game's canvas and its first UI render.
const evalJson = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `JSON.stringify(${expression})`, returnByValue: true });
  try { return JSON.parse(r?.result?.value ?? "null"); } catch { return null; }
};
const marks = {};
const deadline = Date.now() + 40_000;
while (Date.now() < deadline) {
  const s = await evalJson(`{
    canvas: !!document.querySelector('#map canvas'),
    ui: document.getElementById('ui')?.childElementCount ?? -1,
    unsupported: document.querySelector('.engine-unsupported h1')?.textContent ?? null,
    ready: document.readyState,
  }`);
  const at = Date.now() - t0;
  if (s) {
    if (s.canvas && marks.canvas === undefined) marks.canvas = at;
    if (s.ui > 0 && marks.ui === undefined) marks.ui = at;
    if (s.unsupported && marks.unsupported === undefined) marks.unsupported = { at, text: s.unsupported };
    if (s.ready === "complete" && marks.complete === undefined) marks.complete = at;
  }
  if (marks.ui !== undefined && marks.complete !== undefined) break;
  await sleep(100);
}
// A few more seconds so the worker chain and the first terrain pages show up in the log.
await sleep(4000);
const paint = await evalJson(`performance.getEntriesByType('paint').map(e => [e.name, e.startTime])`);
const fontProbe = await evalJson(`{
  checks: [
    ["800 16px Bitter", "Ж"],
    ["800 16px Bitter", "R"],
    ["400 16px Bitter", "Ж"],
    ["400 16px 'Golos Text'", "Ж"],
    ["400 16px 'Golos Text'", "R"],
    ["700 16px 'Golos Text'", "Ж"],
  ].map(([f, t]) => f + " / " + t + " -> " + document.fonts.check(f, t)),
  loadedFiles: performance.getEntriesByType('resource').filter(e => e.initiatorType === 'css' || /\.woff2?$/.test(e.name)).map(e => [e.name.split('/').pop(), Math.round(e.transferSize), Math.round(e.duration)]),
  resources: performance.getEntriesByType('resource').map(e => [e.name.replace(location.origin, ''), Math.round(e.transferSize), Math.round(e.responseEnd), e.initiatorType]),
}`);
const pageState = await evalJson(`{
  canvas: !!document.querySelector('#map canvas'),
  unsupported: document.querySelector('.engine-unsupported h1')?.textContent ?? null,
  uiChildren: document.getElementById('ui')?.childElementCount ?? -1,
  webgpu: !!navigator.gpu,
  faces: [...document.fonts].map(f => f.family + ' ' + f.weight + ' ' + f.status),
}`);

const list = [...requests.values()];
const sum = (a) => a.reduce((s, r) => s + (r.bytes || 0), 0);
const fcp = paint?.find(([n]) => n === "first-contentful-paint")?.[1] ?? lifecycle.firstContentfulPaint;
const fp = paint?.find(([n]) => n === "first-paint")?.[1] ?? lifecycle.firstPaint;
const line = (r) => `${(r.bytes / 1024).toFixed(1).padStart(7)} ${String(r.at).padStart(6)}ms ${String(r.status).padStart(4)} ${String(r.type).padEnd(15)} ${r.url.replace(url.replace(/\/$/, ""), "")}`;
const upTo = (ms) => (ms === undefined ? [] : list.filter((r) => r.at <= ms));

const report = { url, chrome: version.Browser, marks: { ...marks, firstPaint: fp, firstContentfulPaint: fcp, ...lifecycle }, pageState, fontProbe, paint, console: consoleLines, requests: list };
writeFileSync(outFile, JSON.stringify(report, null, 2));

console.log(`\n=== CDP cold start of ${url} (${version.Browser}) ===`);
console.log(`first paint ${fp?.toFixed(0) ?? "?"} ms · first contentful paint ${fcp?.toFixed(0) ?? "?"} ms · ` +
  `canvas ${marks.canvas ?? "?"} ms · UI rendered ${marks.ui ?? "?"} ms · load ${lifecycle.load ?? "?"} ms`);
console.log(`page: ${JSON.stringify(pageState)}`);
console.log(`font coverage: ${JSON.stringify(fontProbe?.checks)}`);
console.log(`fonts fetched: ${JSON.stringify(fontProbe?.loadedFiles)}`);
if (consoleLines.length) console.log(`console: ${consoleLines.slice(0, 5).map((c) => `${c.at}ms ${c.text}`).join(" | ")}`);

for (const [label, ms] of [["first contentful paint", fcp], ["load", lifecycle.load], ["game UI rendered", marks.ui], ["end of log", Infinity]]) {
  const set = upTo(ms === Infinity ? 1e9 : ms);
  console.log(`\n--- requests before ${label} (${ms === Infinity ? "all" : `${ms.toFixed?.(0) ?? ms} ms`}): ${set.length}, ${(sum(set) / 1024).toFixed(1)} KiB`);
  console.log("    KiB    at     code type            url");
  for (const r of set.sort((a, b) => a.at - b.at)) console.log(line(r));
}
console.log(`\nwrote ${outFile}`);
ws.close();
chrome.kill();
await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
