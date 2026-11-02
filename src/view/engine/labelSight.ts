import type { Engine } from "../../engine/engine";

// Labels hidden behind hills (docs/PLAN-engine.md N6): a label's line of sight to the eye (Engine.behindTerrain) is
// looked at again only every few frames, each label at its own moment, so a hundred labels cost a few rays a frame.

const EVERY_MS = 200;
const LIFT = 3; // m: labels hang a little over their spot

export function labelSight(engine: Engine): (key: string, lat: number, lng: number, ground: number) => boolean {
  const memo = new Map<string, { at: number; hidden: boolean }>();
  return (key, lat, lng, ground) => {
    const now = performance.now();
    let m = memo.get(key);
    if (!m || now - m.at > EVERY_MS) {
      if (memo.size > 2000) memo.clear();
      m = { at: m ? now : now - Math.random() * EVERY_MS, hidden: engine.behindTerrain(lat, lng, ground + LIFT) };
      memo.set(key, m);
    }
    return m.hidden;
  };
}
