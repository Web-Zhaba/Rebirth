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

function ResearchStatus() {
  const r = state.value?.research;
  if (!r) return null;
  const t = r.active && techOf(r.active.techId);
  const text = t && r.active ? `Исследуется: ${t.name}, ${Math.floor(r.active.share * 100)} %` : "Наука простаивает";

  return (
    <button type="button" class="research-status" role="status" title="Открыть «Науку»" onClick={() => openPanel("tech")}>
      <Icon name="scroll" size={16} />
      <span>{text}</span>
    </button>
  );
}

// Full-width top bar, then persistent status and warnings on the left, builders' tasks in the bottom-right corner.
// The town panel lives in the right slot (App).
export function Hud({ city, map }: { city: City; map: maplibregl.Map }) {
  return (
    <>
      <TopBar city={city} map={map} />
      <div class="side-col">
        <ResearchStatus />
        <Warnings />
        <LeftPanel />
        <EventCard map={map} />
        <Toasts map={map} />
      </div>
      <BuilderTasks map={map} />
    </>
  );
}
