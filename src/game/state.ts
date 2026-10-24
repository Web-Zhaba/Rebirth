import { signal } from "@preact/signals";
import type { CellInfo } from "../world/cells";

export interface City {
  name: string;
  lat: number;
  lng: number;
  cell: string;
  foundedAt: number;
}

export interface SaveData {
  version: 1;
  city: City;
}

export const city = signal<City | null>(null);

// Cell under the cursor and its analysis state (null: nothing hovered).
export type Hovered =
  | { cell: string; status: "loading" }
  | { cell: string; status: "ready"; info: CellInfo }
  | { cell: string; status: "error" };

export const hovered = signal<Hovered | null>(null);

// Land-type overlay around the city centre.
export const overlayOn = signal(false);
