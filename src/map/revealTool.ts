import type { View } from "../view/view";
import { effect, signal } from "@preact/signals";
import { frame, sendCmd } from "../simClient";
import { flash, tool } from "./tools";
import { L } from "../i18n";

// Admin: radius (m) of the next click that reveals the old city there; null = tool off.
export const revealRadius = signal<number | null>(null);

const CIRCLE_STEPS = 64;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// A click on the map reveals everything buried inside the circle at once.
export function attachRevealTool(view: View): void {
  let at: [number, number] | null = null; // local m under the cursor
  const draw = () => {
    const f = frame.value;
    const r = revealRadius.value;
    if (!f || r === null || !at) return view.overlay("reveal-disc").setData(EMPTY);
    const ring: [number, number][] = [];
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const a = (i / CIRCLE_STEPS) * Math.PI * 2;
      ring.push(f.toLngLat(at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)));
    }
    view.overlay("reveal-disc").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] });
  };

  view.on("pointermove", (e) => {
    const f = frame.value;
    if (revealRadius.value === null || !f) return;
    at = f.toLocal(e.lngLat[0], e.lngLat[1]);
    draw();
  });
  view.canvas.addEventListener("pointerleave", () => {
    at = null;
    draw();
  });
  view.on("click", (e) => {
    const f = frame.value;
    const r = revealRadius.value;
    if (r === null || !f) return;
    const [x, y] = f.toLocal(e.lngLat[0], e.lngLat[1]);
    sendCmd({ type: "admin", op: { k: "reveal", x, y, r } }).then((res) => {
      if (!res.ok) flash(res.reason ?? L("Не вышло", "That didn't work"));
    });
  });
  // Another build tool, or switching this one off, clears the circle.
  effect(() => {
    if (tool.value) revealRadius.value = null;
  });
  effect(() => {
    void revealRadius.value;
    draw();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && revealRadius.value !== null) revealRadius.value = null;
  });
}
