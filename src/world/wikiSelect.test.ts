import { describe, expect, it } from "vitest";
import { makeFrame } from "./frame";
import type { WikiArticle } from "./wiki";
import { articleId, selectArticleHits, UNLOCK_EXTRA } from "./wikiSelect";

const frame = makeFrame(59.12, 37.9);
const at = (x: number, y: number, pageid: number, lang: "ru" | "en" = "ru"): WikiArticle => {
  const [lng, lat] = frame.toLngLat(x, y);
  return { pageid, title: `T${pageid}`, lat, lng, dist: 0, lang };
};
const disc = { x: 0, y: 0, r: 60 };

describe("selectArticleHits", () => {
  it("keeps hits inside a disc grown by the margin, drops the rest", () => {
    const hits = [at(10, 0, 1), at(109, 0, 2), at(111, 0, 3), at(0, -105, 4), at(0, -115, 5)];
    expect(selectArticleHits(hits, [disc], frame, new Set(), 50).map((h) => h.pageid)).toEqual([1, 2, 4]);
  });
  it("grows discs by 300 m by default", () => {
    expect(UNLOCK_EXTRA).toBe(300);
    const hits = [at(359, 0, 1), at(361, 0, 2)];
    expect(selectArticleHits(hits, [disc], frame, new Set()).map((h) => h.pageid)).toEqual([1]);
  });
  it("tests every disc and skips known ids and duplicates", () => {
    const far = { x: 500, y: 0, r: 20 };
    const hits = [at(520, 0, 1), at(530, 0, 2), at(540, 0, 2), at(580, 0, 3), at(480, 0, 4, "en"), at(480, 0, 4)];
    const out = selectArticleHits(hits, [disc, far], frame, new Set(["ru:2"]), 50);
    expect(out.map(articleId)).toEqual(["ru:1", "en:4", "ru:4"]);
  });
  it("selects nothing without discs", () => {
    expect(selectArticleHits([at(0, 0, 1)], [], frame, new Set())).toEqual([]);
  });
});
