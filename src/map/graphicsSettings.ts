import { signal, type Signal } from "@preact/signals";

// Graphics effects the player can turn off for a lighter map (the settings dialog).

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

try {
  localStorage.removeItem("rebirth.water3d");
} catch {
  /* no storage */
}

const forest = stored("rebirth.forest3d");
const fields = stored("rebirth.fields3d");
const smoke = stored("rebirth.smoke3d");
const motion = stored("rebirth.motion");

// The 3D forest (view/engine/forest.ts); off, the forest is the drape's colour alone.
export const forest3dOn = forest.on;
export const setForest3d = forest.set;

// The 3D farm fields (view/engine/fields.ts); off, the fields are the overlay's fill and furrows.
export const fields3dOn = fields.on;
export const setFields3d = fields.set;

// The smoke from chimneys (view/engine/smoke.ts); off, no smoke.
export const smoke3dOn = smoke.on;
export const setSmoke3d = smoke.set;

// Trees swaying in the wind and the water rippling; off, both stand still.
export const motionOn = motion.on;
export const setMotion = motion.set;

// Seconds for the animated shaders: the clock, held still while the motion is off.
let still = performance.now() / 1000;

export function motionTime(): number {
  if (motionOn.peek()) {
    still = performance.now() / 1000;
  }

  return still;
}
