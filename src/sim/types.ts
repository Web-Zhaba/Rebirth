export interface City {
  name: string;
  lat: number;
  lng: number;
  foundedAt: number; // epoch ms
}

export interface SimState {
  realTime: number; // epoch ms simulated up to
  gameMinutes: number; // since founding
}

export interface SaveV3 {
  version: 3;
  city: City;
  sim: SimState;
}
