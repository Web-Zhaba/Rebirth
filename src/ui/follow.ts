import { signal } from "@preact/signals";
import type { ResidentQuery } from "../sim/types";
import { queryResident } from "../simClient";

// The resident the map camera is following (src/ui/followModel.ts has the pure rules).
export interface FollowedResident {
  id: number;
  name: string;
}

export const followed = signal<FollowedResident | null>(null);
export const followInfo = signal<ResidentQuery | null>(null);

export function followResident(id: number, name: string): void {
  followed.value = { id, name };
  followInfo.value = null;
}

// Start following from a walker dot: the dot knows the resident id, the worker knows the name.
export function followResidentById(id: number): void {
  void queryResident(id).then((q) => {
    if (q) followResident(q.id, q.name);
  });
}

export function stopFollowing(): void {
  followed.value = null;
  followInfo.value = null;
}
