import { useState } from "preact/hooks";
import { OVERLAY_COLORS, OVERLAYS, overlay, setManualOverlay, setManualZonesShown, TRAFFIC_STOPS, zonesShown, type Overlay } from "../map/tools";
import { compactScreen } from "../map/motion";
import { placeLabelsOn, togglePlaceLabels } from "../map/placeLabels";
import { cloudsOn, toggleClouds } from "../map/clouds/settings";
import { ruinsShown, toggleRuins } from "../map/ruinsLayer";
import { toggleWeatherMap, weatherMapOn } from "../map/weatherSettings";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { IconButton } from "./kit";

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
      <div class="legend" title="Жителей в день на участке дороги">
        <span class="legend-what">Дороги:</span>
        <span>мало</span>
        <span class="legend-ramp" style={{ background: ramp }} />
        <span>много</span>
      </div>
    );
  }
  if (id === "value" || id === "mood") {
    return (
      <div class="legend">
        <span class="legend-what">Дома:</span>
        <span>{id === "value" ? "дешевле" : "хуже"}</span>
        <span class="legend-ramp" style={{ background: `linear-gradient(90deg, ${bad}, ${mid}, ${good})` }} />
        <span>{id === "value" ? "дороже" : "лучше"}</span>
        <span class="legend-key">
          <i class="legend-sw" style={{ background: neutral }} />
          нет данных
        </span>
      </div>
    );
  }
  return (
    <div class="legend">
      <span class="legend-what">Дома:</span>
      <span class="legend-key">
        <i class="legend-sw" style={{ background: good }} />
        охвачены
      </span>
      <span class="legend-key">
        <i class="legend-sw" style={{ background: bad }} />
        не охвачены
      </span>
    </div>
  );
}

const STORE_KEY = "rebirth.layers.collapsed";
const readCollapsed = (): boolean => {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === null ? compactScreen() : v === "1";
  } catch {
    return false;
  }
};

// Map layers as an icon button group, with a legend for the one that is on.
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
    <div class="layerbar">
      <button class="layer-head" type="button" aria-expanded={!collapsed} onClick={toggle}>
        <Icon name="layers" size={16} />
        <span>Слои</span>
        <b class="layer-name">{zonesShown.value ? "зоны" : active?.label}</b>
        <Icon name={collapsed ? "caretDown" : "caretUp"} size={14} />
      </button>
      {!collapsed && (
        <>
          <div class="layer-group" role="group" aria-label="Слои карты">
            {/* Native title tooltips: a CSS tooltip here overflows the scrolling left column and makes it jump. */}
            {OVERLAYS.map((o) => (
              <IconButton key={o.id} icon={LAYER_ICON[o.id]} label={o.label} aria-pressed={cur === o.id} onClick={() => setManualOverlay(o.id)} />
            ))}
            <span class="layer-sep" aria-hidden="true" />
            <IconButton icon="layers" label="Зоны" aria-pressed={zonesShown.value} onClick={() => setManualZonesShown(!zonesShown.value)} />
            <IconButton icon="placeNames" label="Старые названия" aria-pressed={placeLabelsOn.value} onClick={togglePlaceLabels} />
            <IconButton icon="dig" label="Старый город" aria-pressed={ruinsShown.value} onClick={toggleRuins} />
            <IconButton icon="weatherRain" label="Погода на карте" aria-pressed={weatherMapOn.value} onClick={toggleWeatherMap} />
            <IconButton icon="clouds" label="Облака" aria-pressed={cloudsOn.value} onClick={toggleClouds} />
          </div>
          <Legend id={cur} />
        </>
      )}
    </div>
  );
}
