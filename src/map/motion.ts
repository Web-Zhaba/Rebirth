import type maplibregl from "maplibre-gl";

export const prefersReducedMotion = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Camera move that respects the reduced-motion setting: a jump instead of a flight.
export function flyOrJump(map: maplibregl.Map, opts: maplibregl.FlyToOptions): void {
  if (!prefersReducedMotion()) return void map.flyTo(opts);
  const jump: maplibregl.JumpToOptions = {};
  if (opts.center) jump.center = opts.center;
  if (opts.zoom !== undefined) jump.zoom = opts.zoom;
  if (opts.bearing !== undefined) jump.bearing = opts.bearing;
  if (opts.pitch !== undefined) jump.pitch = opts.pitch;
  map.jumpTo(jump);
}

// Below the medium breakpoint (layout.css): collapsible panels start collapsed unless the player chose otherwise.
export const compactScreen = (): boolean => typeof matchMedia === "function" && matchMedia("(max-width: 1099px)").matches;
