import { OVERLAY_COLORS, OVERLAYS, overlay, TRAFFIC_STOPS, type Overlay } from "../map/tools";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { IconButton, Tooltip } from "./kit";

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
        <span>мало</span>
        <span class="legend-ramp" style={{ background: ramp }} />
        <span>много</span>
      </div>
    );
  }
  if (id === "value" || id === "mood") {
    return (
      <div class="legend">
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
      <span class="legend-key">
        <i class="legend-sw" style={{ background: good }} />
        охвачено
      </span>
      <span class="legend-key">
        <i class="legend-sw" style={{ background: bad }} />
        не охвачено
      </span>
    </div>
  );
}

// Map layers as an icon button group, with a legend for the one that is on.
export function LayerBar() {
  const cur = overlay.value;
  const active = OVERLAYS.find((o) => o.id === cur);
  return (
    <div class="layerbar">
      <div class="layer-head">
        <Icon name="layers" size={16} />
        <span>Слои</span>
        <b class="layer-name">{active?.label}</b>
      </div>
      <div class="layer-group" role="group" aria-label="Слои карты">
        {OVERLAYS.map((o) => (
          <Tooltip key={o.id} text={o.label}>
            <IconButton icon={LAYER_ICON[o.id]} label={o.label} title={undefined} aria-pressed={cur === o.id} onClick={() => (overlay.value = o.id)} />
          </Tooltip>
        ))}
      </div>
      <Legend id={cur} />
    </div>
  );
}
