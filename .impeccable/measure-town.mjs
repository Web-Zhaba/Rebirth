// Dev-only: numeric check of the in-game top bar and build bar (the profile already holds a town).
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
for (const w of [1440, 1600, 1280]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false }, S);
  await send("Page.navigate", { url }, S);
  await sleep(8000);
  const out = await send(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const bar = document.querySelector('.topbar');
        const stats = [...document.querySelectorAll('.bar-stat')];
        const end = document.querySelector('.tb-end');
        const lastStat = stats[stats.length-1];
        const r = (e) => e ? Math.round(e.getBoundingClientRect().right) : null;
        const tabs = [...document.querySelectorAll('.bb-tabs .tab')].map(t => { const b=t.getBoundingClientRect(); return [t.textContent.trim().replace(/\\s+/g,' '), Math.round(b.x), Math.round(b.width)]; });
        return JSON.stringify({
          vw: innerWidth,
          barOverflow: bar ? [bar.clientWidth, bar.scrollWidth, bar.scrollWidth - bar.clientWidth] : null,
          barH: bar ? Math.round(bar.getBoundingClientRect().height) : null,
          statCount: stats.length,
          lastStatRight: r(lastStat),
          endLeft: end ? Math.round(end.getBoundingClientRect().left) : null,
          overlap: end && lastStat ? Math.round(r(lastStat) - end.getBoundingClientRect().left) : null,
          cityW: Math.round(document.querySelector('.tb-city')?.getBoundingClientRect().width ?? 0),
          statsW: Math.round(document.querySelector('.stats')?.getBoundingClientRect().width ?? 0),
          tabsWidth: Math.round(document.querySelector('.bb-tabs')?.getBoundingClientRect().width ?? 0),
          firstTabs: tabs.slice(0,3),
          docOverflow: document.documentElement.scrollWidth - innerWidth
        });
      })()`,
      returnByValue: true,
    },
    S,
  );
  console.log(`${w}px`, out.result.value);
}
await send("Target.closeTarget", { targetId });
ws.close();
