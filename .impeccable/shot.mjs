// Dev-only screenshot helper (not shipped): drives headless Chrome over CDP to capture the real app.
// Usage: node .impeccable/shot.mjs <url> <out.png> <clickX> <clickY> <waitAfterClickMs>
import { writeFileSync } from "node:fs";

const [url, out, cx = "820", cy = "430", waitMs = "5000"] = process.argv.slice(2);

const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];

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
  } else if (m.method) events.push(m);
};

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const S = sessionId;

await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
await send("Page.navigate", { url }, S);
await sleep(9000);

const click = async (x, y) => {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: 1 }, S);
    await sleep(120);
  }
};
await click(Number(cx), Number(cy));
await sleep(Number(waitMs));

const shot = await send("Page.captureScreenshot", { format: "png" }, S);
writeFileSync(out, Buffer.from(shot.data, "base64"));

const probe = await send(
  "Runtime.evaluate",
  {
    expression: `JSON.stringify({
      found: !!document.querySelector('.found'),
      sheet: !!document.querySelector('.found-sheet'),
      search: !!document.querySelector('.place-search'),
      task: document.querySelector('.found-task')?.textContent?.trim(),
      h2: document.querySelector('.found-sheet h2')?.textContent,
      facts: [...document.querySelectorAll('.found-facts dt')].map(n=>n.textContent).join('|'),
      tags: [...document.querySelectorAll('.chip-btn')].map(n=>n.textContent).join('|'),
      btn: document.querySelector('.found .btn')?.textContent?.trim(),
      canvas: !!document.querySelector('#map canvas'),
      scroll: [document.documentElement.scrollWidth, window.innerWidth]
    })`,
    returnByValue: true,
  },
  S,
);
console.log("PROBE", probe.result.value);
await send("Target.closeTarget", { targetId });
ws.close();
