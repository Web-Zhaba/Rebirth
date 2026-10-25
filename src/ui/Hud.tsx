import type maplibregl from "maplibre-gl";
import type { City } from "../sim/types";
import { TopBar, Warnings } from "./TopBar";
import { TownPanel } from "./TownPanel";

// Full-width top bar, warnings and the town panel under it.
export function Hud({ city, map }: { city: City; map: maplibregl.Map }) {
  return (
    <>
      <TopBar city={city} />
      <div class="side-col">
        <Warnings />
        <TownPanel city={city} map={map} />
      </div>
    </>
  );
}
