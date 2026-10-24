import type { Frame } from "./frame";
import type { Disc } from "./oldworld";
import type { WikiArticle } from "./wiki";

export const UNLOCK_EXTRA = 300; // m a disc is grown by: a dig hints at what lies around it, so small towns get entries too

export const articleId = (a: Pick<WikiArticle, "lang" | "pageid">): string => `${a.lang}:${a.pageid}`;

// Hits that lie inside any disc grown by UNLOCK_EXTRA and are not known yet; deduplicated by id, input order kept.
export function selectArticleHits(hits: readonly WikiArticle[], discs: readonly Disc[], frame: Pick<Frame, "toLocal">, known: ReadonlySet<string>, grow = UNLOCK_EXTRA): WikiArticle[] {
  const out: WikiArticle[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const id = articleId(h);
    if (known.has(id) || seen.has(id)) continue;
    const [x, y] = frame.toLocal(h.lng, h.lat);
    if (!discs.some((d) => Math.hypot(x - d.x, y - d.y) <= d.r + grow)) continue;
    seen.add(id);
    out.push(h);
  }
  return out;
}
