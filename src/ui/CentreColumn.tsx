import type maplibregl from "maplibre-gl";
import { DaySummary } from "./DaySummary";
import "./feedback.css";

// Centre of the screen under the top bar (PLAN-ui.md section 5): the day summary. The event card lives under the
// goals tracker in the left column, so it never takes the screen center.
export function CentreColumn({ map }: { map: maplibregl.Map }) {
  return (
    <div class="centre-col">
      <DaySummary map={map} />
    </div>
  );
}
