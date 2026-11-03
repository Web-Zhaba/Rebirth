import type { Engine } from "../../engine/engine";

// Labels hidden behind hills (docs/PLAN-engine.md N6): a label's line of sight to the eye (Engine.behindTerrain) is
// looked at again only every few frames, each label at its own moment, so a hundred labels cost a few rays a frame.
// At most RAYS_PER_FRAME rays a frame: zooming out brings hundreds of new names at once, and a label not looked at yet
// stays hidden until its turn comes a frame or two later.

const EVERY_MS = 200;
const LIFT = 3; // m: labels hang a little over their spot
const RAYS_PER_FRAME = 48;

export function labelSight(engine: Engine): (key: string, lat: number, lng: number, ground: number) => boolean {
  const memo = new Map<string, { at: number; hidden: boolean }>();
  let view = engine.view;
  let rays = 0;
  return (key, lat, lng, ground) => {
    if (engine.view !== view) (view = engine.view), (rays = 0); // a new frame
    const now = performance.now();
    let m = memo.get(key);
    if (!m || now - m.at > EVERY_MS) {
      if (rays >= RAYS_PER_FRAME) return m?.hidden ?? true;
      rays++;
      m = { at: m ? now : now - Math.random() * EVERY_MS, hidden: engine.behindTerrain(lat, lng, ground + LIFT) };
      // Re-inserted, so the oldest looked-at label goes first when the memo is full (clearing it all asked again at once).
      memo.delete(key);
      memo.set(key, m);
      if (memo.size > 2000) memo.delete(memo.keys().next().value!);
    }
    return m.hidden;
  };
}
