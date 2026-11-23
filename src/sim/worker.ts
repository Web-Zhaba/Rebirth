/// <reference lib="webworker" />
import { POLL_MS } from "./clock";
import { Handler, type Storage } from "./handler";
import { idbStorage } from "./idbStorage";
import type { FromWorker, ToWorker } from "./protocol";
import { remoteSaveStorage } from "./savePort";
import { worldElevation, worldSampler } from "./worldSampler";

const post = (msg: FromWorker) => self.postMessage(msg);
let portalStorage: Storage;
const storage: Storage = import.meta.env.VITE_PLATFORM === "crazygames" ? {
  get: () => portalStorage.get(),
  put: (save) => portalStorage.put(save),
  clear: () => portalStorage.clear(),
  keepOld: async (raw, version) => { await portalStorage.keepOld?.(raw, version); },
} : idbStorage;
const handler = new Handler(storage, post, worldSampler, worldElevation);
let ownsSave = false;
let opening = false;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (ownsSave || msg.t === "speed" || msg.t === "visibility") {
    void handler.handle(msg);
  } else if (msg.t === "load" && !opening) {
    opening = true;
    void openSession(msg);
  }
};

async function openSession(msg: Extract<ToWorker, { t: "load" }>): Promise<void> {
  try {
    await navigator.locks.request("rebirth-save", { ifAvailable: true }, async (lock) => {
      if (!lock) {
        msg.savePort?.close();
        post({ t: "loadFailed", reason: "locked" });
        return;
      }
      if (import.meta.env.VITE_PLATFORM === "crazygames") {
        if (!msg.savePort) {
          post({ t: "loadFailed", reason: "unavailable" });
          return;
        }
        portalStorage = remoteSaveStorage(msg.savePort);
      }
      ownsSave = true;
      await handler.handle(msg);
      // The browser releases this lock when the worker leaves. Hiding the tab must keep its save ownership.
      await new Promise<void>(() => {});
    });
  } catch (e) {
    msg.savePort?.close();
    console.error("save lock:", e);
    post({ t: "loadFailed", reason: "unavailable" });
  }
}

// No-op until a save is loaded or founded.
setInterval(() => handler.tick(Date.now()), POLL_MS);
