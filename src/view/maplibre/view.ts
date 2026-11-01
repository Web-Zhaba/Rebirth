import * as maplibregl from "maplibre-gl";
import { prefersReducedMotion } from "../../map/motion";
import type { Camera, CameraGoal, LngLat, ScreenPoint, View, ViewEvents, ViewMarker } from "../view";
import { createOverlays } from "./overlays";
import { goalZoom, metersPerPixel, mppToZoom, zoomToDistance } from "./zoom";

export type MapLibreView = View & { readonly map: maplibregl.Map }; // `map` is for DEV tooling only (window.map, the bench)

const POINTER_EVENTS = ["click", "contextmenu", "mousedown", "mousemove", "mouseup"] as const;

// The View on a MapLibre map. Scale is converted through the zoom the map keeps, using the canvas height in CSS px.
export function createMapLibreView(map: maplibregl.Map): MapLibreView {
  const canvas = map.getCanvas();
  const heightPx = () => canvas.clientHeight || 1;

  // A goal as MapLibre options. `lat` is the latitude of the centre the camera ends up at.
  const options = (goal: CameraGoal) => {
    const lat = (goal.center ?? [0, map.getCenter().lat])[1];
    const zoom = goalZoom(goal, lat, heightPx());
    return {
      ...(goal.center && { center: goal.center }),
      ...(zoom !== undefined && { zoom }),
      ...(goal.heading !== undefined && { bearing: goal.heading }),
      ...(goal.pitch !== undefined && { pitch: goal.pitch }),
    };
  };

  const overlay = createOverlays(map);

  return {
    map,
    canvas,
    container: map.getContainer(),

    camera(): Camera {
      const c = map.getCenter();
      return { center: [c.lng, c.lat], distance: zoomToDistance(map.getZoom(), c.lat, heightPx()), heading: map.getBearing(), pitch: map.getPitch() };
    },
    metersPerPixel: () => metersPerPixel(map.getZoom(), map.getCenter().lat),
    jumpTo: (goal) => void map.jumpTo(options(goal)),
    flyTo(goal) {
      if (prefersReducedMotion()) map.jumpTo(options(goal));
      else map.flyTo(options(goal));
    },
    fitBounds(bounds, { padding, minMpp }) {
      const [w, s, e, n] = bounds;
      map.fitBounds([w, s, e, n], { padding, maxZoom: mppToZoom(minMpp, (s + n) / 2), ...(prefersReducedMotion() && { duration: 0 }) });
    },

    setPanEnabled(on) {
      if (on) map.dragPan.enable();
      else map.dragPan.disable();
    },
    setDoubleClickZoomEnabled(on) {
      if (on) {
        map.doubleClickZoom.enable();
        map.boxZoom.enable();
      } else {
        map.doubleClickZoom.disable();
        map.boxZoom.disable();
      }
    },

    project(at) {
      const p = map.project(at);
      return [p.x, p.y] as ScreenPoint;
    },
    isWaterAt: (point) => map.queryRenderedFeatures(point, { layers: ["water"] }).length > 0,

    on<K extends keyof ViewEvents>(type: K, fn: (e: ViewEvents[K]) => void) {
      if ((POINTER_EVENTS as readonly string[]).includes(type)) {
        const handler = (e: maplibregl.MapMouseEvent) => (fn as (e: ViewEvents["click"]) => void)({ lngLat: [e.lngLat.lng, e.lngLat.lat] as LngLat, point: [e.point.x, e.point.y] as ScreenPoint, original: e.originalEvent });
        map.on(type as (typeof POINTER_EVENTS)[number], handler);
        return () => void map.off(type as (typeof POINTER_EVENTS)[number], handler);
      }
      const handler = () => (fn as () => void)();
      map.on(type as "move", handler);
      return () => void map.off(type as "move", handler);
    },
    addMarker(opts, at): ViewMarker {
      return new maplibregl.Marker(opts).setLngLat(at).addTo(map);
    },
    overlay,
  };
}
