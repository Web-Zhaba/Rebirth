import "./admin.css";
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { ADMIN } from "../sim/admin";
import type { AdminOp } from "../sim/admin";
import { revealRadius } from "../map/revealTool";
import { flash } from "../map/tools";
import { sendCmd, setSpeed, speed } from "../simClient";
import { Button } from "./kit";

export const adminOpen = signal(false);
// Mirrors the worker's session flag; both start off after every load.
const adminFree = signal(false);

const RADII = [30, 100, 300, ADMIN.maxRadius];

async function run(op: AdminOp): Promise<boolean> {
  const r = await sendCmd({ type: "admin", op });
  if (!r.ok) flash(r.reason ?? "Не вышло");
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
    <div class="panel admin-panel" role="region" aria-label="Админ-панель">
      <div class="admin-head">
        <b>Админ-панель</b>
        <button type="button" class="admin-x" aria-label="Закрыть" onClick={() => (adminOpen.value = false)}>
          ×
        </button>
      </div>
      <label class="admin-row">
        <input type="checkbox" checked={adminFree.value} onChange={(e) => void setFree((e.target as HTMLInputElement).checked)} />
        <span>Строить бесплатно и сразу</span>
      </label>
      <div class="admin-grid">
        <Button onClick={() => void run({ k: "finish" })}>Достроить всё</Button>
        <Button onClick={() => void run({ k: "stock" })}>+{ADMIN.grant} ресурсов</Button>
        <Button onClick={() => void run({ k: "unlock" })}>Открыть всё</Button>
        <Button onClick={() => setSpeed(speed.value === 4 ? 1 : 4)}>Скорость {speed.value === 4 ? "×1" : "×4"}</Button>
      </div>
      <div class="admin-sub">Исследовать кликом по карте, радиус:</div>
      <div class="admin-grid">
        {RADII.map((m) => (
          <Button key={m} variant={r === m ? "primary" : "default"} aria-pressed={r === m} onClick={() => (revealRadius.value = r === m ? null : m)}>
            {m} м
          </Button>
        ))}
      </div>
      <div class="admin-sub">Открыть панель: клавиша ё / `</div>
    </div>
  );
}
