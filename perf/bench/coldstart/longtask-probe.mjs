// What the main thread was doing between the start of the page and its first content paint: long tasks, paints
// and the resource timeline, injected before any of the game's own script runs.
// Run (with `npx vite preview --host 127.0.0.1 --port 4188` serving dist/):
//   node perf/bench/coldstart/longtask-probe.mjs http://127.0.0.1:4188/
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:4188/";
const PORT = 9337;
const profile = mkdtempSync(join(tmpdir(), "ltprobe-"));
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
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__lt = { longtasks: [], paints: [], frames: [] };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); })
      .observe({ entryTypes: ["longtask"] });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.paints.push([e.name, Math.round(e.startTime)]); })
      .observe({ entryTypes: ["paint", "largest-contentful-paint"] });
    // When the game's first animation frame ran, and how long each of the first frames' scripts took.
    const raf = window.requestAnimationFrame;
    window.__lt.firstFrames = [];
    window.requestAnimationFrame = function (cb) {
      return raf.call(window, (t) => {
        const s = performance.now();
        cb(t);
        if (window.__lt.firstFrames.length < 20) window.__lt.firstFrames.push([Math.round(s), Math.round(performance.now() - s)]);
      });
    };
  `,
});
await send("Page.navigate", { url });
await sleep(12_000);
const probe = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `JSON.stringify({
    longtasks: window.__lt.longtasks,
    paints: window.__lt.paints,
    firstFrames: window.__lt.firstFrames,
    nav: (() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), ttfb: Math.round(n.responseStart) } : null; })(),
    longTaskTotal: window.__lt.longtasks.reduce((a, t) => a + t[1], 0),
  })`,
});
const r = JSON.parse(probe?.result?.value ?? "{}");
console.log(`\n=== main-thread probe (${version?.Browser}) ===`);
console.log(`navigation: ${JSON.stringify(r.nav)}`);
console.log(`paints: ${JSON.stringify(r.paints)}`);
console.log(`long tasks > 50 ms: ${r.longtasks?.length ?? 0}, ${r.longTaskTotal ?? 0} ms total (blocking time beyond 50 ms each)`);
for (const [start, dur] of r.longtasks ?? []) console.log(`  ${String(start).padStart(6)} ms  ${String(dur).padStart(5)} ms`);
console.log(`first rAF callbacks (start ms, own duration ms): ${JSON.stringify(r.firstFrames)}`);
ws.close(); chrome.kill(); await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
