import { signal } from "@preact/signals";
import { Dialog } from "./kit";
import { HOTKEY_SECTIONS } from "./hotkeysModel";

export const hotkeysOpen = signal(false);

export function HotkeysDialog() {
  if (!hotkeysOpen.value) return null;
  return (
    <Dialog title="Горячие клавиши" class="hotkeys-dialog" onClose={() => (hotkeysOpen.value = false)}>
      <div class="hotkeys-body">
        {HOTKEY_SECTIONS.map((sec) => (
          <div key={sec.title} class="hotkeys-sec">
            <h3 class="hotkeys-sec-title">{sec.title}</h3>
            <div class="hotkeys-table">
              {sec.rows.map((r, i) => (
                <div key={i} class="hotkeys-row">
                  <div class="hotkeys-keys">
                    {r.keys.map((k) => (
                      <kbd key={k} class="hotkey-kbd">{k}</kbd>
                    ))}
                  </div>
                  <span class="hotkeys-desc">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
