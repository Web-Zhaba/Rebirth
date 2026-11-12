import { decodePng } from "../../world/pngDecoder";
import { decodeToPage, DEM_SIZE, terrariumUrl } from "./terrarium";

// DEM bake job: fetch a terrarium tile, decode it into a bordered f32 page and hand the buffer back (transferred, no
// copy). The main thread only uploads. Requests can be cancelled (the fetch is aborted); a cancelled job answers with
// status -1.

export type DemRequest = { type: "load"; id: number; z: number; x: number; y: number } | { type: "cancel"; id: number };

export type DemResponse =
  | { id: number; ok: true; heights: Float32Array<ArrayBuffer>; blocks: Float32Array<ArrayBuffer>; min: number; max: number; ms: number }
  | { id: number; ok: false; status: number; error: string };

// tsconfig has the DOM lib only (the webworker lib clashes with it), so type the bits of the worker scope we use.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DemRequest>) => void) | null;
  postMessage(msg: DemResponse, transfer?: Transferable[]): void;
};
const jobs = new Map<number, AbortController>();

scope.onmessage = (e: MessageEvent<DemRequest>) => {
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
    const res = await fetch(terrariumUrl(z, x, y), { signal: abort.signal });
    if (!res.ok) {
      scope.postMessage({ id, ok: false, status: res.status, error: res.statusText } satisfies DemResponse);
      return;
    }
    const png = await decodePng(await res.arrayBuffer());
    if (abort.signal.aborted) throw new DOMException("aborted", "AbortError");
    if (png.width !== DEM_SIZE || png.height !== DEM_SIZE) {
      throw new Error(`Unexpected Terrarium tile size: ${png.width}x${png.height}`);
    }
    // Terrarium stores elevation in the original PNG RGB bytes. Never route these values through a colour-managed image.
    const page = decodeToPage(png.rgba);
    const msg: DemResponse = { id, ok: true, heights: page.heights, blocks: page.blocks, min: page.min, max: page.max, ms: performance.now() - t0 };
    scope.postMessage(msg, [page.heights.buffer, page.blocks.buffer]);
  } catch (err) {
    const cancelled = abort.signal.aborted;
    scope.postMessage({ id, ok: false, status: cancelled ? -1 : 0, error: String(err) } satisfies DemResponse);
  } finally {
    jobs.delete(id);
  }
}
