import { calendar } from "../sim/clock";
import type { Finds } from "../sim/types";

export interface Find {
  id: string;
  kind: "poi" | "street" | "foundations";
  title: string;
  detail?: string;
  at: number; // gameMinutes
}
export interface Article {
  id: string;
  title: string;
  extract: string;
  url: string;
  lang: "ru" | "en";
  at: number;
}
export interface ChronicleEntry {
  at: number;
  text: string;
}

const SEASON_RU = ["весна", "лето", "осень", "зима"];

// Newest first; stable for equal times.
export function newestFirst<T extends { at: number }>(list: readonly T[]): T[] {
  return list
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0].at - a[0].at || b[1] - a[1])
    .map(([v]) => v);
}

// "Год 1, весна, день 3" for a game-minute timestamp.
export function formatDate(gameMinutes: number): string {
  const c = calendar(gameMinutes);
  return `Год ${c.year}, ${SEASON_RU[c.season]}, день ${c.dayOfSeason}`;
}

// Entries of the "finds" and "articles" tabs the player has not opened yet (the chronicle is not counted).
export function unseenCount(finds: readonly unknown[], articles: readonly unknown[], seen: number): number {
  return Math.max(0, finds.length + articles.length - Math.max(0, seen));
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

// The notebook's "finds" tab from the sim finds: every named place and street on its own, plus one
// "foundations" entry per dig. Digs are numbered by ascending building id (`digIds` adds digs without foundations yet).
export function findsToEntries(finds: Finds | null, digIds: readonly number[] = []): Find[] {
  if (!finds) return [];
  const out: Find[] = [];
  for (const p of finds.pois) out.push({ id: `poi:${p.id}`, kind: "poi", title: p.name, detail: p.kind || undefined, at: p.at });
  for (const t of finds.streets) out.push({ id: `street:${t.id}`, kind: "street", title: t.name, detail: "улица", at: t.at });
  const perDig = new Map<number, { n: number; at: number }>();
  for (const f of finds.foundations) {
    const d = perDig.get(f.digId);
    if (d) {
      d.n++;
      d.at = Math.max(d.at, f.at);
    } else perDig.set(f.digId, { n: 1, at: f.at });
  }
  const order = [...new Set([...digIds, ...perDig.keys()])].sort((a, b) => a - b);
  for (const [digId, d] of perDig) {
    const no = order.indexOf(digId) + 1;
    out.push({ id: `dig:${digId}`, kind: "foundations", title: `Раскоп №${no}: ${d.n} ${plural(d.n, "фундамент", "фундамента", "фундаментов")}`, at: d.at });
  }
  return out;
}

// What the player has already seen, per viewer in localStorage; works without storage.
export const SEEN_KEY = "rebirth.notebook.seen";

export function readSeen(): number {
  try {
    const n = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

export function writeSeen(n: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(n));
  } catch {
    // storage unavailable: the badge just comes back next time
  }
}
