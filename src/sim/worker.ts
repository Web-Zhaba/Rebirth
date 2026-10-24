/// <reference lib="webworker" />
import { Handler } from "./handler";
import { idbStorage } from "./idbStorage";
import type { FromWorker, ToWorker } from "./protocol";

const post = (msg: FromWorker) => self.postMessage(msg);
const handler = new Handler(idbStorage, post);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  void handler.handle(e.data);
};

// No-op until a save is loaded or founded.
setInterval(() => handler.tick(Date.now()), 1000);
