// The game's language, fixed for the page's lifetime: changing it stores the choice and reloads.
// Texts sit next to each other in the code as L(ru, en). Russian is the source; tests run in Russian.
// The sim worker cannot read localStorage, so the page passes the language as the worker's name.
import { platform } from "./platform";

export type Lang = "ru" | "en";

const KEY = "rebirth.lang";
const isLang = (v: unknown): v is Lang => v === "ru" || v === "en";
// Any language code to one the game has: Russian for those who read it, English for everyone else.
const fromCode = (code: string): Lang => (/^(ru|be|uk|kk)\b/i.test(code) ? "ru" : "en");

function detect(): Lang {
  if (import.meta.env.MODE === "test") return "ru";
  const g = globalThis as { WorkerGlobalScope?: unknown; name?: string };
  if (g.WorkerGlobalScope !== undefined) return isLang(g.name) ? g.name : "ru";
  // The player's own choice in the settings wins over any detection.
  try {
    const stored = localStorage.getItem(KEY);
    if (isLang(stored)) return stored;
  } catch {
    // storage blocked: fall through to detection
  }
  // A portal tells its interface language through its SDK (set up before this module loads, boot.ts).
  if (platform.lang) return fromCode(platform.lang);
  const url = new URLSearchParams(location.search + "&" + location.hash.slice(1)).get("lang");
  return fromCode(url ?? navigator.language);
}

export const lang: Lang = detect();
export const isEn = lang === "en";

export const L = (ru: string, en: string): string => (isEn ? en : ru);

export function setLang(next: Lang): void {
  if (next === lang) return;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // nothing to keep the choice in; the reload falls back to detection
  }
  const url = new URL(location.href);
  url.searchParams.delete("lang");
  location.replace(url.toString());
}

// Counted noun: Russian one / few / many, English one / other.
export function plural(n: number, one: string, few: string, many: string, enOne?: string, enMany?: string): string {
  if (isEn && enOne !== undefined) return Math.abs(n) === 1 ? enOne : (enMany ?? enOne + "s");
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
}

// Decimal comma in Russian, point in English.
export const decimal = (s: string): string => (isEn ? s : s.replace(".", ","));
