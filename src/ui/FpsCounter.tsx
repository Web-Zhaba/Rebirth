import type maplibregl from "maplibre-gl";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

// FPS in the bottom-left corner. Counts MapLibre's render events — the frames the map itself redraws
// (the shared three.js layers draw inside them). When the map is idle it repaints rarely, so the number
// drops to 0; that is the map being quiet, not a drop in the frame rate.
export function FpsCounter({ map }: { map: maplibregl.Map }) {
  const fps = useSignal(0);
  useEffect(() => {
    let frames = 0;
    const tick = () => {
      fps.value = Math.round((frames * 1000) / 500);
      frames = 0;
    };
    const onRender = () => frames++;
    map.on("render", onRender);
    const id = setInterval(tick, 500);
    tick();
    return () => {
      map.off("render", onRender);
      clearInterval(id);
    };
  }, [map]);
  return (
    <div class="fps" aria-hidden="true">
      <span class="fps-num">{fps}</span> fps
    </div>
  );
}
