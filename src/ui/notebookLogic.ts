import { calendar } from "../sim/clock";

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
