import type maplibregl from "maplibre-gl";
import type { City } from "../sim/types";
import { LeftPanel } from "./LeftPanel";
import { GoalsTracker } from "./GoalsTracker";
import { TopBar, Warnings } from "./TopBar";

// Full-width top bar, then warnings and the layers on the left. The town panel lives in the right slot (App).
export function Hud({ city }: { city: City; map: maplibregl.Map }) {
  return (
    <>
      <TopBar city={city} />
      <div class="side-col">
        <Warnings />
        <LeftPanel />
        <GoalsTracker />
      </div>
    </>
  );
}
