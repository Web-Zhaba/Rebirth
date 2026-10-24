import type { City, SaveV3 } from "./types";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseCity(v: unknown): City | null {
  if (typeof v !== "object" || v === null) return null;
  const c = v as Record<string, unknown>;
  if (typeof c.name !== "string") return null;
  const name = c.name.trim();
  if (name.length < 1 || name.length > 40) return null;
  if (!isNum(c.lat) || c.lat < -90 || c.lat > 90) return null;
  if (!isNum(c.lng) || c.lng < -180 || c.lng > 180) return null;
  if (!isNum(c.foundedAt) || c.foundedAt <= 0) return null;
  return { name, lat: c.lat, lng: c.lng, foundedAt: c.foundedAt };
}

export function parseSaveV3(value: unknown, now: number): SaveV3 | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 3) return null;
  const city = parseCity(v.city);
  if (!city) return null;
  const sim = v.sim as Record<string, unknown> | null | undefined;
  if (typeof sim !== "object" || sim === null) return null;
  if (!isNum(sim.realTime) || sim.realTime <= 0 || sim.realTime > now + 60_000) return null;
  if (!isNum(sim.gameMinutes) || sim.gameMinutes < 0) return null;
  return { version: 3, city, sim: { realTime: sim.realTime, gameMinutes: sim.gameMinutes } };
}

// Old localStorage saves (v1, v2): keep the city, start a fresh village.
export function migrateLegacy(raw: string, now: number): SaveV3 | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (o.version !== 1 && o.version !== 2) return null;
  const city = parseCity(o.city);
  if (!city) return null;
  return { version: 3, city, sim: { realTime: now, gameMinutes: 0 } };
}
