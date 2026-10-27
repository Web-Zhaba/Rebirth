import { effect, signal, type Signal } from "@preact/signals";

// Graphics effects the player can turn off for a lighter map (the settings dialog). No three.js here: the dialog and
// the map layers both import it.

function stored(key: string): { on: Signal<boolean>; set: (v: boolean) => void } {
  let initial = true;
  try {
    initial = localStorage.getItem(key) !== "0";
  } catch {
    /* no storage: on */
  }
  const on = signal(initial);
  const set = (v: boolean) => {
    on.value = v;
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* no storage: the choice lives for the session */
    }
  };
  return { on, set };
}

const forest = stored("rebirth.forest3d");
const water = stored("rebirth.water3d");
const fields = stored("rebirth.fields3d");
const smoke = stored("rebirth.smoke3d");
const motion = stored("rebirth.motion");

// The 3D forest (treeLayer.ts); off, the forest is the 2D fill.
export const forest3dOn = forest.on;
export const setForest3d = forest.set;
// The 3D water (waterLayer.ts); off, the water is the 2D fill.
export const water3dOn = water.on;
export const setWater3d = water.set;
// The 3D farm fields (fieldLayer.ts); off, the fields are the 2D fill and furrow lines.
export const fields3dOn = fields.on;
export const setFields3d = fields.set;
// The smoke from chimneys (smokeLayer.ts); off, no smoke.
export const smoke3dOn = smoke.on;
export const setSmoke3d = smoke.set;
// Trees swaying in the wind and the water rippling; off, both stand still and the map is not redrawn every frame.
export const motionOn = motion.on;
export const setMotion = motion.set;

// Seconds for the animated shaders: the clock, held still while the motion is off.
let still = performance.now() / 1000;
export function motionTime(): number {
  if (motionOn.peek()) still = performance.now() / 1000;
  return still;
}

// Shows a 3D layer while its setting is on (a hidden custom layer is not rendered at all); returns the stop.
export function showWhile(map: { getLayer(id: string): unknown; setLayoutProperty(id: string, k: string, v: string): unknown; triggerRepaint(): void }, id: string, on: Signal<boolean>): () => void {
  return effect(() => {
    const v = on.value;
    void motionOn.value; // the layers start or stop asking for frames
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
    map.triggerRepaint();
  });
}
