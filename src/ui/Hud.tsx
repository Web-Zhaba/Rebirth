import { useState } from "preact/hooks";
import type { View } from "../view/view";
import type { City } from "../sim/types";
import { LeftPanel } from "./LeftPanel";
import { Toasts } from "./Toasts";
import { TopBar, Warnings } from "./TopBar";
import { BuilderTasks } from "./BuilderTasks";
import { LANDMARK_LABELS } from "./semanticModel";
import { flush, resetFailed, saveFailed, state } from "../simClient";
import { Icon } from "./Icon";
import { L } from "../i18n";
import { hallReady, openTownhall } from "./TownhallPanel";
import { governmentWarning } from "./warningModel";

function GovernmentWarning({ foundedAt }: { foundedAt: number }) {
  const storageKey = `rebirth.dismissedHeir.${foundedAt}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const snap = state.value;
  const warning = governmentWarning(snap?.gov, snap?.govView);
  if (!warning || (warning.kind === "heir" && warning.reign === dismissed) || !hallReady()) return null;

  return (
    <div class={`government-warning is-${warning.kind}`} role="status">
      <button class="warn-chip" type="button" onClick={() => openTownhall("rule")}>
        <Icon name="townhall" size={16} />
        {warning.kind === "election"
          ? L("Срок главы истёк. Выбрать нового", "The head’s term ended. Elect a new head")
          : L("Доступен выбор наследника", "An heir can be chosen")}
      </button>
      {warning.kind === "heir" && (
        <button
          class="warn-chip"
          type="button"
          aria-label={L("Закрыть напоминание о наследнике", "Dismiss heir reminder")}
          onClick={() => {
            setDismissed(warning.reign);
            try {
              localStorage.setItem(storageKey, warning.reign);
            } catch {
              // shortcut: dismissal lasts until reload when browser storage is unavailable, use the save if persistence is needed there.
            }
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

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
        <GovernmentWarning key={city.foundedAt} foundedAt={city.foundedAt} />
        <LeftPanel />
        <Toasts view={view} />
      </aside>
      <BuilderTasks view={view} />
    </>
  );
}
