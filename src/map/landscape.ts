import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { frame } from "../simClient";
import type { ModelLayerOptions } from "./modelLayer";
import type { WeatherState } from "../sim/weather";
import { groundAt, loadGround, reliefScale } from "./relief";

const LANDSCAPE_FROM_ZOOM = 12.5;

export function attachLandscape(
  map: maplibregl.Map,
  opts: { light?: ModelLayerOptions["light"]; weather: ReadonlySignal<WeatherState | null> },
): void {
  let started = false;

  const baseLayers = [
    "landcover",
    "forest-edge",
    "hillshade",
    "shore",
    "water",
    "waterway",
  ];

  // Legacy 2D gameplay layers are not terrain-aware. At close range they must
  // not be composited over the custom DEM mesh at sea-level; built roads already
  // have 3D road models, and zone fills are converted to shallow elevation-aware
  // extrusions in zoneLayer.ts.
  const groundOverlays = [
    "roads-casing",
    "roads-built",
    "roads-planned",
    "roads-cut",
    "clearings-line",
    "fields-fill",
    "fields-furrows",
    "fields-line",
    "zones-pattern",
    "zones-grid",
    "zone-hover",
    "field-draft-fill",
    "field-draft-line",
    "field-draft-pts",
    "buildings-planned",
    "buildings-outline",
  ];

  let syncingCamera = false;
  let waitingForGround = false;
  const originalMaxZoom = map.getMaxZoom();

  const syncCameraToLandscape = () => {
    if (syncingCamera || !map.isStyleLoaded()) return;

    const zoom = map.getZoom();
    const active = zoom >= LANDSCAPE_FROM_ZOOM && reliefScale.peek() > 0;

    // Near the surface, a lower max pitch gives the orbit camera enough
    // clearance over the DEM instead of letting it skim through mountain faces.
    const maxPitch = !active ? 75 : zoom >= 18 ? 30 : zoom >= 16.5 ? 42 : 58;
    if (Math.abs(map.getMaxPitch() - maxPitch) > 0.1) {
      map.setMaxPitch(maxPitch);
    }

    // At extreme zooms the MapLibre orbit camera can enter tall buildings and
    // tree crowns. The game models are designed for a town-scale view, so cap
    // close terrain mode before the camera becomes an interior/FPS camera.
    const maxZoom = active ? Math.min(originalMaxZoom, 18.5) : originalMaxZoom;
    if (Math.abs(map.getMaxZoom() - maxZoom) > 0.01) {
      map.setMaxZoom(maxZoom);
    }

    if (!active) {
      if (!map.getCenterClampedToGround()) {
        syncingCamera = true;
        map.setCenterClampedToGround(true);
        syncingCamera = false;
      }
      return;
    }

    if (map.getCenterClampedToGround()) {
      map.setCenterClampedToGround(false);
    }

    const center = map.getCenter();
    const elevation = groundAt(center.lng, center.lat);

    if (elevation === null) {
      if (!waitingForGround) {
        waitingForGround = true;
        void loadGround([[center.lng, center.lat]]).finally(() => {
          waitingForGround = false;
          syncCameraToLandscape();
        });
      }
      return;
    }

    // Keep MapLibre's camera pivot on the same exaggerated surface as our
    // custom terrain. Without this, orbit/rotate still pivots around sea level.
    const wanted = Math.max(0, elevation * reliefScale.peek()) + 0.8;
    if (Math.abs(map.getCenterElevation() - wanted) < 1.0) return;

    syncingCamera = true;
    map.setCenterElevation(wanted, { landscapeCamera: true });
    syncingCamera = false;
  };

  const syncBaseVisibility = () => {
    const customWorld =
      map.getZoom() >= LANDSCAPE_FROM_ZOOM &&
      reliefScale.peek() > 0;

    const visibility = customWorld ? "none" : "visible";

    for (const id of baseLayers) {
      if (!map.getLayer(id)) continue;
      if (map.getLayoutProperty(id, "visibility") === visibility) continue;
      map.setLayoutProperty(id, "visibility", visibility);
    }

    for (const id of groundOverlays) {
      if (!map.getLayer(id)) continue;

      // These are all legacy 2D overlays tied to MapLibre's sea-level plane.
      // Built roads and farm fields have their own terrain-seated 3D renderers;
      // showing the old GeoJSON lines/fills at town zoom makes them cut through
      // hills, foundations and the custom surface.
      const overlayVisibility = customWorld ? "none" : "visible";

      if (map.getLayoutProperty(id, "visibility") === overlayVisibility) continue;
      map.setLayoutProperty(id, "visibility", overlayVisibility);
    }

    syncCameraToLandscape();
  };

  const check = () => {
    syncBaseVisibility();

    if (started || !frame.peek() || map.getZoom() < LANDSCAPE_FROM_ZOOM) return;

    started = true;

    void import("./landscapeLayer").then((m) =>
      m.attachLandscapeLayer(map, {
        frame,
        light: opts.light,
        weather: opts.weather,
      }),
    );
  };

  map.on("zoom", syncBaseVisibility);
  map.on("zoomend", check);
  map.on("moveend", syncCameraToLandscape);
  map.on("styledata", syncBaseVisibility);

  const stopFrame = effect(() => {
    void frame.value;
    check();
  });
  const stopRelief = effect(() => {
    void reliefScale.value;
    syncBaseVisibility();
  });

  syncBaseVisibility();

  // The main bootstrap currently doesn't retain this function, but keeping
  // cleanup attached to map removal prevents listeners surviving a style reset.
  map.once("remove", () => {
    stopFrame();
    stopRelief();
    map.off("zoom", syncBaseVisibility);
    map.off("zoomend", check);
    map.off("moveend", syncCameraToLandscape);
    map.off("styledata", syncBaseVisibility);
  });
}
