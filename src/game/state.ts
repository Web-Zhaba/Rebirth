import { signal } from "@preact/signals";

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
