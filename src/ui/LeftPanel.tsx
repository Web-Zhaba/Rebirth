import { plural } from "./InspectorParts";
import { roads } from "../simClient";
import { Icon } from "./Icon";
import { LayerBar } from "./LayerBar";
import { roadQueue } from "./topbarModel";
import { LANDMARK_LABELS } from "./semanticModel";

// What stays on the left under the bar: the layers and the notice about roads cut off from the camp.
export function LeftPanel() {
  const { cut } = roadQueue(roads.value);
  return (
    <>
      <nav class="town panel" aria-label={LANDMARK_LABELS.layers}>
        <LayerBar />
      </nav>
      {cut.size > 0 && (
        <div class="warn-chip" role="status">
          <Icon name="warning" size={16} />
          Отрезано от лагеря: {cut.size} {plural(cut.size, "участок", "участка", "участков")} дорог. Подробнее: «Город», работа
        </div>
      )}
    </>
  );
}
