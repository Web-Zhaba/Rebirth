import { TOWN_VIEW_MPP } from "../view/scale";
import type { View } from "../view/view";
import { useEffect } from "preact/hooks";
import { calendar } from "../sim/clock";
import { isWorkHour } from "../sim/levers";
import { START_MINUTE_OF_DAY } from "../sim/time";
import { frame, gameNow, lifeTrips, queryResident, state } from "../simClient";
import { tool } from "../map/tools";
import { followed, followInfo, stopFollowing } from "./follow";
import { residentPoint, residentWalk } from "./followModel";
import { PALETTE } from "./palette";

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

// Keeps the camera on the followed resident and draws an amber ring around them. It reads the same
// cosmetic trips the walkers are drawn from, so following costs the simulation nothing.
export function FollowCamera({ view }: { view: View }) {
  const target = followed.value;
  const activeTool = tool.value;

  // A tool takes the map: stop following rather than fight the player's next click.
  useEffect(() => {
    if (activeTool && followed.value) stopFollowing();
  }, [activeTool]);

  // Who they are and where they live/work: refreshed while followed, so a new job or home is picked up.
  useEffect(() => {
    if (!target) {
      followInfo.value = null;
      return;
    }
    let alive = true;
    const load = () =>
      void queryResident(target.id).then((q) => {
        if (alive) followInfo.value = q;
      });
    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [target?.id]);

  useEffect(() => {
    if (!target) return;
    let alive = true;
    let raf = 0;
    let last = 0;
    let lastKey = "";
    let first = true;

    // A drag means the player wants the map back: stop following instead of fighting the camera.
    const onDrag = () => stopFollowing();

    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (ts - last < 50) return;
      last = ts;
      const fl = frame.peek();
      const st = state.peek();
      if (!fl || !st) return;
      const gm = gameNow();
      const minute = (((gm + START_MINUTE_OF_DAY) % 1440) + 1440) % 1440;
      const info = followInfo.peek();
      const walk = residentWalk(lifeTrips.peek(), target.id, minute);
      const working = isWorkHour(calendar(gm).hour, st.levers);
      const at = walk?.pos ?? (info ? residentPoint(info, working, st.buildings) : null);
      if (!at) return;
      const key = `${at[0].toFixed(1)},${at[1].toFixed(1)}`;
      if (key === lastKey) return;
      lastKey = key;
      const lngLat = fl.toLngLat(at[0], at[1]);
      view.jumpTo({ center: lngLat, ...(first ? { mpp: Math.min(view.metersPerPixel(), TOWN_VIEW_MPP) } : {}) });
      first = false;
      view.overlay("follow-target").setData({
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lngLat } }],
      });
    };

    const offDrag = view.on("dragstart", onDrag);
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      offDrag();
      view.overlay("follow-target").setData(empty());
    };
  }, [view, target?.id]);

  return null;
}
