import { prefersReducedMotion } from "../../map/motion";
import type { Engine } from "../../engine/engine";
import type { CameraControl, CameraTarget } from "../../engine/camera/cameraControl";
import type { Camera, CameraGoal, LngLat, Overlay, OverlayId, ScreenPoint, View, ViewEvents, ViewMarker, ViewPointer } from "../view";
import { distanceToMpp, markerTransform, mppToDistance, type MarkerAnchor } from "./scale";
import { labelSight } from "./labelSight";
import { PointerClickTracker } from "./pointer";

// Same pin as MapLibre's default marker, tinted.
const pinSvg = (color: string) =>
  `<svg display="block" width="27" height="41" viewBox="0 0 27 41" xmlns="http://www.w3.org/2000/svg"><path d="M13.5 0C6 0 0 6 0 13.5 0 23.6 13.5 41 13.5 41S27 23.6 27 13.5C27 6 21 0 13.5 0z" fill="${color}" stroke="#000" stroke-opacity=".3"/><circle cx="13.5" cy="13.5" r="5" fill="#fff"/></svg>`;

// The View on the own engine: the canvas is the engine's, the camera is its control, events come from the canvas.
export function createEngineView(engine: Engine, camera: CameraControl, container: HTMLElement): View {
  const canvas = engine.canvas;
  const heightPx = () => canvas.clientHeight || 1;
  const fov = () => engine.state.fovY;

  const target = (goal: CameraGoal): CameraTarget => ({
    ...(goal.center && { lng: goal.center[0], lat: goal.center[1] }),
    ...(goal.distance !== undefined ? { distance: goal.distance } : goal.mpp !== undefined ? { distance: mppToDistance(goal.mpp, fov(), heightPx()) } : {}),
    ...(goal.heading !== undefined && { heading: goal.heading }),
    ...(goal.pitch !== undefined && { pitch: goal.pitch }),
  });

  const local = (e: MouseEvent): ScreenPoint => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  // Markers: DOM over the canvas, repositioned every frame. Being DOM, the ground cannot cover them: one behind a hill
  // is hidden by its line of sight, as labels are. Game chrome, so screenshot mode hides the layer (layout.css).
  const layer = document.createElement("div");
  layer.className = "engine-markers";
  layer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1";
  container.append(layer);
  type Marker = { key: string; at: LngLat; holder: HTMLElement; anchor: MarkerAnchor };
  const markers = new Set<Marker>();
  const hidden = labelSight(engine);
  let nextKey = 0;
  const place = (m: Marker) => {
    const ground = engine.groundAt(m.at[1], m.at[0]) ?? 0;
    const p = engine.project(m.at[1], m.at[0], ground);
    // Only markers on screen ask for a line of sight: a ray costs, and one off screen is clipped by the layer anyway.
    const off = !p || p[0] < 0 || p[1] < 0 || p[0] > canvas.clientWidth || p[1] > canvas.clientHeight;
    if (!p || (!off && hidden(m.key, m.at[1], m.at[0], ground))) m.holder.style.display = "none";
    else {
      m.holder.style.display = "";
      m.holder.style.transform = markerTransform(p[0], p[1], m.anchor);
    }
  };
  engine.onFrame(() => markers.forEach(place));

  // Overlays (road preview, lots, radii...) go to the engine's overlay raster; how each looks is in overlayStyles.ts.
  const overlays = new Map<OverlayId, Overlay>();

  return {
    canvas,
    container,

    camera(): Camera {
      const s = engine.state;
      return { center: [s.lng, s.lat], distance: s.distance, heading: s.heading, pitch: s.pitch };
    },
    metersPerPixel: () => distanceToMpp(engine.state.distance, fov(), heightPx()),
    jumpTo: (goal) => camera.jumpTo(target(goal)),
    flyTo(goal) {
      if (prefersReducedMotion()) camera.jumpTo(target(goal));
      else camera.flyTo(target(goal));
    },
    fitBounds(bounds, { padding, minMpp }) {
      camera.fitBounds(bounds, { padding, minDistance: mppToDistance(minMpp, fov(), heightPx()), animate: !prefersReducedMotion() });
    },

    setPanEnabled: (on) => camera.setPanEnabled(on),
    setDoubleClickZoomEnabled: (on) => camera.setDoubleClickZoomEnabled(on),

    project(at) {
      const p = engine.project(at[1], at[0], engine.groundAt(at[1], at[0]) ?? 0);
      return p ? ([p[0], p[1]] as ScreenPoint) : ([NaN, NaN] as ScreenPoint);
    },
    // The drape's water mask (what the player sees); sea level stands in until a page covers the point. Sky counts as
    // water too, so nothing gets founded there.
    isWaterAt(point) {
      const p = engine.pick(point[0], point[1]);
      if (!p) return true;
      const w = engine.terrain.waterAt(p.lat, p.lng);
      return w === null ? p.h <= 0 : w >= 0.5;
    },

    on<K extends keyof ViewEvents>(type: K, fn: (e: ViewEvents[K]) => void) {
      const call = fn as (e: ViewPointer) => void;
      const dispatch = (e: MouseEvent): void => {
        const point = local(e);
        const g = engine.pick(point[0], point[1]);
        if (!g) return; // game tools only act on the planet, never on the sky
        const pointer = e as PointerEvent;
        const hasPointer = typeof pointer.pointerId === "number";
        call({
          lngLat: [g.lng, g.lat],
          point,
          original: e,
          pointerId: hasPointer ? pointer.pointerId : null,
          pointerType: hasPointer ? pointer.pointerType : null,
          isPrimary: hasPointer ? pointer.isPrimary : true,
        });
      };

      if (type === "click") {
        const clicks = new PointerClickTracker();
        const onPointerDown = (e: PointerEvent) => clicks.pointerDown(e.pointerId, local(e));
        const onPointerMove = (e: PointerEvent) => clicks.pointerMove(e.pointerId, local(e));
        const onPointerUp = (e: PointerEvent) => clicks.pointerUp(e.pointerId);
        const onPointerCancel = (e: PointerEvent) => clicks.pointerCancel(e.pointerId);
        const onClick = (e: MouseEvent) => {
          const pointerId = (e as PointerEvent).pointerId;
          if (typeof pointerId === "number" && pointerId >= 0) {
            if (!clicks.isClick(pointerId, local(e))) return;
          } else if (e.detail !== 0 && !clicks.isClick(null, local(e))) {
            return; // non-PointerEvent browsers still get drag-filtered clicks
          }
          dispatch(e);
        };
        canvas.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
        canvas.addEventListener("click", onClick);
        return () => {
          canvas.removeEventListener("pointerdown", onPointerDown);
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerCancel);
          canvas.removeEventListener("click", onClick);
        };
      }

      if (type === "contextmenu") {
        const onContextMenu = (e: MouseEvent) => dispatch(e);
        canvas.addEventListener("contextmenu", onContextMenu);
        return () => canvas.removeEventListener("contextmenu", onContextMenu);
      }

      if (type === "pointerdown") {
        const onPointer = (e: PointerEvent) => {
          try {
            canvas.setPointerCapture(e.pointerId);
          } catch {
            /* the pointer may already have been released */
          }
          dispatch(e);
        };
        canvas.addEventListener("pointerdown", onPointer);
        return () => canvas.removeEventListener("pointerdown", onPointer);
      }

      if (type === "pointermove") {
        const onPointer = (e: PointerEvent) => dispatch(e);
        canvas.addEventListener("pointermove", onPointer);
        return () => canvas.removeEventListener("pointermove", onPointer);
      }

      if (type === "pointerup") {
        const onPointer = (e: PointerEvent) => dispatch(e);
        canvas.addEventListener("pointerup", onPointer);
        return () => canvas.removeEventListener("pointerup", onPointer);
      }

      return camera.on(type as "move", fn as () => void);
    },

    // The pin's tip stands on the point; a custom element is centred on it unless it asks for its bottom (MapLibre's).
    addMarker(opts, at): ViewMarker {
      const holder = document.createElement("div");
      holder.style.cssText = "position:absolute;left:0;top:0;will-change:transform";
      let anchor: MarkerAnchor;
      if ("element" in opts) {
        anchor = opts.anchor ?? "center";
        holder.append(opts.element);
      } else {
        anchor = "bottom";
        holder.innerHTML = pinSvg(opts.color);
      }
      layer.append(holder);
      const m: Marker = { key: `m${nextKey++}`, at, holder, anchor };
      markers.add(m);
      place(m);
      return {
        setLngLat(next) {
          m.at = next;
          place(m);
        },
        remove() {
          markers.delete(m);
          holder.remove();
        },
      };
    },
    overlay(id) {
      let o = overlays.get(id);
      if (!o) {
        o = { setData: (data) => engine.overlay.setData(id, data) };
        overlays.set(id, o);
      }
      return o;
    },
  };
}
