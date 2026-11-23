import { isFlagDesign } from "./heraldry";
import type { City } from "./types";

// The unknown-data guards the save readers share: a save is untrusted data that crossed a thread and maybe a version,
// so every figure is checked at runtime (save.ts, saveMigrations.ts).

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isPoint = (p: unknown): p is [number, number] => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);
export const nonNegInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

export function parseCity(v: unknown): City | null {
  if (!isRecord(v)) return null;
  const c = v as Record<string, unknown>;
  if (typeof c.name !== "string") return null;
  const name = c.name.trim();
  if (name.length < 1 || name.length > 40) return null;
  if (!isNum(c.lat) || c.lat < -90 || c.lat > 90) return null;
  if (!isNum(c.lng) || c.lng < -180 || c.lng > 180) return null;
  if (!isNum(c.foundedAt) || c.foundedAt <= 0) return null;
  return { name, lat: c.lat, lng: c.lng, foundedAt: c.foundedAt, ...(isFlagDesign(c.flag) ? { flag: c.flag } : {}) };
}
