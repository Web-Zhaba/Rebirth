// Dev-only: network health for map tiles + what sits at a suspicious point.
const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const version = await (await fetch("http://127.0.0.1:9222/json/version")).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const net = { ok: 0, fail: 0, byHost: {}, failed: [], lastTile: [] };
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
  if (m.method === "Network.responseReceived") {
    const u = m.params.response.url;
    const host = (() => { try { return new URL(u).host; } catch { return "?"; } })();
    net.byHost[host] = (net.byHost[host] ?? 0) + 1;
    if (u.includes("tile") || u.includes("planet")) net.lastTile.push(`${m.params.response.status} ${u.slice(0, 90)}`);
    if (m.params.response.status >= 400) net.failed.push(`${m.params.response.status} ${u.slice(0, 120)}`);
  }
  if (m.method === "Network.loadingFailed") net.fail++;
};
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Network.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
net.lastTile = [];
net.byHost = {};
await send("Page.navigate", { url }, S);
await sleep(12000);
for (const type of ["mousePressed", "mouseReleased"]) {
  await send("Input.dispatchMouseEvent", { type, x: 820, y: 430, button: "left", clickCount: 1, buttons: 1 }, S);
  await sleep(120);
}
await sleep(9000);
const out = await send(
  "Runtime.evaluate",
  {
    expression: `(() => {
      const el = document.elementFromPoint(500, 652);
      const chain = []; let n = el;
      for (let i = 0; n && i < 4; i++, n = n.parentElement) chain.push(n.tagName + '.' + (n.className?.baseVal ?? n.className ?? ''));
      return JSON.stringify({ at: chain, text: el?.textContent?.slice(0,60) });
    })()`,
    returnByValue: true,
  },
  S,
);
console.log("AT_POINT", out.result.value);
console.log("BY_HOST", JSON.stringify(net.byHost));
console.log("FAILED", net.fail, JSON.stringify(net.failed.slice(0, 6)));
console.log("TILES", JSON.stringify(net.lastTile.slice(-6)));
await send("Target.closeTarget", { targetId });
ws.close();
