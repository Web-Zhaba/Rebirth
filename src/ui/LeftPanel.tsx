import { plural } from "./InspectorParts";
import { roads } from "../simClient";
import { Icon } from "./Icon";
import { LayerBar } from "./LayerBar";
import { roadQueue } from "./topbarModel";
import { LANDMARK_LABELS } from "./semanticModel";
import { L } from "../i18n";

// What stays on the left under the bar: the layers and the notice about roads cut off from the camp.
export function LeftPanel() {
  const { cut } = roadQueue(roads.value);
  return (
    <>
      <nav class="layers" aria-label={LANDMARK_LABELS.layers}>
        <LayerBar />
      </nav>
      {cut.size > 0 && (
        <div class="warn-chip" role="status">
          <Icon name="warning" size={16} />
          {L("Отрезано от лагеря:", "Cut off from the camp:")} {cut.size} {plural(cut.size, "участок", "участка", "участков", "road section")}{L(" дорог. Подробнее: «Город», работа", ". Details: Town, Work")}
        </div>
      )}
    </>
  );
}
