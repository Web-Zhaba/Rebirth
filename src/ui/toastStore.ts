import { effect, signal } from "@preact/signals";
import { catchUp, state } from "../simClient";
import { diffEvents, isImportant, pushToast, type Toast } from "./toastModel";

// The stack of toasts and the goal flash, fed from the snapshot's event ring. The first snapshot after a load, a new town
// or a catch-up is only a baseline: history is never replayed.
export const toasts = signal<Toast[]>([]);
// Bumped when a goal is completed (kind "goal"); the tracker highlights itself and shows the line for a moment.
export const goalFlash = signal<{ n: number; text: string } | null>(null);

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
  const r = diffEvents(s.events, catchUp.value ? null : seen);
  seen = r.seen;
  if (r.fresh.length === 0) return;
  let list = toasts.peek();
  for (const e of r.fresh) {
    list = pushToast(list, { id: nextId++, kind: e.kind, text: e.text, pos: e.pos, important: isImportant(e.kind) });
    if (e.kind === "goal") goalFlash.value = { n: (goalFlash.peek()?.n ?? 0) + 1, text: e.text };
  }
  toasts.value = list;
});
