import type { Storage } from "./handler";
import type { SaveV3 } from "./types";

const STORE = "save";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("rebirth", 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export const idbStorage: Storage = {
  get: () => run("readonly", (s) => s.get(KEY)),
  put: async (save: SaveV3) => {
    await run("readwrite", (s) => s.put(save, KEY));
  },
  clear: async () => {
    await run("readwrite", (s) => s.delete(KEY));
  },
};
