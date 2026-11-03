// What the game side (src/view/engine/) asks of the engine's camera. Implemented by the input controller in this folder;
// goals are absolute camera values, the view backend converts metres-per-pixel goals to distances before calling.

export interface CameraTarget {
  lat?: number;
  lng?: number;
  distance?: number; // m, eye to target
  heading?: number; // deg
  pitch?: number; // deg
}

export interface CameraEvents {
  dragstart: void; // the player started moving the camera's centre by hand (drag, touch, arrow keys); zoom and turns do not count
  move: void; // the camera changed this frame
  moveend: void; // it stopped (after inertia and flights)
}

export interface CameraControl {
  jumpTo(t: CameraTarget): void; // centre only: a zoom or turn in progress goes on about the new centre
  flyTo(t: CameraTarget, opts?: { duration?: number }): void; // ms; a smooth arc that zooms out on long hops
  fitBounds(bounds: [west: number, south: number, east: number, north: number], opts: { padding: number; minDistance: number; animate: boolean }): void;
  setPanEnabled(on: boolean): void;
  setDoubleClickZoomEnabled(on: boolean): void;
  on<K extends keyof CameraEvents>(type: K, fn: (e: CameraEvents[K]) => void): () => void;
  dispose(): void;
}
