import { describe, expect, it } from "vitest";
import { QueryRing, type QueryPoll } from "./queryRing";

function make(answers: Record<string, QueryPoll>, maxOpen?: number) {
  const released: string[] = [];
  const ring = new QueryRing<string>((q) => answers[q] ?? "pending", (q) => released.push(q), maxOpen);
  return { ring, released };
}

describe("QueryRing", () => {
  it("collects finished queries in issue order", () => {
    const a: Record<string, QueryPoll> = { a: 1, b: 2 };
    const { ring } = make(a);
    ring.add("a");
    ring.add("b");
    ring.add("c");
    ring.drain();
    expect(ring.samples).toEqual([1, 2]);
    expect(ring.pending).toBe(1);
    a.c = 3;
    ring.drain();
    expect(ring.samples).toEqual([1, 2, 3]);
  });

  it("does not skip past a pending query", () => {
    const { ring } = make({ b: 2 });
    ring.add("a");
    ring.add("b");
    ring.drain();
    expect(ring.samples).toEqual([]);
    expect(ring.pending).toBe(2);
  });

  it("counts disjoint results as lost and releases them", () => {
    const { ring, released } = make({ a: "lost", b: 5 });
    ring.add("a");
    ring.add("b");
    ring.drain();
    expect(ring.lost).toBe(1);
    expect(ring.samples).toEqual([5]);
    expect(released).toEqual(["a", "b"]);
  });

  it("drops the oldest when the driver never answers", () => {
    const { ring, released } = make({}, 2);
    ["a", "b", "c"].forEach((q) => ring.add(q));
    expect(released).toEqual(["a"]);
    expect(ring.lost).toBe(1);
    expect(ring.pending).toBe(2);
  });

  it("flush gives up on what is still pending", () => {
    const { ring } = make({ a: 1 });
    ring.add("a");
    ring.add("b");
    ring.flush();
    expect(ring.samples).toEqual([1]);
    expect(ring.lost).toBe(1);
    expect(ring.pending).toBe(0);
  });
});
