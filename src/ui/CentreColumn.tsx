import type * as maplibregl from "maplibre-gl";
import { DaySummary } from "./DaySummary";
import "./feedback.css";
import { LANDMARK_LABELS } from "./semanticModel";

// Centre of the screen under the top bar: only transient day summaries belong here.
// Persistent research status lives in the left HUD column with the other status chips.
export function CentreColumn({ map }: { map: maplibregl.Map }) {
  return (
    <section class="centre-col" aria-label={LANDMARK_LABELS.summaries}>
      <DaySummary map={map} />
    </section>
  );
}
