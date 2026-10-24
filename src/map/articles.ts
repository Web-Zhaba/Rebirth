import { effect } from "@preact/signals";
import type { ArticleInput } from "../sim/protocol";
import { articles, digs, frame, sendCmd } from "../simClient";
import type { Disc } from "../world/oldworld";
import { articlesNear, extracts, type WikiArticle } from "../world/wiki";
import { articleId, selectArticleHits, UNLOCK_EXTRA } from "../world/wikiSelect";
import { discsChanged } from "./excavation";

// Wikipedia entries for the notebook (PLAN.md section 13): articles whose coordinates fall near a revealed disc.
const SEARCH_EXTRA = UNLOCK_EXTRA; // m added to the disc radius for the geosearch
const EXTRACT_CHARS = 800;
const SEND_BATCH = 50;
const DEBOUNCE_MS = 1000;
const RETRY_MS = 30_000;

const discsOf = (): Disc[] => digs.peek().map((d) => ({ x: d.x, y: d.y, r: d.r }));

// Finds Wikipedia articles near the dig discs and hands new ones to the simulation. Network failures are
// silent: the game goes on and the next disc change (or the retry timer) tries again.
export function attachArticles(): void {
  let applied: Disc[] | null = null;
  let timer = 0;
  let running = false;
  let retryAt = 0;

  async function refresh(): Promise<void> {
    timer = 0;
    const f = frame.peek();
    if (!f || running) return;
    const discs = discsOf();
    if (!discsChanged(applied, discs)) return;
    running = true;
    try {
      const hits: WikiArticle[] = [];
      for (const d of discs) {
        const [lng, lat] = f.toLngLat(d.x, d.y);
        hits.push(...(await articlesNear(lat, lng, d.r + SEARCH_EXTRA)));
      }
      const picked = selectArticleHits(hits, discs, f, new Set(articles.peek().map((a) => a.id)));
      const payload: ArticleInput[] = [];
      for (const lang of ["ru", "en"] as const) {
        const group = picked.filter((h) => h.lang === lang);
        if (group.length === 0) continue;
        const text = await extracts(group.map((h) => h.pageid), lang);
        for (const h of group) {
          const e = text.get(h.pageid);
          if (e) payload.push({ id: articleId(h), title: e.title, extract: e.extract.slice(0, EXTRACT_CHARS), url: e.url, lang, lat: h.lat, lng: h.lng });
        }
      }
      for (let i = 0; i < payload.length; i += SEND_BATCH) {
        const r = await sendCmd({ type: "addArticles", articles: payload.slice(i, i + SEND_BATCH) });
        if (!r.ok) throw new Error(r.reason);
      }
      applied = discs;
    } catch {
      retryAt = Date.now() + RETRY_MS;
    } finally {
      running = false;
    }
    schedule();
  }

  function schedule(): void {
    if (timer || running) return;
    if (!discsChanged(applied, discsOf())) return;
    timer = window.setTimeout(() => void refresh(), Math.max(DEBOUNCE_MS, retryAt - Date.now()));
  }

  effect(() => {
    void digs.value;
    void frame.value;
    schedule();
  });
}
