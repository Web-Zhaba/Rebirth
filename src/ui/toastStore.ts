import { effect, signal } from "@preact/signals";
import { state } from "../simClient";
import { play } from "./sound";
import { diffEvents, isImportant, pushToast, soundFor, type Toast } from "./toastModel";

// The stack of toasts, fed from the snapshot's event ring. The first snapshot after a load or a new town
// is only a baseline: history is never replayed.
export const toasts = signal<Toast[]>([]);

// The last unique old building uncovered since the page loaded (docs/PLAN-restoration.md section 5): the map flies to it
// and its card opens (Toasts.tsx). Not on a baseline snapshot: history is never replayed.
export const discovered = signal<{ site: string; pos: [number, number]; n: number } | null>(null);
let discoveries = 0;

let seen: Set<string> | null = null;
let nextId = 1;

export const dismissToast = (id: number): void => {
  toasts.value = toasts.value.filter((t) => t.id !== id);
};

effect(() => {
  const s = state.value;
  if (!s) {
    seen = null;
    toasts.value = [];
    return;
  }
  const r = diffEvents(s.events, seen);
  seen = r.seen;
  if (r.fresh.length === 0) return;
  if (r.fresh.some((e) => soundFor(e.kind))) play("finished");
  let list = toasts.peek();
  for (const e of r.fresh) {
    list = pushToast(list, { id: nextId++, kind: e.kind, text: e.text, pos: e.pos, important: isImportant(e.kind) });
    if (e.kind === "discovery" && e.site && e.pos) discovered.value = { site: e.site, pos: e.pos, n: ++discoveries };
  }
  toasts.value = list;
});
