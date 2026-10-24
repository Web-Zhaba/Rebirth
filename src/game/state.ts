import { signal } from "@preact/signals";
import type { CellInfo } from "../world/cells";
import type { EconomyState } from "./sim";

export interface City {
  name: string;
  lat: number;
  lng: number;
  cell: string;
  foundedAt: number;
}

export interface SaveData {
  version: 2;
  city: City;
  economy: EconomyState;
}

export const city = signal<City | null>(null);
export const economy = signal<EconomyState | null>(null);

// Cell under the cursor and its analysis state (null: nothing hovered).
export type Hovered =
  | { cell: string; status: "loading" }
  | { cell: string; status: "ready"; info: CellInfo }
  | { cell: string; status: "error" };

export const hovered = signal<Hovered | null>(null);

// Clicked cell, and the terrain info for it and its ring-1 neighbours.
export const selected = signal<string | null>(null);

export type SelectedData =
  | { cell: string; status: "loading" }
  | { cell: string; status: "ready"; info: CellInfo; neighbours: CellInfo[] }
  | { cell: string; status: "error" };

export const selectedData = signal<SelectedData | null>(null);

// Shown once after loading a save that was idle for a while.
export interface OfflineReport {
  ms: number;
  food: number;
  wood: number;
  stone: number;
  popDelta: number;
}

export const offlineReport = signal<OfflineReport | null>(null);

// Land-type overlay around the city centre.
export const overlayOn = signal(false);
