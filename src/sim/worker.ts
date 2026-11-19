/// <reference lib="webworker" />
import { POLL_MS } from "./clock";
import { Handler } from "./handler";
import { idbStorage } from "./idbStorage";
import type { FromWorker, ToWorker } from "./protocol";
import { worldElevation, worldSampler } from "./worldSampler";

const post = (msg: FromWorker) => self.postMessage(msg);
const handler = new Handler(idbStorage, post, worldSampler, worldElevation);
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
        post({ t: "loadFailed", reason: "locked" });
        return;
      }
      ownsSave = true;
      await handler.handle(msg);
      // The browser releases this lock when the worker leaves. Hiding the tab must keep its save ownership.
      await new Promise<void>(() => {});
    });
  } catch (e) {
    console.error("save lock:", e);
    post({ t: "loadFailed", reason: "unavailable" });
  }
}

// No-op until a save is loaded or founded.
setInterval(() => handler.tick(Date.now()), POLL_MS);
