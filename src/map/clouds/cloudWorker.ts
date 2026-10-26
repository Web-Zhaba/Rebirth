import { buildBaseNoise, buildDetailNoise } from "./noise3d";
import { buildCubeFace, FACES, stormCells } from "./weatherCube";

// Worker that builds the weather cube and the noise volumes (PLAN-clouds.md section 4). No three.js, plain buffers.

export type ToCloudWorker =
  | { t: "cube"; id: number; t0: number; seed: number; phase: number; size: number }
  | { t: "noise"; id: number };

export type FromCloudWorker =
  | { t: "cube"; id: number; t0: number; faces: ArrayBuffer[]; storms: { counts: number[]; cells: Float32Array } }
  | { t: "noise"; id: number; base: ArrayBuffer; detail: ArrayBuffer }
  | { t: "error"; id: number; message: string };

// Pure message handler (exported so tests need no real Worker): the reply and the buffers to transfer with it.
export function handleCloudMessage(msg: ToCloudWorker): { out: FromCloudWorker; transfer: ArrayBuffer[] } {
  try {
    if (msg.t === "cube") {
      const data: Uint8Array[] = [];
      const counts: number[] = [];
      for (let f = 0; f < FACES; f++) {
        const d = new Uint8Array(msg.size * msg.size * 4);
        counts.push(buildCubeFace(f, msg.size, msg.t0, msg.seed, msg.phase, d));
        data.push(d);
      }
      const cells = stormCells(data, msg.size);
      const faces = data.map((d) => d.buffer as ArrayBuffer);
      return { out: { t: "cube", id: msg.id, t0: msg.t0, faces, storms: { counts, cells } }, transfer: faces };
    }
    if (msg.t === "noise") {
      const base = buildBaseNoise().buffer as ArrayBuffer;
      const detail = buildDetailNoise().buffer as ArrayBuffer;
      return { out: { t: "noise", id: msg.id, base, detail }, transfer: [base, detail] };
    }
    throw new Error("unknown message");
  } catch (e) {
    const id = (msg as { id?: number }).id ?? -1;
    return { out: { t: "error", id, message: e instanceof Error ? e.message : String(e) }, transfer: [] };
  }
}

// Only wire up inside a real worker scope (tests import this module in Node).
declare const WorkerGlobalScope: { new (): unknown } | undefined;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof (WorkerGlobalScope as unknown as new () => object)) {
  const scope = self as unknown as { onmessage: ((e: MessageEvent<ToCloudWorker>) => void) | null; postMessage(m: unknown, transfer: ArrayBuffer[]): void };
  scope.onmessage = (e) => {
    const { out, transfer } = handleCloudMessage(e.data);
    scope.postMessage(out, transfer);
  };
}
