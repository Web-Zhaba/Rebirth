import "./admin.css";
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ADMIN } from "../sim/admin";
import type { AdminOp } from "../sim/admin";
import { revealRadius } from "../map/revealTool";
import { flash } from "../map/tools";
import { SEASON_NAMES, seasonPreview } from "../map/seasonPreview";
import { sendCmd, setSpeed, speed } from "../simClient";
import { Button } from "./kit";
import { L } from "../i18n";

export const adminOpen = signal(false);
// Mirrors the worker's session flag; both start off after every load.
const adminFree = signal(false);

const RADII = [30, 100, 300, ADMIN.maxRadius];

async function run(op: AdminOp): Promise<boolean> {
  const r = await sendCmd({ type: "admin", op });
  if (!r.ok) flash(r.reason ?? L("Не вышло", "That didn't work"));
  return r.ok;
}

async function setFree(on: boolean): Promise<void> {
  if (await run({ k: "free", on })) adminFree.value = on;
}

// Cheats for testing: instant free construction, finishing everything, goods, unlocks and revealing the old city by a click.
export function AdminPanel() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Backquote" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      adminOpen.value = !adminOpen.value;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!adminOpen.value) return null;
  const r = revealRadius.value;
  return (
    <div class="panel admin-panel" role="region" aria-label={L("Админ-панель", "Admin panel")}>
      <div class="admin-head">
        <b>{L("Админ-панель", "Admin panel")}</b>
        <button type="button" class="admin-x" aria-label={L("Закрыть", "Close")} onClick={() => (adminOpen.value = false)}>
          ×
        </button>
      </div>
      <label class="admin-row">
        <input type="checkbox" checked={adminFree.value} onChange={(e) => void setFree((e.target as HTMLInputElement).checked)} />
        <span>{L("Строить бесплатно и сразу", "Build free and instantly")}</span>
      </label>
      <div class="admin-grid">
        <Button onClick={() => void run({ k: "finish" })}>{L("Достроить всё", "Finish everything")}</Button>
        <Button onClick={() => void run({ k: "stock" })}>+{ADMIN.grant} {L("ресурсов", "resources")}</Button>
        <Button onClick={() => void run({ k: "unlock" })}>{L("Изучить всё", "Research everything")}</Button>
        <Button onClick={() => void run({ k: "era" })}>{L("Следующая эпоха", "Next era")}</Button>
        <Button onClick={() => setSpeed(speed.value === 4 ? 1 : 4)}>{L("Скорость", "Speed")} {speed.value === 4 ? "×1" : "×4"}</Button>
      </div>
      <div class="admin-sub">{L("Исследовать кликом по карте, радиус:", "Reveal by clicking the map, radius:")}</div>
      <div class="admin-grid">
        {RADII.map((m) => (
          <Button key={m} variant={r === m ? "primary" : "default"} aria-pressed={r === m} onClick={() => (revealRadius.value = r === m ? null : m)}>
            {m} {L("м", "m")}
          </Button>
        ))}
      </div>
      <div class="admin-sub">{L("Сезон на карте (игра не меняется):", "Season on the map (the game is unchanged):")}</div>
      <div class="admin-grid">
        <Button variant={seasonPreview.value === null ? "primary" : "default"} aria-pressed={seasonPreview.value === null} onClick={() => (seasonPreview.value = null)}>
          {L("Как в игре", "As in the game")}
        </Button>
        {SEASON_NAMES.map((name, k) => (
          <Button key={name} variant={seasonPreview.value === k ? "primary" : "default"} aria-pressed={seasonPreview.value === k} onClick={() => (seasonPreview.value = k)}>
            {name}
          </Button>
        ))}
      </div>
      <div class="admin-sub">{L("Открыть панель: клавиша ё / `", "Open the panel: the ` key")}</div>
    </div>
  );
}
