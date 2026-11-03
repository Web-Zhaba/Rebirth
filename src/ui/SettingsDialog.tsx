import "./journal.css";
import { signal } from "@preact/signals";
import { fields3dOn, forest3dOn, motionOn, setFields3d, setForest3d, setMotion, setShadowQuality, setSmoke3d, SHADOW_QUALITIES, shadowQuality, smoke3dOn } from "../map/graphicsSettings";
import type { ShadowQuality } from "../engine/shadow/shadowMap";
import { CLOUD_QUALITIES, cloudQuality, setCloudQuality, type CloudQuality } from "../map/clouds/settings";
import { adminOpen } from "./AdminPanel";
import { Button, Dialog, Segmented, type SegmentOption } from "./kit";
import { play, setSoundEnabled, setSoundVolume, soundEnabled, soundVolume } from "./sound";
import { setWeatherSound, weatherSoundOn } from "./weatherSound";
import { L, lang, setLang, type Lang } from "../i18n";

const CLOUD_LABELS: Record<CloudQuality, { label: string; title: string }> = {
  low: { label: L("Низкое", "Low"), title: L("Низкое", "Low") },
  medium: { label: L("Среднее", "Medium"), title: L("Среднее", "Medium") },
  high: { label: L("Высокое", "High"), title: L("Высокое", "High") },
};

const SHADOW_LABELS: Record<ShadowQuality, { label: string; title: string }> = {
  off: { label: L("Нет", "Off"), title: L("Без теней", "No shadows") },
  low: { label: L("Низкое", "Low"), title: L("Мягче и легче для слабой видеокарты", "Softer and lighter on a weak GPU") },
  high: { label: L("Высокое", "High"), title: L("Чёткие тени", "Crisp shadows") },
};

const LANG_OPTIONS: SegmentOption<Lang>[] = [
  { id: "ru", label: "Русский", title: "Русский" },
  { id: "en", label: "English", title: "English" },
];

export const settingsOpen = signal(false);

// «Настройки»: sound is off by default; the volume slider is a native range input, so arrow keys work.
export function SettingsDialog() {
  if (!settingsOpen.value) return null;
  const cloudOptions: SegmentOption<CloudQuality>[] = CLOUD_QUALITIES.map((q) => ({ id: q, ...CLOUD_LABELS[q] }));
  const pct = Math.round(soundVolume.value * 100);
  const shadowOptions: SegmentOption<ShadowQuality>[] = SHADOW_QUALITIES.map((q) => ({ id: q, ...SHADOW_LABELS[q] }));
  return (
    <Dialog title={L("Настройки", "Settings")} class="settings" onClose={() => (settingsOpen.value = false)}>
      <div class="settings-body">
        <div class="settings-row">
          <span>{L("Язык", "Language")}</span>
          <Segmented options={LANG_OPTIONS} value={lang} label={L("Язык", "Language")} onChange={setLang} />
        </div>
        <label class="settings-row">
          <input type="checkbox" checked={soundEnabled.value} onChange={(e) => setSoundEnabled((e.target as HTMLInputElement).checked)} />
          <span>{L("Звук", "Sound")}</span>
        </label>
        <label class="settings-row">
          <span>{L("Громкость", "Volume")}</span>
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
        <label class="settings-row" title={L("Дождь, ветер и снег; громкость общая со звуком", "Rain, wind and snow; shares the sound volume")}>
          <input type="checkbox" checked={weatherSoundOn.value} onChange={(e) => setWeatherSound((e.target as HTMLInputElement).checked)} />
          <span>{L("Шум погоды", "Weather sounds")}</span>
        </label>
        <label class="settings-row" title={L("Деревья в объёме вблизи; без них лес — плоская заливка", "3D trees up close; without them the forest is a flat fill")}>
          <input type="checkbox" checked={forest3dOn.value} onChange={(e) => setForest3d((e.target as HTMLInputElement).checked)} />
          <span>{L("Объёмный лес", "3D forest")}</span>
        </label>
        <label class="settings-row" title={L("Борозды, всходы, жнивьё и снег на полях вблизи; без них поля — плоская заливка", "Furrows, sprouts, stubble and snow on fields up close; without them fields are a flat fill")}>
          <input type="checkbox" checked={fields3dOn.value} onChange={(e) => setFields3d((e.target as HTMLInputElement).checked)} />
          <span>{L("Объёмные поля", "3D fields")}</span>
        </label>
        <label class="settings-row" title={L("Дым из труб жилых домов и мастерских вблизи, в холод и в часы готовки; без него дым не рисуется", "Chimney smoke from houses and workshops up close, in the cold and at cooking hours; off means no smoke")}>
          <input type="checkbox" checked={smoke3dOn.value} onChange={(e) => setSmoke3d((e.target as HTMLInputElement).checked)} />
          <span>{L("Дым из труб", "Chimney smoke")}</span>
        </label>
        <label class="settings-row" title={L("Деревья качаются на ветру, по воде бежит рябь", "Trees sway in the wind, ripples run over water")}>
          <input type="checkbox" checked={motionOn.value} onChange={(e) => setMotion((e.target as HTMLInputElement).checked)} />
          <span>{L("Ветер и волны", "Wind and waves")}</span>
        </label>
        <div class="settings-row" title={L("Тени домов и деревьев от солнца вблизи", "Sun shadows of buildings and trees up close")}>
          <span>{L("Тени", "Shadows")}</span>
          <Segmented options={shadowOptions} value={shadowQuality.value} label={L("Тени", "Shadows")} onChange={setShadowQuality} />
        </div>
        <div class="settings-row">
          <span>{L("Качество облаков", "Cloud quality")}</span>
          <Segmented options={cloudOptions} value={cloudQuality.value} label={L("Качество облаков", "Cloud quality")} onChange={setCloudQuality} />
        </div>
        {import.meta.env.DEV && <Button onClick={() => { adminOpen.value = true; settingsOpen.value = false; }}>{L("Админ-панель", "Admin panel")}</Button>}
      </div>
    </Dialog>
  );
}
