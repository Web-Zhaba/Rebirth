import type maplibregl from "maplibre-gl";
import { DaySummary } from "./DaySummary";
import { EventCard } from "./EventCard";
import "./feedback.css";

// Centre of the screen under the top bar (PLAN-ui.md section 5): the event card above the day summary. One column,
// so the two never overlap whichever is shown.
export function CentreColumn({ map }: { map: maplibregl.Map }) {
  return (
    <div class="centre-col">
      <EventCard map={map} />
      <DaySummary map={map} />
    </div>
  );
}
