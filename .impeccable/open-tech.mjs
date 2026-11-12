// Dev-only: dump top-bar control labels and try to open the research screen.
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
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
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true }, S)).result.value;
const clickJs = async (expression) => {
  const p = await evalJs(`(() => { const e = ${expression}; if(!e) return null; const b = e.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`);
  if (!p) return false;
  const { x, y } = JSON.parse(p);
  for (const type of ["mousePressed", "mouseReleased"]) { await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: 1 }, S); await sleep(150); }
  return true;
};
if (await evalJs(`!!document.querySelector('.away')`)) { await clickJs(`document.querySelector('.away .btn')`); await sleep(1500); }
console.log("LABELS", await evalJs(`JSON.stringify([...document.querySelectorAll('#ui button')].map(b => b.getAttribute('aria-label')).filter(Boolean).slice(0, 24))`));
const opened = await clickJs(`[...document.querySelectorAll('#ui button')].find(b => (b.getAttribute('aria-label')||'').includes(${JSON.stringify(process.argv[5] ?? "Наука")}))`);
await sleep(2500);
console.log("OPENED", opened, await evalJs(`JSON.stringify({screen: !!document.querySelector('.tech-screen'), rows: document.querySelectorAll('.tl-row').length, groups: [...document.querySelectorAll('.tl-head')].map(h=>h.textContent.trim())})`));
if (process.argv[3]) {
  const { writeFileSync } = await import("node:fs");
  const snap = async (path) => {
    const shot = await send("Page.captureScreenshot", { format: "png" }, S);
    writeFileSync(path, Buffer.from(shot.data, "base64"));
  };
  await snap(process.argv[3]);
  // switch to the second era and prove the register follows
  const switched = await clickJs(`document.querySelectorAll('.tech-rail .tr-era')[1]`);
  await sleep(1200);
  console.log("ERA2", switched, await evalJs(`JSON.stringify({title: document.querySelector('.tl-era-title')?.textContent, groups: [...document.querySelectorAll('.tl-head')].map(h=>h.textContent.trim()), rows: document.querySelectorAll('.tl-row').length})`));
  if (process.argv[4]) await snap(process.argv[4]);
}
await send("Target.closeTarget", { targetId });
ws.close();
