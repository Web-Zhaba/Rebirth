import { ecefToGeodetic, madd, radiiAt, length } from "../geo/ellipsoid";
import { clampState, rayDir, raySphere, type CameraState, type CameraView } from "./camera";

// Pointer and wheel input for the spike: left drag pans the target along the surface, right or ctrl drag turns
// heading/pitch, the wheel scales the distance towards the point under the cursor. N2 replaces this with the full
// controller set (inertia, touch, trackpad, fly); the camera state it drives stays the same.

const RAD = Math.PI / 180;

// Move the target by a screen-space drag, using metres per pixel at the target. Simple and the same from orbit to
// street level; pitch stretches the ground along the view direction, hence the 1/cos.
export function pan(s: CameraState, dxPx: number, dyPx: number, viewportH: number): void {
  const mpp = (2 * s.distance * Math.tan((s.fovY * RAD) / 2)) / viewportH;
  const along = (dyPx * mpp) / Math.max(0.3, Math.cos(s.pitch * RAD));
  const across = -dxPx * mpp;
  const sh = Math.sin(s.heading * RAD);
  const ch = Math.cos(s.heading * RAD);
  const dE = across * ch + along * sh;
  const dN = -across * sh + along * ch;
  const r = radiiAt(s.lat);
  // Far out, a drag can ask for more than a hemisphere; cap the step so the globe never jumps.
  const maxRad = 0.5;
  s.lat += (Math.max(-maxRad, Math.min(maxRad, dN / r.m)) / RAD);
  s.lng += (Math.max(-maxRad, Math.min(maxRad, dE / (r.n * Math.max(0.05, Math.cos(s.lat * RAD))))) / RAD);
  clampState(s);
}

export function rotate(s: CameraState, dxPx: number, dyPx: number): void {
  s.heading -= dxPx * 0.3;
  s.pitch -= dyPx * 0.3;
  clampState(s);
}

// Scale the distance; when the cursor ray hits the target's sphere close enough, slide the target towards that point
// by the same fraction so the spot under the cursor roughly stays put.
export function zoom(s: CameraState, v: CameraView | null, deltaY: number, ndcX: number, ndcY: number): void {
  const k = Math.exp(deltaY * 0.0015);
  const before = s.distance;
  s.distance *= k;
  clampState(s);
  const f = 1 - s.distance / before;
  if (!v || f <= 0) {
    clampState(s);
    return;
  }
  const d = rayDir(v, ndcX, ndcY);
  const t = raySphere(v.eye, d, length(v.target));
  if (t === null || t > 4 * before) return;
  const g = ecefToGeodetic(madd(v.eye, d, t));
  let dl = g.lng - s.lng;
  if (dl > 180) dl -= 360;
  if (dl < -180) dl += 360;
  s.lat += (g.lat - s.lat) * f;
  s.lng += dl * f;
  clampState(s);
}

export interface InputHost {
  state: CameraState;
  view(): CameraView | null;
  onChange?(): void;
}

// Wire DOM events on the canvas. Returns a disposer.
export function attachInput(canvas: HTMLCanvasElement, host: InputHost): () => void {
  let mode: "pan" | "rotate" | null = null;
  let lx = 0;
  let ly = 0;
  const down = (e: PointerEvent) => {
    mode = e.button === 2 || e.ctrlKey || e.button === 1 ? "rotate" : e.button === 0 ? "pan" : null;
    if (!mode) return;
    lx = e.clientX;
    ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (!mode) return;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
    if (mode === "pan") pan(host.state, dx, dy, canvas.clientHeight);
    else rotate(host.state, dx, dy);
    host.onChange?.();
  };
  const up = (e: PointerEvent) => {
    mode = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoom(host.state, host.view(), dy, nx, ny);
    host.onChange?.();
  };
  const menu = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", menu);
  return () => {
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("contextmenu", menu);
  };
}
