import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { vectorTileUrl } from "../../world/tiles";
import { DRAPE_SIZE, packDrape, paintDrape, parseSource, sourceOf, type DrapeSource } from "./drape";

// Drape bake job (bake/drape.ts): fetch the page's OpenMapTiles source tile (cached here: the 16 pages under a z12 tile
// share it), paint colour and water mask, hand the pixels back transferred. Same request protocol as the DEM worker.

export type DrapeRequest = { type: "load"; id: number; z: number; x: number; y: number } | { type: "cancel"; id: number };

export type DrapeResponse = { id: number; ok: true; rgba: Uint8Array<ArrayBuffer>; ms: number } | { id: number; ok: false; status: number; error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DrapeRequest>) => void) | null;
  postMessage(msg: DrapeResponse, transfer?: Transferable[]): void;
};

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const SOURCES = 48;
const sources = new Map<string, Promise<DrapeSource>>(); // insertion order = LRU order
const jobs = new Map<number, AbortController>();
const colour = new OffscreenCanvas(DRAPE_SIZE, DRAPE_SIZE).getContext("2d", { willReadFrequently: true })!;
const water = new OffscreenCanvas(DRAPE_SIZE, DRAPE_SIZE).getContext("2d", { willReadFrequently: true })!;

// Shared by the pages under one source tile, so it is not aborted with any one job; a cancelled job just drops its page.
function source(z: number, x: number, y: number): Promise<DrapeSource> {
  const key = `${z}/${x}/${y}`;
  let p = sources.get(key);
  if (p) {
    sources.delete(key);
    sources.set(key, p);
    return p;
  }
  p = (async () => {
    const res = await fetch(await vectorTileUrl(z, x, y));
    // No tile (204/404): open ocean far from any coast. Reported as missing, so the ancestor page (which has the ocean
    // polygon) stands in instead of a meadow-coloured sea.
    if (res.status === 204) throw new HttpError(404);
    if (!res.ok) throw new HttpError(res.status);
    return parseSource(new VectorTile(new PbfReader(await res.arrayBuffer())));
  })();
  sources.set(key, p);
  p.catch(() => sources.get(key) === p && sources.delete(key));
  while (sources.size > SOURCES) sources.delete(sources.keys().next().value!);
  return p;
}

scope.onmessage = (e: MessageEvent<DrapeRequest>) => {
  const m = e.data;
  if (m.type === "cancel") {
    jobs.get(m.id)?.abort();
    return;
  }
  void load(m.id, m.z, m.x, m.y);
};

async function load(id: number, z: number, x: number, y: number): Promise<void> {
  const t0 = performance.now();
  const abort = new AbortController();
  jobs.set(id, abort);
  try {
    const s = sourceOf(z, x, y);
    const src = await source(s.z, s.x, s.y);
    if (abort.signal.aborted) throw new DOMException("aborted", "AbortError");
    paintDrape(colour, water, src, z, x, y);
    const rgba = packDrape(colour.getImageData(0, 0, DRAPE_SIZE, DRAPE_SIZE).data, water.getImageData(0, 0, DRAPE_SIZE, DRAPE_SIZE).data);
    scope.postMessage({ id, ok: true, rgba, ms: performance.now() - t0 }, [rgba.buffer]);
  } catch (err) {
    const status = abort.signal.aborted ? -1 : err instanceof HttpError ? err.status : 0;
    scope.postMessage({ id, ok: false, status, error: String(err) } satisfies DrapeResponse);
  } finally {
    jobs.delete(id);
  }
}
