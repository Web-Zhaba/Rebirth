import type { View } from "../view/view";
import type { City } from "../sim/types";
import { LeftPanel } from "./LeftPanel";
import { Toasts } from "./Toasts";
import { TopBar, Warnings } from "./TopBar";
import { BuilderTasks } from "./BuilderTasks";
import { LANDMARK_LABELS } from "./semanticModel";

// The top plates (town and time, resources, actions with the research status), then warnings, layers and news on the
// left, builders' tasks in the bottom corner. The panels live in the right slot (App).
export function Hud({ city, view }: { city: City; view: View }) {
  return (
    <>
      <TopBar city={city} view={view} />
      <aside class="side-col" aria-label={LANDMARK_LABELS.status}>
        <Warnings />
        <LeftPanel />
        <Toasts view={view} />
      </aside>
      <BuilderTasks view={view} />
    </>
  );
}
