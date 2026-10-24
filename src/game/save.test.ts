import { describe, expect, it } from "vitest";
import { CENTRE, RING1 } from "./fixtures";
import { parseSave } from "./save";
import { initialEconomy } from "./sim";
import type { SaveData } from "./state";

const NOW = 1_000_000_000_000;
const city = { name: "Test", lat: 50, lng: 15, cell: CENTRE, foundedAt: NOW - 5000 };
const good = (): SaveData => ({ version: 2, city, economy: initialEconomy(CENTRE, NOW) });
const withEco = (patch: Record<string, unknown>) => JSON.stringify({ ...good(), economy: { ...good().economy, ...patch } });

describe("parseSave", () => {
  it("round-trips a v2 save", () => {
    const s = good();
    s.economy.buildings[RING1[0]] = { type: "farm", mult: 1.3 };
    expect(parseSave(JSON.stringify(s), NOW)).toEqual(s);
  });
  it("rejects garbage", () => {
    for (const raw of ["", "nope", "null", "[]", "{}", '{"version":2}', '{"version":3,"city":{}}']) expect(parseSave(raw, NOW)).toBeNull();
  });
  it("rejects bad numbers", () => {
    expect(parseSave(withEco({ food: -1 }), NOW)).toBeNull();
    expect(parseSave(withEco({ wood: "5" }), NOW)).toBeNull();
    expect(parseSave(withEco({ stone: null }), NOW)).toBeNull(); // JSON turns NaN into null
    expect(parseSave(withEco({ pop: 0.5 }), NOW)).toBeNull();
    expect(parseSave(withEco({ time: NOW + 120_000 }), NOW)).toBeNull();
    expect(parseSave(withEco({ time: NOW + 30_000 }), NOW)).not.toBeNull();
  });
  it("rejects bad buildings", () => {
    expect(parseSave(withEco({ buildings: { [CENTRE]: { type: "castle", mult: 1 } } }), NOW)).toBeNull();
    expect(parseSave(withEco({ buildings: { nonsense: { type: "camp", mult: 1 } } }), NOW)).toBeNull();
    expect(parseSave(withEco({ buildings: { [CENTRE]: { type: "camp", mult: 9 } } }), NOW)).toBeNull();
    expect(parseSave(withEco({ buildings: { [CENTRE]: { type: "camp", mult: -1 } } }), NOW)).toBeNull();
  });
  it("migrates v1 with a fresh economy", () => {
    const out = parseSave(JSON.stringify({ version: 1, city }), NOW);
    expect(out).toEqual({ version: 2, city, economy: initialEconomy(CENTRE, NOW) });
  });
});
