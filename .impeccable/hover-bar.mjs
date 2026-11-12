// Dev-only: hover a build tile, then pick it and move the pointer away — checks states and the tooltip.
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const { writeFileSync } = await import("node:fs");
const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (m, p = {}, s) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } };
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
await send("Page.navigate", { url }, S);
await sleep(9000);
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true }, S)).result.value;
const point = async (expr) => { const p = await ev(`(() => { const e = ${expr}; if(!e) return null; const b = e.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`); return p ? JSON.parse(p) : null; };
const move = async (x, y) => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, S); await sleep(200); };
const clickAt = async (x, y) => { for (const type of ["mousePressed", "mouseReleased"]) { await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: 1 }, S); await sleep(140); } };
const snap = async (p) => { const s = await send("Page.captureScreenshot", { format: "png" }, S); writeFileSync(p, Buffer.from(s.data, "base64")); };

if (await ev(`!!document.querySelector('.away')`)) { const a = await point(`document.querySelector('.away .btn')`); if (a) await clickAt(a.x, a.y); await sleep(1200); }
const sel = process.argv[3] ?? document.querySelectorAll('.bb-items .build-btn')[1];
const tile = await point(sel);
await move(tile.x, tile.y);
await sleep(700);
await snap(".impeccable/review-hover.png");
await clickAt(tile.x, tile.y);
await sleep(400);
await move(760, 430);
await sleep(900);
console.log("STATE", await ev(`JSON.stringify({
  tooltips: [...document.querySelectorAll('.bb-items .tooltip')].filter(t => getComputedStyle(t).display !== 'none').length,
  selected: !!document.querySelector('.build-btn.on'),
  tabsW: Math.round(document.querySelector('.bb-tabs').getBoundingClientRect().width),
  panelW: Math.round(document.querySelector('.bb-panel').getBoundingClientRect().width)
})`));
await snap(".impeccable/review-selected.png");
await send("Target.closeTarget", { targetId });
ws.close();
