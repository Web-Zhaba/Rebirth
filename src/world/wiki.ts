// Wikipedia client: geosearch + intro extracts. Text is CC BY-SA 4.0 (link back to the page).

export type WikiLang = "ru" | "en";
export interface WikiHit {
  pageid: number;
  title: string;
  lat: number;
  lng: number;
  dist: number;
}
export interface WikiExtract {
  title: string;
  extract: string;
  url: string;
}
export interface WikiArticle extends WikiHit {
  lang: WikiLang;
}

const MIN_RADIUS = 10;
const MAX_RADIUS = 10000;
const BATCH = 20;

const api = (lang: WikiLang) => `https://${lang}.wikipedia.org/w/api.php`;
export const pageUrl = (lang: WikiLang, pageid: number) => `https://${lang}.wikipedia.org/?curid=${pageid}`;

export function geoUrl(lat: number, lng: number, radiusM: number, lang: WikiLang): string {
  const r = Math.round(Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, radiusM)));
  return `${api(lang)}?action=query&list=geosearch&gscoord=${lat}%7C${lng}&gsradius=${r}&gslimit=50&format=json&origin=*`;
}

export function extractsUrl(pageids: number[], lang: WikiLang): string {
  return `${api(lang)}?action=query&prop=extracts&exintro=1&explaintext=1&exchars=800&pageids=${pageids.join("%7C")}&format=json&origin=*`;
}

export function parseGeo(json: unknown): WikiHit[] {
  const list = (json as { query?: { geosearch?: Record<string, unknown>[] } } | null)?.query?.geosearch;
  if (!Array.isArray(list)) return [];
  const out: WikiHit[] = [];
  for (const g of list) {
    if (typeof g.pageid === "number" && typeof g.title === "string" && typeof g.lat === "number" && typeof g.lon === "number")
      out.push({ pageid: g.pageid, title: g.title, lat: g.lat, lng: g.lon, dist: typeof g.dist === "number" ? g.dist : 0 });
  }
  return out;
}

export function parseExtracts(json: unknown, lang: WikiLang): Map<number, WikiExtract> {
  const pages = (json as { query?: { pages?: Record<string, { pageid?: number; title?: string; extract?: string }> } } | null)
    ?.query?.pages;
  const out = new Map<number, WikiExtract>();
  if (!pages) return out;
  for (const p of Object.values(pages)) {
    if (typeof p.pageid === "number" && typeof p.title === "string" && p.extract)
      out.set(p.pageid, { title: p.title, extract: p.extract, url: pageUrl(lang, p.pageid) });
  }
  return out;
}

// Failed requests are dropped from the cache so a later call can retry.
const cache = new Map<string, Promise<unknown>>();
function getJson(url: string): Promise<unknown> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return r.json();
    });
    cache.set(url, p);
    p.catch(() => {
      if (cache.get(url) === p) cache.delete(url);
    });
  }
  return p;
}

export async function geoArticles(lat: number, lng: number, radiusM: number, lang: WikiLang): Promise<WikiHit[]> {
  return parseGeo(await getJson(geoUrl(lat, lng, radiusM, lang)));
}

export async function extracts(pageids: number[], lang: WikiLang): Promise<Map<number, WikiExtract>> {
  const ids = [...new Set(pageids)];
  const out = new Map<number, WikiExtract>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
  const parts = await Promise.all(chunks.map(async (c) => parseExtracts(await getJson(extractsUrl(c, lang)), lang)));
  for (const m of parts) for (const [k, v] of m) out.set(k, v);
  return out;
}

// ru first; en only when ru finds nothing. Deduplicated by (lang, pageid), nearest first.
export async function articlesNear(lat: number, lng: number, radiusM: number): Promise<WikiArticle[]> {
  let lang: WikiLang = "ru";
  let hits = await geoArticles(lat, lng, radiusM, lang);
  if (!hits.length) {
    lang = "en";
    hits = await geoArticles(lat, lng, radiusM, lang);
  }
  const seen = new Set<number>();
  return hits
    .filter((h) => !seen.has(h.pageid) && !!seen.add(h.pageid))
    .sort((a, b) => a.dist - b.dist)
    .map((h) => ({ ...h, lang }));
}
