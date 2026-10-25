import type maplibregl from "maplibre-gl";
import type { City } from "../sim/types";
import { LeftPanel } from "./LeftPanel";
import { GoalsTracker } from "./GoalsTracker";
import { EventCard } from "./EventCard";
import { Toasts } from "./Toasts";
import { TopBar, Warnings } from "./TopBar";
import { BuilderTasks } from "./BuilderTasks";

// Full-width top bar, then warnings and the layers on the left, builders' tasks in the bottom-right corner. The town panel lives in the right slot (App).
export function Hud({ city, map }: { city: City; map: maplibregl.Map }) {
  return (
    <>
      <TopBar city={city} map={map} />
      <div class="side-col">
        <Warnings />
        <LeftPanel />
        <GoalsTracker />
        <EventCard map={map} />
        <Toasts map={map} />
      </div>
      <BuilderTasks map={map} />
    </>
  );
}
