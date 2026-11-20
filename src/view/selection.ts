import { signal } from "@preact/signals";

// The interaction state the tools, the layers and the UI share: what the pointer picked on the map (the id of the
// building, picked by view/layers/buildings.ts, and of the unfinished clearing, picked by view/layers/land.ts) and the
// field being drawn (map/landTool.ts writes the draft, view/layers/land.ts draws it). Everyone imports this view root
// module, never the layer internals.
export const selectedBuilding = signal<number | null>(null);
export const selectedClearing = signal<number | null>(null);
export const fieldDraft = signal<{ pts: [number, number][]; ok: boolean } | null>(null);
