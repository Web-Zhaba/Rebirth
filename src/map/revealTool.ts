import type maplibregl from "maplibre-gl";
import { effect, signal } from "@preact/signals";
import { frame, sendCmd } from "../simClient";
import { PALETTE } from "../ui/palette";
import { flash, tool } from "./tools";

// Admin: radius (m) of the next click that reveals the old city there; null = tool off.
export const revealRadius = signal<number | null>(null);

const CIRCLE_STEPS = 64;
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// A click on the map reveals everything buried inside the circle at once.
export function attachRevealTool(map: maplibregl.Map): void {
  let ready = false;
  let at: [number, number] | null = null; // local m under the cursor
  const source = () => map.getSource("reveal-disc") as maplibregl.GeoJSONSource | undefined;

  const setup = () => {
    if (ready || !map.isStyleLoaded()) return ready;
    ready = true;
    map.addSource("reveal-disc", { type: "geojson", data: EMPTY });
    map.addLayer({ id: "reveal-disc-fill", type: "fill", source: "reveal-disc", paint: { "fill-color": PALETTE.info, "fill-opacity": 0.18 } });
    map.addLayer({ id: "reveal-disc-line", type: "line", source: "reveal-disc", paint: { "line-color": PALETTE.info, "line-width": 2, "line-dasharray": [3, 2] } });
    return true;
  };

  const draw = () => {
    const f = frame.value;
    const r = revealRadius.value;
    if (!setup()) return;
    if (!f || r === null || !at) return source()?.setData(EMPTY);
    const ring: [number, number][] = [];
    for (let i = 0; i <= CIRCLE_STEPS; i++) {
      const a = (i / CIRCLE_STEPS) * Math.PI * 2;
      ring.push(f.toLngLat(at[0] + r * Math.cos(a), at[1] + r * Math.sin(a)));
    }
    source()?.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] });
  };

  map.on("mousemove", (e) => {
    const f = frame.value;
    if (revealRadius.value === null || !f) return;
    at = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    draw();
  });
  map.on("click", (e) => {
    const f = frame.value;
    const r = revealRadius.value;
    if (r === null || !f) return;
    const [x, y] = f.toLocal(e.lngLat.lng, e.lngLat.lat);
    sendCmd({ type: "admin", op: { k: "reveal", x, y, r } }).then((res) => {
      if (!res.ok) flash(res.reason ?? "Не вышло");
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
