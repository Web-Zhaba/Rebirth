import type * as maplibregl from "maplibre-gl";
import { techOf } from "../sim/tech";
import type { City } from "../sim/types";
import { state } from "../simClient";
import { LeftPanel } from "./LeftPanel";
import { EventCard } from "./EventCard";
import { Toasts } from "./Toasts";
import { TopBar, Warnings } from "./TopBar";
import { BuilderTasks } from "./BuilderTasks";
import { Icon } from "./Icon";
import { openPanel } from "./panels";
import { researchStatusView } from "./researchStatusModel";
import { LANDMARK_LABELS } from "./semanticModel";

function ResearchStatus() {
  const s = state.value;
  const r = s?.research;
  if (!r || !s) return null;
  const active = r.active ? techOf(r.active.techId) : null;
  const queued = s.progress.research.queue.map((id) => techOf(id)?.name ?? id);
  const view = researchStatusView(active?.name ?? null, r.active?.share ?? null, queued);

  return (
    <button type="button" class={`research-status${view.idle ? " research-idle" : ""}`} role="status" title="Открыть «Науку»" onClick={() => openPanel("tech")}>
      <Icon name="scroll" size={16} />
      <span class="research-status-body">
        <span>{view.title}</span>
        {view.next && <small>{view.next}</small>}
        {view.progress !== null && (
          <span class="research-status-track" aria-hidden="true">
            <span style={{ width: `${Math.floor(view.progress * 100)}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

// Full-width top bar, then persistent status and warnings on the left, builders' tasks in the bottom-right corner.
// The town panel lives in the right slot (App).
export function Hud({ city, map }: { city: City; map: maplibregl.Map }) {
  return (
    <>
      <TopBar city={city} map={map} />
      <aside class="side-col" aria-label={LANDMARK_LABELS.status}>
        <ResearchStatus />
        <Warnings />
        <LeftPanel />
        <EventCard map={map} />
        <Toasts map={map} />
      </aside>
      <BuilderTasks map={map} />
    </>
  );
}
