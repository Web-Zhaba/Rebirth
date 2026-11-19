import { expect, it, vi } from "vitest";
import type { DemRequest, DemResponse } from "./demWorker";

it("reports a tile deadline as retryable and a camera cancellation separately", async () => {
  const deadline = new AbortController();
  const scope = {
    onmessage: (_event: { data: DemRequest }) => {},
    postMessage: vi.fn<(reply: DemResponse) => void>(),
  };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("fetch", (_url: string, { signal }: { signal: AbortSignal }) =>
    new Promise<Response>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  );
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
  try {
    await import("./demWorker");
    scope.onmessage({ data: { type: "load", id: 1, z: 0, x: 0, y: 0 } });
    deadline.abort(new DOMException("deadline expired", "TimeoutError"));
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1, ok: false, status: 0 })));

    scope.onmessage({ data: { type: "load", id: 2, z: 0, x: 0, y: 0 } });
    scope.onmessage({ data: { type: "cancel", id: 2 } });
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 2, ok: false, status: -1 })));
  } finally {
    timeout.mockRestore();
    vi.unstubAllGlobals();
  }
});
