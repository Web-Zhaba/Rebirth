import type { Storage } from "./handler";
import type { SaveV4 } from "./types";

type Operation =
  | { type: "get" | "clear" }
  | { type: "put"; save: SaveV4 }
  | { type: "keepOld"; raw: unknown; version: number };

type Request = Operation & { id: number };
type Reply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

// The worker owns the save lock and validates the data. The main thread supplies the platform's storage API.
export function serveSaveStorage(port: MessagePort, storage: Storage): void {
  let queue = Promise.resolve();
  port.onmessage = ({ data }: MessageEvent<Request>) => {
    queue = queue.then(async () => {
      try {
        let value: unknown;
        switch (data.type) {
          case "get":
            value = await storage.get();
            break;
          case "put":
            await storage.put(data.save);
            break;
          case "clear":
            await storage.clear();
            break;
          case "keepOld":
            await storage.keepOld?.(data.raw, data.version);
            break;
        }
        port.postMessage({ id: data.id, ok: true, value } satisfies Reply);
      } catch (error) {
        port.postMessage({ id: data.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Reply);
      }
    });
  };
}

const SAVE_PORT_WAIT_MS = 15_000;

export function remoteSaveStorage(port: MessagePort): Storage {
  let nextId = 1;
  const pending = new Map<number, (reply: Reply) => void>();
  port.onmessage = ({ data }: MessageEvent<Reply>) => pending.get(data.id)?.(data);

  function request(operation: Operation): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => finish({ id, ok: false, error: "Save storage did not respond" }), SAVE_PORT_WAIT_MS);
      function finish(reply: Reply) {
        clearTimeout(timer);
        pending.delete(id);
        if (reply.ok) resolve(reply.value);
        else reject(new Error(reply.error));
      }
      pending.set(id, finish);
      try {
        port.postMessage({ ...operation, id } satisfies Request);
      } catch (error) {
        finish({ id, ok: false, error: String(error) });
      }
    });
  }

  return {
    get: () => request({ type: "get" }),
    put: async (save) => { await request({ type: "put", save }); },
    clear: async () => { await request({ type: "clear" }); },
    keepOld: async (raw, version) => { await request({ type: "keepOld", raw, version }); },
  };
}
