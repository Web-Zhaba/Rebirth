import "./journal.css";
import { signal } from "@preact/signals";
import { Dialog } from "./kit";
import { play, setSoundEnabled, setSoundVolume, soundEnabled, soundVolume } from "./sound";

export const settingsOpen = signal(false);

// «Настройки»: sound is off by default; the volume slider is a native range input, so arrow keys work.
export function SettingsDialog() {
  if (!settingsOpen.value) return null;
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
            disabled={!soundEnabled.value}
            aria-valuetext={`${pct}%`}
            onInput={(e) => setSoundVolume(Number((e.target as HTMLInputElement).value) / 100)}
            onChange={() => play("click")}
          />
          <span class="settings-val">{pct}%</span>
        </label>
      </div>
    </Dialog>
  );
}
