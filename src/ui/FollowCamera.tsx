import type * as maplibregl from "maplibre-gl";
import { useEffect } from "preact/hooks";
import { calendar } from "../sim/clock";
import { isWorkHour } from "../sim/levers";
import { START_MINUTE_OF_DAY } from "../sim/time";
import { frame, gameNow, lifeTrips, queryResident, state } from "../simClient";
import { tool } from "../map/tools";
import { followed, followInfo, stopFollowing } from "./follow";
import { residentPoint, residentWalk } from "./followModel";
import { PALETTE } from "./palette";

const SRC = "follow-target";
const LAYER = "follow-target";
const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

// Keeps the camera on the followed resident and draws an amber ring around them. It reads the same
// cosmetic trips the walkers are drawn from, so following costs the simulation nothing.
export function FollowCamera({ map }: { map: maplibregl.Map }) {
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

    const setup = () => {
      if (!alive || !map.isStyleLoaded() || map.getSource(SRC)) return;
      map.addSource(SRC, { type: "geojson", data: empty() });
      const before = map.getLayer("life-walkers") ? "life-walkers" : undefined;
      map.addLayer(
        {
          id: LAYER,
          type: "circle",
          source: SRC,
          paint: {
            "circle-radius": 12,
            "circle-color": PALETTE.warn,
            "circle-opacity": 0.12,
            "circle-stroke-color": PALETTE.warn,
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.9,
            "circle-pitch-alignment": "map",
          },
        },
        before,
      );
    };

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
      map.jumpTo({ center: lngLat, ...(first ? { zoom: Math.max(map.getZoom(), 16) } : {}) });
      first = false;
      const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: lngLat } }],
        });
      }
    };

    if (map.isStyleLoaded()) setup();
    else map.once("load", setup);
    map.on("styledata", setup);
    map.on("dragstart", onDrag);
    raf = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      map.off("styledata", setup);
      map.off("dragstart", onDrag);
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SRC)) map.removeSource(SRC);
    };
  }, [map, target?.id]);

  return null;
}
