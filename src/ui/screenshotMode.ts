import { effect, signal } from "@preact/signals";
import { screenshotKey } from "./screenshotModel";

export const screenshotMode = signal(false);

export function installScreenshotMode(): () => void {
  const sync = effect(() => document.documentElement.classList.toggle("screenshot-mode", screenshotMode.value));
  const onKey = (e: KeyboardEvent) => {
    const next = screenshotKey(screenshotMode.peek(), e.key);
    if (next === null) return;
    e.preventDefault();
    if (e.key === "Escape") e.stopImmediatePropagation();
    screenshotMode.value = next;
  };
  window.addEventListener("keydown", onKey, true);
  return () => {
    window.removeEventListener("keydown", onKey, true);
    sync();
    document.documentElement.classList.remove("screenshot-mode");
  };
}
