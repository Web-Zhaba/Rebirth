import { addChronicle } from "./chronicle";
import type { ArticleInput } from "./protocol";
import type { SimState, StoredArticle } from "./types";

// Wikipedia articles unlocked by digs (PLAN.md section 13).
export const ARTICLE_CAP = 500;
export const EXTRACT_MAX = 800;
const BATCH_MAX = 100;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const ID = /^(ru|en):[1-9]\d{0,11}$/;

// One article record as sent or saved (without `at`); null when malformed. The extract is trimmed to the cap.
function clean(v: unknown): Omit<StoredArticle, "at"> | null {
  if (!isRec(v) || !isStr(v.id, 40) || !ID.test(v.id) || !isStr(v.title, 300) || typeof v.extract !== "string" || v.extract.length === 0) return null;
  if (v.lang !== "ru" && v.lang !== "en") return null;
  if (!v.id.startsWith(`${v.lang}:`)) return null;
  if (!isStr(v.url, 300) || !v.url.startsWith(`https://${v.lang}.wikipedia.org/`)) return null;
  if (!finite(v.lat) || !finite(v.lng) || Math.abs(v.lat) > 90 || Math.abs(v.lng) > 180) return null;
  return { id: v.id, title: v.title, extract: v.extract.slice(0, EXTRACT_MAX), url: v.url, lang: v.lang, lat: v.lat, lng: v.lng };
}

export type ArticlesResult = { ok: true; sim: SimState } | { ok: false; reason: string };

// Stores new articles (ids already stored are ignored), up to the cap, and writes one chronicle line each.
// Returns the same state when nothing was new.
export function addArticles(s: SimState, cmd: { articles: ArticleInput[] }): ArticlesResult {
  if (!isRec(cmd) || !Array.isArray(cmd.articles) || cmd.articles.length > BATCH_MAX) return { ok: false, reason: "Некорректные статьи" };
  const list: Omit<StoredArticle, "at">[] = [];
  for (const a of cmd.articles) {
    const c = clean(a);
    if (!c) return { ok: false, reason: "Некорректная статья" };
    list.push(c);
  }
  const at = s.gameMinutes;
  const have = new Set(s.articles.map((a) => a.id));
  const added: StoredArticle[] = [];
  let chronicle = s.chronicle;
  for (const a of list) {
    if (have.has(a.id) || s.articles.length + added.length >= ARTICLE_CAP) continue;
    have.add(a.id);
    added.push({ ...a, at });
    chronicle = addChronicle(chronicle, at, "article", `В записной книжке: «${a.title}»`);
  }
  if (added.length === 0) return { ok: true, sim: s };
  return { ok: true, sim: { ...s, articles: [...s.articles, ...added], chronicle } };
}

// Broken records are dropped one by one; a broken articles record is an empty list, never a lost town.
export function parseArticles(v: unknown): StoredArticle[] {
  if (!Array.isArray(v)) return [];
  const out: StoredArticle[] = [];
  const seen = new Set<string>();
  for (const r of v) {
    const c = clean(r);
    if (!c || seen.has(c.id) || !isRec(r) || !finite(r.at)) continue;
    seen.add(c.id);
    out.push({ ...c, at: r.at });
    if (out.length >= ARTICLE_CAP) break;
  }
  return out;
}
