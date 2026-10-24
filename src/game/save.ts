import { isValidCell } from "h3-js";
import { BUILDING_TYPES, MAX_MULT, type BuildingType } from "./defs";
import { initialEconomy, type EconomyState, type PlacedBuilding } from "./sim";
import type { City, SaveData } from "./state";

const KEY = "rebirth.save";
const FUTURE_SLACK_MS = 60 * 1000;

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

const nonNeg = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

function parseEconomy(v: unknown, now: number): EconomyState | null {
  if (typeof v !== "object" || v === null) return null;
  const { time, food, wood, stone, pop, buildings } = v as Record<string, unknown>;
  if (!nonNeg(time) || time > now + FUTURE_SLACK_MS) return null;
  if (!nonNeg(food) || !nonNeg(wood) || !nonNeg(stone) || !nonNeg(pop) || pop < 1) return null;
  if (typeof buildings !== "object" || buildings === null || Array.isArray(buildings)) return null;
  const out: Record<string, PlacedBuilding> = {};
  for (const [cell, b] of Object.entries(buildings)) {
    if (!isValidCell(cell) || typeof b !== "object" || b === null) return null;
    const { type, mult } = b as Record<string, unknown>;
    if (typeof type !== "string" || !(BUILDING_TYPES as readonly string[]).includes(type)) return null;
    if (!nonNeg(mult) || mult > MAX_MULT) return null;
    out[cell] = { type: type as BuildingType, mult };
  }
  return { time, food, wood, stone, pop, buildings: out };
}

// Validates a raw save string; v1 saves (city only) migrate by getting a fresh economy.
export function parseSave(raw: string, now: number): SaveData | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    const city = parseCity(d.city);
    if (!city) return null;
    if (d.version === 1) return { version: 2, city, economy: initialEconomy(city.cell, now) };
    if (d.version !== 2) return null;
    const economy = parseEconomy(d.economy, now);
    return economy ? { version: 2, city, economy } : null;
  } catch {
    return null;
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseSave(raw, Date.now()) : null;
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
