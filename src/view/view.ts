// The game's window onto the world. UI and tools talk to this, never to the renderer, so
// the backend under src/view/ can be swapped for the own engine without touching them.
//
// No zoom levels: the camera is a target, an eye distance, heading and pitch; scale questions are answered in metres
// per CSS pixel at the camera target.

import type { FeatureCollection } from "geojson";

export type LngLat = [number, number];
export type ScreenPoint = [number, number]; // CSS px from the canvas's top-left corner

export interface Camera {
  center: LngLat; // the target on the ground
  distance: number; // m, eye to target
  heading: number; // deg clockwise from north
  pitch: number; // deg, 0 = looking straight down
}

// Where to put the camera. Scale is given either as `distance` or as `mpp` (metres per CSS px at the target), not both;
// anything left out keeps its current value.
export interface CameraGoal {
  center?: LngLat;
  distance?: number;
  mpp?: number;
  heading?: number;
  pitch?: number;
}

export interface ViewPointer {
  lngLat: LngLat; // ground under the pointer
  point: ScreenPoint;
  original: MouseEvent; // PointerEvent for pointer input; MouseEvent for contextmenu
  pointerId: number | null;
  pointerType: string | null;
  isPrimary: boolean;
}

export interface ViewEvents {
  click: ViewPointer;
  contextmenu: ViewPointer;
  pointerdown: ViewPointer;
  pointermove: ViewPointer;
  pointerup: ViewPointer;
  dragstart: void; // the player starts panning the camera
  move: void; // camera changed (every frame while it moves)
  moveend: void;
}

export interface ViewMarker {
  setLngLat(at: LngLat): void;
  remove(): void;
}

// Game data drawn by the view. The game owns the data; how an overlay looks belongs to the backend, keyed by id.
export type OverlayId =
  | "road-preview"
  | "road-hover"
  | "road-snap"
  | "place-lot"
  | "stroke-plan"
  | "stroke-skip"
  | "place-radius"
  | "reveal-disc"
  | "follow-target";

export interface Overlay {
  setData(data: FeatureCollection): void; // safe before the view is ready: the latest data is kept and shown when it is
}

export interface View {
  readonly canvas: HTMLCanvasElement;
  size(): [number, number]; // the canvas in CSS px, without asking the page for its layout
  readonly container: HTMLElement; // for DOM the tools pin over the map

  camera(): Camera;
  metersPerPixel(): number; // at the camera target
  jumpTo(goal: CameraGoal): void;
  flyTo(goal: CameraGoal): void; // a jump when the player prefers reduced motion
  fitBounds(bounds: [west: number, south: number, east: number, north: number], opts: { padding: number; minMpp: number }): void;

  // Drawing tools own the drag and the double click while they work; the player's own camera input is switched off.
  setPanEnabled(on: boolean): void;
  setDoubleClickZoomEnabled(on: boolean): void; // also box zoom

  project(at: LngLat): ScreenPoint;
  isWaterAt(point: ScreenPoint): boolean;

  on<K extends keyof ViewEvents>(type: K, fn: (e: ViewEvents[K]) => void): () => void; // returns the unsubscribe
  // A pin of `color` stands on the point; an element is centred on it, or stands on it with anchor "bottom".
  addMarker(opts: { element: HTMLElement; anchor?: "center" | "bottom" } | { color: string }, at: LngLat): ViewMarker;
  overlay(id: OverlayId): Overlay;
}

// Zoom thresholds of the old map turned into metres per CSS pixel. MapLibre's scale shrinks with cos(latitude); the
// game's thresholds are about pixel size, so they are fixed at a reference latitude of 55° (mid-Russia) and read the
// same everywhere.
export const REF_LAT = 55;
export const mppAtZoom = (zoom: number, lat = REF_LAT) => (2 * Math.PI * 6371008.8 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
// Its inverse, for the visual fades still written in the old zoom levels (clouds, weather cover).
export const zoomAtMpp = (mpp: number, lat = REF_LAT) => Math.log2((2 * Math.PI * 6371008.8 * Math.cos((lat * Math.PI) / 180)) / (512 * mpp));
