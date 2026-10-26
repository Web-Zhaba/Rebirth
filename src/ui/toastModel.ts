import type { EventKind, TownEvent } from "../sim/types";
import type { IconName } from "./icons";

// Pure part of the toasts: which sim events are news, how they look and how long they stay.

export type ToastTone = "ok" | "warn" | "bad" | "info";

export interface Toast {
  id: number;
  kind: EventKind;
  text: string;
  pos?: [number, number];
  important: boolean;
}

export const KIND_ICON: Record<EventKind, IconName> = {
  built: "craft",
  shortage: "warning",
  arrival: "person",
  departure: "person",
  movein: "res",
  birth: "person",
  death: "quill",
  marriage: "person",
  farm: "field",
  food: "food",
  clearing: "clearing",
  order: "flag",
  goal: "check",
  unlock: "lock",
  tech: "scroll",
  era: "flag",
  event: "scroll",
};

export const KIND_TONE: Record<EventKind, ToastTone> = {
  built: "info",
  shortage: "warn",
  arrival: "info",
  departure: "warn",
  movein: "info",
  birth: "ok",
  death: "bad",
  marriage: "ok",
  farm: "info",
  food: "info",
  clearing: "info",
  order: "info",
  goal: "ok",
  unlock: "ok",
  tech: "ok",
  era: "ok",
  event: "warn",
};

const IMPORTANT = new Set<EventKind>(["goal", "unlock", "tech", "era", "event", "shortage", "death"]);
export const isImportant = (k: EventKind): boolean => IMPORTANT.has(k);

// The sound a fresh event gets: a finished building or a goal chimes; event cards have their own «notify».
export const soundFor = (k: EventKind): "finished" | null => (k === "built" || k === "goal" || k === "tech" || k === "era" ? "finished" : null);

export const MAX_TOASTS = 4;
export const MAX_NEW = 5; // news taken per snapshot; a burst beyond this is history, not news
export const SHOW_MS = 6000;
export const SHOW_IMPORTANT_MS = 12000;
export const showMs = (t: Pick<Toast, "important">): number => (t.important ? SHOW_IMPORTANT_MS : SHOW_MS);

export const eventKey = (e: TownEvent): string => `${e.at}|${e.kind}|${e.text}`;

// Events not seen yet, oldest first, plus the new set of seen keys. A null `seen` is the baseline (a load, a new town or
// a catch-up): everything is marked seen and nothing is news.
export function diffEvents(events: readonly TownEvent[], seen: ReadonlySet<string> | null): { fresh: TownEvent[]; seen: Set<string> } {
  const keys = new Set(events.map(eventKey));
  if (!seen) return { fresh: [], seen: keys };
  const fresh = events.filter((e) => !seen.has(eventKey(e)));
  // Keep only the newest: the older ones of a burst are not worth a toast each.
  return { fresh: fresh.slice(-MAX_NEW), seen: keys };
}

// Adds a toast; over the limit the oldest unimportant one goes first, then the oldest.
export function pushToast(list: readonly Toast[], t: Toast): Toast[] {
  const next = [...list, t];
  while (next.length > MAX_TOASTS) {
    const i = next.findIndex((x) => !x.important);
    next.splice(i >= 0 ? i : 0, 1);
  }
  return next;
}

// Hours left until an event card resolves itself, at least 1 while it is still open.
export const hoursLeft = (until: number, gameMinutes: number): number => Math.max(1, Math.ceil((until - gameMinutes) / 60));
