// Dev-only: numeric checks on the rendered founding screen.
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
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
const click = async (x, y) => {
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, buttons: 1 }, S);
    await sleep(120);
  }
};
await click(820, 430);
await sleep(8000);

const expr = `(() => {
  const r = (el) => { if(!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]; };
  const cs = (el, props) => { if(!el) return null; const s = getComputedStyle(el); const o = {}; for (const p of props) o[p] = s.getPropertyValue(p); return o; };
  const attrib = document.querySelector('.maplibregl-ctrl-attrib');
  const sheet = document.querySelector('.found-sheet');
  const btn = document.querySelector('.found .btn');
  return JSON.stringify({
    viewport: [window.innerWidth, window.innerHeight],
    sheet: r(sheet), sheetScroll: sheet ? [sheet.scrollHeight, sheet.clientHeight] : null,
    btn: r(btn), btnText: btn?.textContent,
    attrib: r(attrib), attribStyle: cs(attrib, ['background-color','border-radius','font-size','color']),
    zoomGroup: cs(document.querySelector('.maplibregl-ctrl-group'), ['background-color','border-radius']),
    search: r(document.querySelector('.place-search')),
    task: r(document.querySelector('.found-task')),
    found: r(document.querySelector('.found')),
    overlap: (() => { const a = document.querySelector('.place-search')?.getBoundingClientRect(); const t = document.querySelector('.found-task')?.getBoundingClientRect(); return a && t ? Math.round(a.bottom - t.top) : null; })(),
    fonts: cs(document.querySelector('.found-sheet h2'), ['font-family','font-size','font-weight']),
    bodyBg: cs(document.body, ['background-color'])
  });
})()`;
const out = await send("Runtime.evaluate", { expression: expr, returnByValue: true }, S);
console.log(out.result.value);
await send("Target.closeTarget", { targetId });
ws.close();
