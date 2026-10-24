import type { City } from "../game/state";
import { clearSave } from "../game/save";

export function Hud({ city }: { city: City }) {
  const reset = () => {
    if (!confirm("Удалить поселение и начать заново?")) return;
    clearSave();
    location.reload();
  };
  return (
    <div class="hud panel">
      <div class="hud-name">{city.name}</div>
      <div class="hud-date">Основано: {new Date(city.foundedAt).toLocaleDateString("ru-RU")}</div>
      <button class="link" onClick={reset}>
        Начать заново
      </button>
    </div>
  );
}
