import { decodeToPage, DEM_SIZE, terrariumUrl } from "./terrarium";

// DEM bake job: fetch a terrarium tile, decode it into a bordered f32 page and hand the buffer back (transferred, no
// copy). The main thread only uploads. N2 grows this into the worker pool of docs/PLAN-engine.md section 3.3.

export interface DemRequest {
  id: number;
  z: number;
  x: number;
  y: number;
}

export type DemResponse =
  | { id: number; ok: true; heights: Float32Array<ArrayBuffer>; blocks: Float32Array<ArrayBuffer>; min: number; max: number; ms: number }
  | { id: number; ok: false; status: number; error: string };

// tsconfig has the DOM lib only (the webworker lib clashes with it), so type the bits of the worker scope we use.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<DemRequest>) => void) | null;
  postMessage(msg: DemResponse, transfer?: Transferable[]): void;
};
const canvas = new OffscreenCanvas(DEM_SIZE, DEM_SIZE);
const ctx = canvas.getContext("2d", { willReadFrequently: true });

scope.onmessage = async (e: MessageEvent<DemRequest>) => {
  const { id, z, x, y } = e.data;
  const t0 = performance.now();
  try {
    if (!ctx) throw new Error("2d context unavailable");
    const res = await fetch(terrariumUrl(z, x, y));
    if (!res.ok) {
      scope.postMessage({ id, ok: false, status: res.status, error: res.statusText } satisfies DemResponse);
      return;
    }
    // No colour management or premultiplication: the RGB bytes encode metres.
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    ctx.clearRect(0, 0, DEM_SIZE, DEM_SIZE);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const page = decodeToPage(ctx.getImageData(0, 0, DEM_SIZE, DEM_SIZE).data);
    const msg: DemResponse = { id, ok: true, heights: page.heights, blocks: page.blocks, min: page.min, max: page.max, ms: performance.now() - t0 };
    scope.postMessage(msg, [page.heights.buffer, page.blocks.buffer]);
  } catch (err) {
    scope.postMessage({ id, ok: false, status: 0, error: String(err) } satisfies DemResponse);
  }
};
