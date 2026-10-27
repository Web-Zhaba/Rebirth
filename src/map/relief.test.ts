import { describe, expect, it } from "vitest";
import { reliefOrder, type Anchor } from "./relief";

const L = (id: string, type: string) => ({ id, type });
const ids = (s: string) => s.split(" ").map((id) => L(id, id.startsWith("f") ? "fill" : "custom"));

describe("reliefOrder", () => {
  it("puts the draped layers first and the others above them in their flat order", () => {
    const anchors = new Map<string, Anchor>();
    expect(reliefOrder(ids("f1 label f2 models trees f3 clouds f4 lamps f5 marker"), anchors)).toEqual("f1 f2 f3 f4 f5 label models trees clouds lamps marker".split(" "));
  });
  it("leaves a grouped order alone", () => {
    expect(reliefOrder(ids("f1 f2 models"), new Map())).toBeNull();
  });
  it("places a layer added later before a draped layer where it would go on the flat map", () => {
    const anchors = new Map<string, Anchor>();
    expect(reliefOrder(ids("f1 foutline f2 fnight lights"), anchors)).toBeNull();
    // the clouds arrive first (before "fnight"), then the models and the trees (before "foutline")
    const a = reliefOrder(ids("f1 foutline f2 clouds fnight lights"), anchors)!;
    expect(a).toEqual("f1 foutline f2 fnight clouds lights".split(" "));
    const b = reliefOrder(ids("f1 models trees foutline f2 fnight clouds lights"), anchors)!;
    expect(b).toEqual("f1 foutline f2 fnight models trees clouds lights".split(" "));
    // the window lamps arrive before the lights, above every draped layer: they stay under the lights
    expect(reliefOrder(ids("f1 foutline f2 fnight models trees clouds lamps lights"), anchors)).toBeNull();
    // and with the relief off they go back under the layer they were added before
    expect(anchors.get("lamps")).toMatchObject({ before: anchors.get("lights")!.before });
    expect(anchors.get("lamps")!.seq).toBeLessThan(anchors.get("lights")!.seq);
  });
});
