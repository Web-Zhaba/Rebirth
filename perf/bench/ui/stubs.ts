// Installs the few browser globals src/simClient.ts touches at import time (Worker, document, window listeners), so the
// signal graph can be loaded in plain Node. Import this module FIRST: the imports of a test run in source order.
const g = globalThis as unknown as Record<string, unknown>;
if (!g.localStorage) {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
if (!g.Worker) {
  g.Worker = class {
    name = "";
    onmessage: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  };
}
if (!g.document) {
  const el = () => ({ style: {}, addEventListener() {}, append() {}, remove() {}, querySelector: () => null, closest: () => null, tagName: "DIV" });
  g.document = {
    addEventListener() {},
    removeEventListener() {},
    createElement: el,
    createTextNode: el,
    body: el(),
    documentElement: el(),
    getElementById: () => null,
    querySelector: () => null,
    visibilityState: "visible",
  };
}
if (!g.addEventListener) {
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
}
if (!g.requestAnimationFrame) g.requestAnimationFrame = () => 0;
if (!g.cancelAnimationFrame) g.cancelAnimationFrame = () => {};

export {};
