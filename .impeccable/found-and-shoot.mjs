// Dev-only: found a town in the isolated headless profile, then capture the in-game frame.
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const out = process.argv[3] ?? ".impeccable/review-town.png";
const { writeFileSync } = await import("node:fs");

const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
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
    return;
  }
  if (m.method === "Runtime.exceptionThrown")
    logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? "").slice(0, 200));
};

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
await send("Page.navigate", { url }, S);
await sleep(9000);

const click = async (x, y) => {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: 1 }, S);
    await sleep(140);
  }
};
const has = async (sel) => {
  const r = await send("Runtime.evaluate", { expression: `!!document.querySelector(${JSON.stringify(sel)})`, returnByValue: true }, S);
  return r.result.value;
};
const rect = async (sel) => {
  const r = await send(
    "Runtime.evaluate",
    { expression: `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const b = e.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2,w:b.width,h:b.height}); })()`, returnByValue: true },
    S,
  );
  return r.result.value ? JSON.parse(r.result.value) : null;
};

// Click land, not ocean: the founding sheet only opens on dry ground.
for (const [x, y] of [[700, 380], [760, 430], [640, 420], [820, 500]]) {
  await click(x, y);
  await sleep(2500);
  if (await has(".found")) break;
}
await sleep(1200);
await send("Runtime.evaluate", { expression: `document.querySelector('.found input')?.focus()` }, S);
await sleep(300);
await send("Input.insertText", { text: "Лесной" }, S);
await sleep(500);
const btn = await rect(".found .btn");
if (!btn) {
  console.log("NO FOUNDING BUTTON — screenshotting whatever is there");
} else {
  await click(btn.x, btn.y);
}
await sleep(12000);

const probe = await send(
  "Runtime.evaluate",
  {
    expression: `(() => {
      const q = (s) => document.querySelector(s);
      const txt = (s) => q(s)?.textContent?.trim().slice(0,60) ?? null;
      return JSON.stringify({
        topbar: !!q('.topbar'), city: txt('.city-name'), date: txt('.city-date'),
        stats: [...document.querySelectorAll('.bar-stat')].length,
        firstStat: txt('.bar-stat .stat-num'),
        speed: [...document.querySelectorAll('.speed button')].map(b=>b.textContent.trim()).join('$'),
        buildbar: !!q('.build-bar'), tabs: [...document.querySelectorAll('.bb-tabs .tab')].map(b=>b.textContent.trim().split('\\n')[0]).join('|'),
        items: [...document.querySelectorAll('.build-btn')].length,
        sideCol: !!q('.side-col'), warns: [...document.querySelectorAll('.warn-chip')].map(w=>w.textContent.trim()).slice(0,3),
        found: !!q('.found'),
        fps: !!q('.fps')
      });
    })()`,
    returnByValue: true,
  },
  S,
);
console.log("TOWN", probe.result.value);
console.log("LOGS", logs.slice(0, 4).join(" | ") || "(none)");

const shot = await send("Page.captureScreenshot", { format: "png" }, S);
writeFileSync(out, Buffer.from(shot.data, "base64"));
await send("Target.closeTarget", { targetId });
ws.close();
