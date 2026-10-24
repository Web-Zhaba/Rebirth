import { isValidCell } from "h3-js";
import type { City, SaveData } from "./state";

const KEY = "rebirth.save";

function parseCity(v: unknown): City | null {
  if (typeof v !== "object" || v === null) return null;
  const { name, lat, lng, cell, foundedAt } = v as Record<string, unknown>;
  if (typeof name !== "string" || name.length < 1 || name.length > 40) return null;
  if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180) return null;
  if (typeof cell !== "string" || !isValidCell(cell)) return null;
  if (typeof foundedAt !== "number" || !Number.isFinite(foundedAt)) return null;
  return { name, lat, lng, cell, foundedAt };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (d.version !== 1) return null;
    const city = parseCity(d.city);
    return city ? { version: 1, city } : null;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Storage unavailable or full: the game keeps running unsaved.
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
