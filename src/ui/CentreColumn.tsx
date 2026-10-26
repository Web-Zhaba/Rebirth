import type maplibregl from "maplibre-gl";
import { state } from "../simClient";
import { techOf } from "../sim/tech";
import { DaySummary } from "./DaySummary";
import { openPanel } from "./panels";
import "./feedback.css";

// One line under the top bar: what is being researched and how far it has got, or that the science is idle.
function ResearchLine() {
  const r = state.value?.research;
  if (!r) return null;
  const t = r.active && techOf(r.active.techId);
  return (
    <div class="research-line" role="status">
      <button type="button" class="link" title="Открыть «Науку»" onClick={() => openPanel("tech")}>
        {t && r.active ? `Исследуется: ${t.name}, ${Math.floor(r.active.share * 100)} %` : "Наука простаивает"}
      </button>
    </div>
  );
}

// Centre of the screen under the top bar (PLAN-ui.md section 5): the research line and the day summary. The event card
// lives in the left column, so it never takes the screen center.
export function CentreColumn({ map }: { map: maplibregl.Map }) {
  return (
    <div class="centre-col">
      <ResearchLine />
      <DaySummary map={map} />
    </div>
  );
}
