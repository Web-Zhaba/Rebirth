import type maplibregl from "maplibre-gl";
import { overlayOn, type City } from "../game/state";
import { clearSave } from "../game/save";
import { hideOverlay, showOverlay } from "../map/cellLayers";

export function Hud({ map, city }: { map: maplibregl.Map; city: City }) {
  const reset = () => {
    if (!confirm("Удалить поселение и начать заново?")) return;
    clearSave();
    location.reload();
  };
  const toggle = () => {
    overlayOn.value = !overlayOn.value;
    if (overlayOn.value) showOverlay(map, city.cell);
    else hideOverlay(map);
  };
  return (
    <div class="hud panel">
      <div class="hud-name">{city.name}</div>
      <div class="hud-date">Основано: {new Date(city.foundedAt).toLocaleDateString("ru-RU")}</div>
      <button class="link" onClick={toggle}>
        {overlayOn.value ? "Скрыть клетки" : "Слой клеток"}
      </button>
      <button class="link" onClick={reset}>
        Начать заново
      </button>
    </div>
  );
}
