// Dev-only: founding surface at several viewports — does the sheet and its primary action stay usable?
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const sizes = [
  [2560, 1440],
  [1920, 1080],
  [1280, 720],
  [390, 844],
];
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

for (const [w, h] of sizes) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, S);
  await send("Page.navigate", { url }, S);
  await sleep(7000);
  const cx = Math.round(w * 0.62), cy = Math.round(h * 0.5);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: cx, y: cy, button: "left", clickCount: 1, buttons: 1 }, S);
    await sleep(120);
  }
  await sleep(4000);
  const out = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const b = (el) => { if(!el) return null; const r = el.getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),b:Math.round(r.bottom)}; };
        const sheet = document.querySelector('.found-sheet');
        const btn = document.querySelector('.found .btn');
        const sb = b(sheet), bb = b(btn);
        return JSON.stringify({
          vw: innerWidth, vh: innerHeight,
          sheet: sb, btn: bb,
          sheetScrolls: sheet ? sheet.scrollHeight > sheet.clientHeight + 1 : null,
          btnVisible: !!(sb && bb && bb.y >= sb.y && bb.b <= sb.b),
          btnBelowFold: !!(bb && bb.b > innerHeight),
          task: b(document.querySelector('.found-task')),
          hOverflow: document.documentElement.scrollWidth > innerWidth,
          heading: document.querySelector('.found-sheet h2')?.textContent,
          headingSize: getComputedStyle(document.querySelector('.found-sheet h2')).fontSize
        });
      })()`,
      returnByValue: true,
    },
    S,
  );
  console.log(`${w}x${h}`, out.result.value);
}
await send("Target.closeTarget", { targetId });
ws.close();
