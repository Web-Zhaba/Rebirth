// Camera scales the game flies to, in metres per CSS pixel (smaller = closer). Each is the pixel size of an old map
// zoom (see mppAtZoom), kept as game logic so it does not depend on the renderer.

import { mppAtZoom } from "./view";

export const TOWN_START_MPP = mppAtZoom(14.5); // old zoom 14.5: first view of a town
export const FOUND_MPP = mppAtZoom(14); // old zoom 14: after picking a spot to found on, and the cap when fitting a place
export const TOWN_VIEW_MPP = mppAtZoom(16); // old zoom 16: «home» view of the town, start of following a resident
export const CLOSE_UP_MPP = mppAtZoom(17); // old zoom 17: when flying to a place on the town map

// Never farther than `mpp`: a fly-to that keeps a closer view as it is.
export const atLeastAsClose = (current: number, mpp: number) => Math.min(current, mpp);
