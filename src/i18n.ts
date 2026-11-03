// The game's language, fixed for the page's lifetime: changing it stores the choice and reloads.
// Texts sit next to each other in the code as L(ru, en). Russian is the source; tests run in Russian.
// The sim worker cannot read localStorage, so the page passes the language as the worker's name.
export type Lang = "ru" | "en";

const KEY = "rebirth.lang";
const isLang = (v: unknown): v is Lang => v === "ru" || v === "en";

function detect(): Lang {
  if (import.meta.env.MODE === "test") return "ru";
  const g = globalThis as { WorkerGlobalScope?: unknown; name?: string };
  if (g.WorkerGlobalScope !== undefined) return isLang(g.name) ? g.name : "ru";
  // A portal (Yandex Games) passes its interface language in the page address.
  const url = new URLSearchParams(location.search + "&" + location.hash.slice(1)).get("lang");
  if (url) return url === "ru" || url === "be" || url === "uk" || url === "kk" ? "ru" : "en";
  try {
    const stored = localStorage.getItem(KEY);
    if (isLang(stored)) return stored;
  } catch {
    // storage blocked: fall through to the browser language
  }
  return /^(ru|be|uk|kk)\b/i.test(navigator.language) ? "ru" : "en";
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
