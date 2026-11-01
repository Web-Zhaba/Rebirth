import { describe, expect, it } from "vitest";
import { DEFAULT_RETRY, isMissing, RequestScheduler, retryDelay } from "./scheduler";

function setup(opt: { maxInFlight?: number; cancelAfterFrames?: number } = {}) {
  let now = 0;
  const started: [number, number][] = []; // [id, key]
  const cancelled: number[] = [];
  const s = new RequestScheduler(
    { start: (id, key) => started.push([id, key]), cancel: (id) => cancelled.push(id) },
    { maxInFlight: 2, cancelAfterFrames: 10, now: () => now, ...opt },
  );
  const frame = (want: [number, number][]) => {
    s.beginFrame();
    for (const [k, p] of want) s.want(k, p);
    s.pump();
  };
  const idOf = (key: number) => started.filter(([, k]) => k === key).at(-1)![0];
  return { s, started, cancelled, frame, idOf, advance: (ms: number) => (now += ms) };
}

describe("retry policy", () => {
  it("backs off exponentially up to a ceiling and gives up after the last attempt", () => {
    const p = { baseMs: 1000, maxMs: 5000, maxAttempts: 5 };
    expect([1, 2, 3, 4].map((n) => retryDelay(n, p))).toEqual([1000, 2000, 4000, 5000]);
    expect(retryDelay(5, p)).toBeNull();
    expect(retryDelay(1)).toBe(DEFAULT_RETRY.baseMs);
  });

  it("treats a missing tile as an answer, not an error", () => {
    for (const st of [404, 403, 410]) expect(isMissing(st)).toBe(true);
    for (const st of [0, 500, 502, 503, 429, 408]) expect(isMissing(st)).toBe(false);
  });
});

describe("request scheduler", () => {
  it("keeps in-flight bounded and starts the most urgent first", () => {
    const { s, started, frame } = setup();
    frame([
      [10, 5],
      [11, 1],
      [12, 3],
    ]);
    expect(started.map(([, k]) => k)).toEqual([11, 12]);
    expect(s.inFlight).toBe(2);
    frame([[10, 5]]);
    expect(started.length).toBe(2); // full
  });

  it("retries a transient failure after the backoff, not before", () => {
    const { s, started, frame, idOf, advance } = setup();
    frame([[7, 0]]);
    expect(s.failed(idOf(7), 503)).toBe("backoff");
    frame([[7, 0]]);
    expect(started.length).toBe(1);
    advance(DEFAULT_RETRY.baseMs - 1);
    frame([[7, 0]]);
    expect(started.length).toBe(1);
    advance(1);
    frame([[7, 0]]);
    expect(started.length).toBe(2);
    expect(s.retries).toBe(1);
    expect(s.succeeded(idOf(7))).toBe(7);
    expect(s.state(7)).toBe("idle");
  });

  it("gives up after the attempt cap and stops asking", () => {
    const { s, started, frame, idOf, advance } = setup();
    for (let a = 0; a < DEFAULT_RETRY.maxAttempts; a++) {
      frame([[7, 0]]);
      s.failed(idOf(7), 0);
      advance(60_000);
    }
    expect(s.state(7)).toBe("failed");
    expect(s.isDead(7)).toBe(true);
    const n = started.length;
    frame([[7, 0]]);
    expect(started.length).toBe(n);
    expect(n).toBe(DEFAULT_RETRY.maxAttempts);
  });

  it("does not retry a missing tile", () => {
    const { s, started, frame, idOf, advance } = setup();
    frame([[7, 0]]);
    expect(s.failed(idOf(7), 404)).toBe("missing");
    advance(60_000);
    frame([[7, 0]]);
    expect(started.length).toBe(1);
    expect(s.isDead(7)).toBe(true);
  });

  it("cancels a request nobody wanted for a while and ignores its late answer", () => {
    const { s, cancelled, started, frame, idOf } = setup({ cancelAfterFrames: 3 });
    frame([[7, 0]]);
    const id = idOf(7);
    frame([[7, 0]]); // still wanted: kept
    for (let f = 0; f < 3; f++) frame([]);
    expect(cancelled).toEqual([]);
    frame([[8, 0]]);
    expect(cancelled).toEqual([id]);
    expect(started.map(([, k]) => k)).toEqual([7, 8]); // the freed slot goes to the new want at once
    expect(s.succeeded(id)).toBeUndefined();
    expect(s.failed(id, 500)).toBeUndefined();
    expect(s.state(7)).toBe("idle"); // wanted again later: fetched again
  });
});
