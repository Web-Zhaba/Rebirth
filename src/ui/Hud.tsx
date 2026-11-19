import type { View } from "../view/view";
import type { City } from "../sim/types";
import { LeftPanel } from "./LeftPanel";
import { Toasts } from "./Toasts";
import { TopBar, Warnings } from "./TopBar";
import { BuilderTasks } from "./BuilderTasks";
import { LANDMARK_LABELS } from "./semanticModel";
import { flush, resetFailed, saveFailed } from "../simClient";
import { Icon } from "./Icon";
import { L } from "../i18n";

// The top plates (town and time, resources, actions with the research status), then warnings, layers and news on the
// left, builders' tasks in the bottom corner. The panels live in the right slot (App).
export function Hud({ city, view }: { city: City; view: View }) {
  return (
    <>
      <TopBar city={city} view={view} />
      <aside class="side-col" aria-label={LANDMARK_LABELS.status}>
        {saveFailed.value && (
          <div class="warns">
            <p class="warn-chip" role="alert"><Icon name="warning" size={16} />{L("Изменения пока не сохранены.", "Changes have not been saved yet.")}</p>
            <button class="warn-chip" type="button" onClick={flush}>{L("Повторить сохранение", "Retry saving")}</button>
          </div>
        )}
        {resetFailed.value && (
          <p class="warn-chip" role="alert"><Icon name="warning" size={16} />{L("Поселение не удалось удалить.", "The settlement could not be deleted.")}</p>
        )}
        <Warnings />
        <LeftPanel />
        <Toasts view={view} />
      </aside>
      <BuilderTasks view={view} />
    </>
  );
}
