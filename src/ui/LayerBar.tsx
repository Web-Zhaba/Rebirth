import { useState } from "preact/hooks";
import { OVERLAY_COLORS, OVERLAYS, overlay, setManualOverlay, TRAFFIC_STOPS, type Overlay } from "../map/tools";
import { placeLabelsOn, togglePlaceLabels } from "../view/placeNames";
import { cloudsOn, toggleClouds } from "../map/clouds/settings";
import { ruinsShown, toggleRuins } from "../view/ruinsShown";
import { toggleWeatherMap, weatherMapOn } from "../map/weatherSettings";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { IconButton } from "./kit";
import { SEMANTIC_IDS } from "./semanticIds";
import { L } from "../i18n";

const LAYER_ICON: Record<Overlay, IconName> = {
  none: "layerNone",
  well: "well",
  market: "market",
  chapel: "chapel",
  school: "school",
  healer: "healer",
  value: "value",
  mood: "mood",
  traffic: "traffic",
};

const { good, mid, bad, neutral } = OVERLAY_COLORS;

// Legend of the active layer: the colour key the map uses, always with words next to it.
function Legend({ id }: { id: Overlay }) {
  if (id === "none") return null;
  if (id === "traffic") {
    const ramp = `linear-gradient(90deg, ${TRAFFIC_STOPS.map((s) => s.color).join(", ")})`;
    return (
      <div class="legend" title={L("Жителей в день на участке дороги", "Residents per day on a road section")}>
        <span class="legend-what">{L("Дороги:", "Roads:")}</span>
        <span>{L("мало", "few")}</span>
        <span class="legend-ramp" style={{ background: ramp }} />
        <span>{L("много", "many")}</span>
      </div>
    );
  }
  if (id === "value" || id === "mood") {
    return (
      <div class="legend">
        <span class="legend-what">{L("Дома:", "Houses:")}</span>
        <span>{id === "value" ? L("дешевле", "cheaper") : L("хуже", "worse")}</span>
        <span class="legend-ramp" style={{ background: `linear-gradient(90deg, ${bad}, ${mid}, ${good})` }} />
        <span>{id === "value" ? L("дороже", "pricier") : L("лучше", "better")}</span>
        <span class="legend-key">
          <i class="legend-sw" style={{ background: neutral }} />
          {L("нет данных", "no data")}
        </span>
      </div>
    );
  }
  return (
    <div class="legend">
      <span class="legend-what">{L("Дома:", "Houses:")}</span>
      <span class="legend-key">
        <i class="legend-sw" style={{ background: good }} />
        {L("охвачены", "covered")}
      </span>
      <span class="legend-key">
        <i class="legend-sw" style={{ background: bad }} />
        {L("не охвачены", "not covered")}
      </span>
    </div>
  );
}

const STORE_KEY = "rebirth.layers.collapsed";
// Folded unless the player opened it before: the tag names the live layer, the legend shows under it anyway.
const readCollapsed = (): boolean => {
  try {
    return localStorage.getItem(STORE_KEY) !== "0";
  } catch {
    return true;
  }
};

// Map layers: a tag naming the live layer; open, the switches and the legend of the one that is on.
export function LayerBar() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const cur = overlay.value;
  const active = OVERLAYS.find((o) => o.id === cur);
  return (
    <>
      <button class="layer-head" type="button" aria-expanded={!collapsed} aria-controls={SEMANTIC_IDS.layerControls} onClick={toggle}>
        <Icon name="layers" size={16} />
        <span>{L("Слои", "Layers")}</span>
        <b class="layer-name">{active?.label}</b>
        <Icon name={collapsed ? "caretDown" : "caretUp"} size={12} />
      </button>
      {collapsed ? (
        cur !== "none" && (
          <div class="layer-legend">
            <Legend id={cur} />
          </div>
        )
      ) : (
        <div class="layer-body">
          <span class="layer-caption">{L("Что показать на карте", "What the map shows")}</span>
          <div class="layer-group" id={SEMANTIC_IDS.layerControls} role="toolbar" aria-label={L("Слои карты", "Map layers")} aria-orientation="horizontal">
            {/* Native title tooltips: a CSS tooltip here overflows the scrolling left column and makes it jump. */}
            {OVERLAYS.map((o) => (
              <IconButton key={o.id} icon={LAYER_ICON[o.id]} label={o.label} aria-pressed={cur === o.id} onClick={() => setManualOverlay(o.id)} />
            ))}
          </div>
          <Legend id={cur} />
          <span class="layer-caption">{L("Поверх карты", "On top of the map")}</span>
          <div class="layer-group" role="toolbar" aria-label={L("Пометки на карте", "Map marks")} aria-orientation="horizontal">
            <IconButton icon="placeNames" label={L("Старые названия", "Old names")} aria-pressed={placeLabelsOn.value} onClick={togglePlaceLabels} />
            <IconButton icon="dig" label={L("Старый город", "Old town")} aria-pressed={ruinsShown.value} onClick={toggleRuins} />
            <IconButton icon="weatherRain" label={L("Погода на карте", "Weather on the map")} aria-pressed={weatherMapOn.value} onClick={toggleWeatherMap} />
            <IconButton icon="clouds" label={L("Облака", "Clouds")} aria-pressed={cloudsOn.value} onClick={toggleClouds} />
          </div>
        </div>
      )}
    </>
  );
}
