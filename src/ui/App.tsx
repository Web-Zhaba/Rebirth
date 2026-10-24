import type maplibregl from "maplibre-gl";
import { city } from "../game/state";
import { FoundCity } from "./FoundCity";
import { Hud } from "./Hud";

export function App({ map }: { map: maplibregl.Map }) {
  const c = city.value;
  return c ? <Hud city={c} /> : <FoundCity map={map} />;
}
