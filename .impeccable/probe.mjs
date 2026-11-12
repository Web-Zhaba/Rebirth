// Dev-only: report console errors and the mounted DOM from headless Chrome.
const url = process.argv[2] ?? "http://localhost:5173/";
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
  if (m.method === "Runtime.consoleAPICalled")
    logs.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
  if (m.method === "Runtime.exceptionThrown")
    logs.push("EXCEPTION: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  if (m.method === "Log.entryAdded") logs.push(`log.${m.params.entry.level}: ${m.params.entry.text}`);
};
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: S } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, S);
await send("Runtime.enable", {}, S);
await send("Log.enable", {}, S);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, S);
await send("Page.navigate", { url }, S);
await sleep(9000);
const probe = await send(
  "Runtime.evaluate",
  {
    expression: `JSON.stringify({
      body: document.body.innerHTML.slice(0, 400),
      ui: document.querySelector('#ui')?.innerHTML.slice(0,200),
      gl: (()=>{try{return !!document.createElement('canvas').getContext('webgl2')}catch(e){return 'throw:'+e.message}})(),
      size: [window.innerWidth, window.innerHeight]
    })`,
    returnByValue: true,
  },
  S,
);
console.log("PROBE", probe.result.value);
console.log("LOGS:\n" + (logs.join("\n") || "(none)"));
await send("Target.closeTarget", { targetId });
ws.close();
