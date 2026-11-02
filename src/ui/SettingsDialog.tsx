import "./journal.css";
import { signal } from "@preact/signals";
import { fields3dOn, forest3dOn, motionOn, setFields3d, setForest3d, setMotion, setSmoke3d, smoke3dOn } from "../map/graphicsSettings";
import { CLOUD_QUALITIES, cloudQuality, setCloudQuality, type CloudQuality } from "../map/clouds/settings";
import { adminOpen } from "./AdminPanel";
import { Button, Dialog, Segmented, type SegmentOption } from "./kit";
import { play, setSoundEnabled, setSoundVolume, soundEnabled, soundVolume } from "./sound";
import { setWeatherSound, weatherSoundOn } from "./weatherSound";

const CLOUD_LABELS: Record<CloudQuality, { label: string; title: string }> = {
  low: { label: "Низкое", title: "Низкое" },
  medium: { label: "Среднее", title: "Среднее" },
  high: { label: "Высокое", title: "Высокое" },
};

export const settingsOpen = signal(false);

// «Настройки»: sound is off by default; the volume slider is a native range input, so arrow keys work.
export function SettingsDialog() {
  if (!settingsOpen.value) return null;
  const cloudOptions: SegmentOption<CloudQuality>[] = CLOUD_QUALITIES.map((q) => ({ id: q, ...CLOUD_LABELS[q] }));
  const pct = Math.round(soundVolume.value * 100);
  return (
    <Dialog title="Настройки" class="settings" onClose={() => (settingsOpen.value = false)}>
      <div class="settings-body">
        <label class="settings-row">
          <input type="checkbox" checked={soundEnabled.value} onChange={(e) => setSoundEnabled((e.target as HTMLInputElement).checked)} />
          <span>Звук</span>
        </label>
        <label class="settings-row">
          <span>Громкость</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            disabled={!soundEnabled.value && !weatherSoundOn.value}
            aria-valuetext={`${pct}%`}
            onInput={(e) => setSoundVolume(Number((e.target as HTMLInputElement).value) / 100)}
            onChange={() => play("click")}
          />
          <span class="settings-val">{pct}%</span>
        </label>
        <label class="settings-row" title="Дождь, ветер и снег; громкость общая со звуком">
          <input type="checkbox" checked={weatherSoundOn.value} onChange={(e) => setWeatherSound((e.target as HTMLInputElement).checked)} />
          <span>Шум погоды</span>
        </label>
        <label class="settings-row" title="Деревья в объёме вблизи; без них лес — плоская заливка">
          <input type="checkbox" checked={forest3dOn.value} onChange={(e) => setForest3d((e.target as HTMLInputElement).checked)} />
          <span>Объёмный лес</span>
        </label>
        <label class="settings-row" title="Борозды, всходы, жнивьё и снег на полях вблизи; без них поля — плоская заливка">
          <input type="checkbox" checked={fields3dOn.value} onChange={(e) => setFields3d((e.target as HTMLInputElement).checked)} />
          <span>Объёмные поля</span>
        </label>
        <label class="settings-row" title="Дым из труб жилых домов и мастерских вблизи, в холод и в часы готовки; без него дым не рисуется">
          <input type="checkbox" checked={smoke3dOn.value} onChange={(e) => setSmoke3d((e.target as HTMLInputElement).checked)} />
          <span>Дым из труб</span>
        </label>
        <label class="settings-row" title="Деревья качаются на ветру, по воде бежит рябь">
          <input type="checkbox" checked={motionOn.value} onChange={(e) => setMotion((e.target as HTMLInputElement).checked)} />
          <span>Ветер и волны</span>
        </label>
        <div class="settings-row">
          <span>Качество облаков</span>
          <Segmented options={cloudOptions} value={cloudQuality.value} label="Качество облаков" onChange={setCloudQuality} />
        </div>
        <Button onClick={() => { adminOpen.value = true; settingsOpen.value = false; }}>Админ-панель</Button>
      </div>
    </Dialog>
  );
}
