// Loads src/simClient.ts (and so the whole main-thread signal graph) in plain Node: the module wants a Worker, a
// document and window listeners, which the harness gives it as no-ops. Nothing here is measured; it is the wiring that
// lets the layer benchmarks feed one snapshot in and read what every layer makes of it.
import { applyDelta } from "../../../src/sim/delta";
import type { ClientState } from "../../../src/sim/types";
import { makeFrame } from "../../../src/world/frame";
import type { Fixture } from "./fixture";
import "./stubs";

export interface Client {
  client: typeof import("../../../src/simClient");
}

let loaded: Promise<Client> | null = null;

export function client(): Promise<Client> {
  loaded ??= (async () => {
    const mod = await import("../../../src/simClient");
    return { client: mod };
  })();
  return loaded;
}

/** The snapshot the worker's "loaded" message would carry. */
export async function setState(f: Fixture): Promise<typeof import("../../../src/simClient")> {
  const { client: c } = await client();
  c.state.value = f.state;
  c.city.value = f.city;
  c.frame.value = makeFrame(f.city.lat, f.city.lng);
  c.loaded.value = true;
  return c;
}

/** The same, applied as one snapshot message: this is the whole main-thread path of a snapshot (simClient.ts:169). */
export async function applyOne(f: Fixture, delta: unknown): Promise<ClientState> {
  const { client: c } = await client();
  const prev = c.state.value ?? f.state;
  const m = delta as { sim: Parameters<typeof applyDelta>[1] };
  const next = { ...applyDelta(prev, m.sim), zones: (m as unknown as { zones?: ClientState["zones"] }).zones ?? prev.zones };
  c.state.value = next;
  return next;
}

/** Every signal a UI component or a layer subscribes to, read once: the recompute the snapshot wakes up. */
export function readUiSignals(c: typeof import("../../../src/simClient")): unknown[] {
  return [
    c.state.value,
    c.people.value,
    c.stock.value,
    c.economy.value,
    c.roads.value,
    c.zones.value,
    c.buildings.value,
    c.buildingSet.value,
    c.incomingCount.value,
    c.digs.value,
    c.services.value,
    c.events.value,
    c.daySummary.value,
    c.chronicle.value,
    c.finds.value,
    c.articles.value,
  ];
}

export async function readAll(f: Fixture): Promise<unknown[]> {
  const { client: c } = await client();
  await applyOne(f, f.deltas[0]);
  return readUiSignals(c);
}
