import type { Storage } from "../sim/handler";

type CrazyData = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
const KEY = "rebirth.town";
const DATA_LIMIT = 1024 * 1024;

// One compressed value keeps each town snapshot atomic and leaves room for mature settlements.
export function crazyGamesStorage(data: CrazyData): Storage {
  return {
    async get() {
      const encoded = data.getItem(KEY);
      if (encoded === null) return null;
      try {
        const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
        const json = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        return JSON.parse(await new Response(json).text());
      } catch {
        return encoded; // Keep the unreadable save available for download in the recovery screen.
      }
    },
    async put(save) {
      const gzip = new Blob([JSON.stringify(save)]).stream().pipeThrough(new CompressionStream("gzip"));
      const bytes = new Uint8Array(await new Response(gzip).arrayBuffer());
      let binary = "";
      for (let start = 0; start < bytes.length; start += 8192) {
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      }
      const encoded = btoa(binary);
      if (encoded.length + JSON.stringify({ [KEY]: "" }).length > DATA_LIMIT) {
        throw new Error("Town save exceeds the CrazyGames Data limit");
      }
      data.setItem(KEY, encoded);
    },
    async clear() {
      data.removeItem(KEY);
    },
  };
}
