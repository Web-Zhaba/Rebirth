import "./journal.css";
import { signal } from "@preact/signals";
import { CLOUD_QUALITIES, cloudQuality, highQualityAvailable, setCloudQuality, type CloudQuality } from "../map/clouds/settings";
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
  // "High" needs float render targets; the page cannot ask three.js before it loads, so a throwaway context is probed.
  const high = highQualityAvailable();
  const cloudOptions: SegmentOption<CloudQuality>[] = CLOUD_QUALITIES.map((q) => ({ id: q, ...CLOUD_LABELS[q], disabled: q === "high" && !high }));
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
        <div class="settings-row">
          <span>Качество облаков</span>
          <Segmented options={cloudOptions} value={cloudQuality.value} label="Качество облаков" onChange={setCloudQuality} />
        </div>
        <Button onClick={() => { adminOpen.value = true; settingsOpen.value = false; }}>Админ-панель</Button>
      </div>
    </Dialog>
  );
}
