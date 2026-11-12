// Dev-only: open the town panel in the existing headless town and capture the right slot.
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const out = process.argv[3] ?? ".impeccable/review-panels.png";
const sel = process.argv[4] ?? ".city-name-btn";
const { writeFileSync } = await import("node:fs");
const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(JSON.stringify(m.error)));
    else res(m.result);
  }
};
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
await send("Page.navigate", { url }, S);
await sleep(10000);

const clickSel = async (q) => {
  const r = await send(
    "Runtime.evaluate",
    { expression: `(() => { const e = document.querySelector(${JSON.stringify(q)}); if(!e) return null; const b = e.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`, returnByValue: true },
    S,
  );
  const p = r.result.value ? JSON.parse(r.result.value) : null;
  if (!p) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1, buttons: 1 }, S);
    await sleep(160);
  }
  return true;
};

// The catch-up card covers the screen after the profile sits idle; dismiss it first.
if (await clickSel(".away .btn-primary, .away .btn")) await sleep(1200);
await clickSel(sel);
await sleep(2500);
const probe = await send(
  "Runtime.evaluate",
  {
    expression: `(() => {
      const p = document.querySelector('.rs-panel');
      const b = p ? p.getBoundingClientRect() : null;
      return JSON.stringify({
        panel: !!p, rect: b ? [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)] : null,
        tabs: [...document.querySelectorAll('.rs-panel .tab')].map(t=>t.textContent.trim()).join('|'),
        chips: [...document.querySelectorAll('.rs-panel .chip')].map(c=>c.textContent.trim()).slice(0,4),
        sub: [...document.querySelectorAll('.rs-panel .rs-sub')].map(s=>s.textContent.trim()).slice(0,4),
        scrolls: p ? p.scrollHeight > p.clientHeight + 1 : null
      });
    })()`,
    returnByValue: true,
  },
  S,
);
console.log("PANEL", probe.result.value);
const shot = await send("Page.captureScreenshot", { format: "png" }, S);
writeFileSync(out, Buffer.from(shot.data, "base64"));
await send("Target.closeTarget", { targetId });
ws.close();
