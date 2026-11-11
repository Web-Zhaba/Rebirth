import { CAMP_STORE, STORE_GROUPS, STORES, groupOf, storeRoom, type StoreGroup, type StoreRoom } from "./buildings";
import { makeIdentityCache } from "./memo";
import { lotFront, snapToRoad, spotTree, walkMetres, type Net, type Spot, type Tree } from "./people";
import { roadNet } from "./roadNetCache";
import type { Building, RoadGraph, SimState, Stock } from "./types";

// Logistics (docs/PLAN-balance.md B4). Resources lie in stores: the camp at the founding point (id 0) and the finished
// barns, cellars, timber yards, stone yards and warehouses. `SimState.stock` stays the town's total, `SimState.stores`
// what each store holds. Producers carry their output to the nearest store with room and sites fetch their materials
// from the nearest one that holds them; the carting takes their own hours, by road distance. Flows with no place of
// their own (trade, gifts, arrivals, foraging) go to or come from the stores nearest to the camp (`Ledger.sync`).

export type Held = Partial<Stock>;
export type Stores = Record<number, Held>;
export const CAMP_STORE_ID = 0;

const KINDS = Object.values(STORE_GROUPS).flat() as (keyof Stock)[];
const EPS = 1e-6;

// Tonnes per unit of the stock (kg of food, m3 of logs and planks, t of stone, pieces of goods).
export const MASS: Record<keyof Stock, number> = { food: 0.001, logs: 0.6, planks: 0.5, stone: 1, clothes: 0.003, dishes: 0.004, furniture: 0.02, tools: 0.004 };
// One hour of carting moves `tm` tonne-metres (a cart of half a tonne at walking pace, there and back, loading included);
// off the roads a load goes `offroad` times the straight distance.
export const HAUL = { tm: 2000, offroad: 1.5, reach: 20_000 };
export const haulHours = (g: keyof Stock, q: number, metres: number): number => (q * MASS[g] * metres) / HAUL.tm;

export interface StorePoint {
  id: number;
  at: [number, number];
  room: StoreRoom;
}

// The stores of a town, kept per buildings object (a tick makes several ledgers): the camp and every finished store,
// the camp first (`points`); the same by distance from the camp (`order`); and by id.
interface StoreSet {
  points: readonly StorePoint[];
  order: readonly StorePoint[];
  byId: ReadonlyMap<number, StorePoint>;
}
const storeSet = makeIdentityCache((buildings: Record<number, Building>): StoreSet => {
  const points: StorePoint[] = [{ id: CAMP_STORE_ID, at: [0, 0], room: CAMP_STORE }];
  for (const b of Object.values(buildings)) {
    if (b.state !== "active") continue;
    const room = storeRoom(b);
    if (Object.keys(room).length > 0) points.push({ id: b.id, at: lotFront(b), room });
  }
  const order = [...points].sort((a, b) => Math.hypot(a.at[0], a.at[1]) - Math.hypot(b.at[0], b.at[1]) || a.id - b.id);
  return { points, order, byId: new Map(points.map((p) => [p.id, p])) };
});

// The camp and every finished store, the camp first.
export const storePoints = (buildings: Record<number, Building>): readonly StorePoint[] => storeSet(buildings).points;
export const isStore = (b: Pick<Building, "template">): boolean => b.template in STORES;

// ---------- distances ----------

interface RoadCache {
  spots: Map<string, Spot | null>;
  trees: Map<string, Tree>;
}
const roadCache = new WeakMap<Net, RoadCache>();
const pkey = (p: readonly [number, number]): string => `${p[0]},${p[1]}`;

// Metres a load travels between a store at `from` and `to`: along the built roads, or overland when that is shorter or
// no road reaches. Trees are cached per store and road net.
export function haulMetres(roads: RoadGraph, from: [number, number], to: [number, number]): number {
  const overland = Math.hypot(to[0] - from[0], to[1] - from[1]) * HAUL.offroad;
  const net = roadNet(roads);
  if (net.edges.length === 0) return overland;
  let c = roadCache.get(net);
  if (!c) {
    c = { spots: new Map(), trees: new Map() };
    roadCache.set(net, c);
  }
  const spot = (p: [number, number]): Spot | null => {
    const k = pkey(p);
    if (!c!.spots.has(k)) c!.spots.set(k, snapToRoad(net, p[0], p[1]));
    return c!.spots.get(k)!;
  };
  const a = spot(from);
  const b = spot(to);
  if (!a || !b) return overland;
  let tree = c.trees.get(pkey(from));
  if (!tree) {
    tree = spotTree(net, a, HAUL.reach);
    c.trees.set(pkey(from), tree);
  }
  const road = walkMetres(tree, a, b);
  return Number.isFinite(road) ? Math.min(road, overland) : overland;
}

// ---------- the ledger ----------

export interface Near {
  point: StorePoint;
  metres: number;
}

// The stock and the stores together, as mutable copies: every located move keeps them equal. `sync` takes the moves
// made on the stock alone into the stores.
export class Ledger {
  readonly stock: Stock;
  readonly stores: Stores;
  readonly points: readonly StorePoint[];
  private readonly roads: RoadGraph;
  private readonly set: StoreSet;

  constructor(s: Pick<SimState, "stock" | "stores" | "buildings" | "roads">) {
    this.stock = { ...s.stock };
    this.stores = {};
    for (const [id, h] of Object.entries(s.stores ?? {})) this.stores[Number(id)] = { ...h };
    this.set = storeSet(s.buildings);
    this.points = this.set.points;
    this.roads = s.roads;
    this.sync(s.stores === undefined); // a state from before the stores keeps all its stock
  }

  // What `sync` dropped for want of room, since this ledger was made.
  readonly lost: Partial<Stock> = {};

  held(id: number, g: keyof Stock): number {
    return this.stores[id]?.[g] ?? 0;
  }

  // Room left in a store for a good: the room of its group less everything of that group it holds.
  free(p: StorePoint, g: keyof Stock): number {
    const group = groupOf(g);
    const room = p.room[group] ?? 0;
    if (room <= 0) return 0;
    let used = 0;
    for (const k of STORE_GROUPS[group]) used += this.held(p.id, k);
    return Math.max(0, room - used);
  }

  // Room for a good in all the stores together.
  roomFor(g: keyof Stock): number {
    let n = 0;
    for (const p of this.points) n += this.free(p, g);
    return n;
  }

  // Stores by road distance from `at`: those with room for `g`, or those holding it.
  near(g: keyof Stock, at: [number, number], want: "room" | "held"): Near[] {
    const out: Near[] = [];
    for (const p of this.points) {
      if ((want === "room" ? this.free(p, g) : this.held(p.id, g)) <= EPS) continue;
      out.push({ point: p, metres: haulMetres(this.roads, p.at, at) });
    }
    return out.sort((a, b) => a.metres - b.metres || a.point.id - b.point.id);
  }

  private add(id: number, g: keyof Stock, q: number): void {
    const h = (this.stores[id] ??= {});
    const v = (h[g] ?? 0) + q;
    if (v > EPS) h[g] = v;
    else {
      delete h[g];
      if (Object.keys(h).length === 0) delete this.stores[id];
    }
  }

  // Carries up to `q` of `g` from `at` into the nearest stores with room. Returns what found room and the hours of carting.
  put(g: keyof Stock, q: number, at: [number, number]): { stored: number; haul: number } {
    let left = q;
    let haul = 0;
    if (left > EPS)
      for (const n of this.near(g, at, "room")) {
        const take = Math.min(left, this.free(n.point, g));
        this.add(n.point.id, g, take);
        haul += haulHours(g, take, n.metres);
        left -= take;
        if (left <= EPS) break;
      }
    const stored = Math.max(0, q - Math.max(0, left));
    this.stock[g] += stored;
    return { stored, haul };
  }

  // Carries up to `q` of `g` from the nearest stores holding it to `at`. Returns what was there and the hours of carting.
  take(g: keyof Stock, q: number, at: [number, number]): { taken: number; haul: number } {
    let left = q;
    let haul = 0;
    if (left > EPS)
      for (const n of this.near(g, at, "held")) {
        const take = Math.min(left, this.held(n.point.id, g));
        this.add(n.point.id, g, -take);
        haul += haulHours(g, take, n.metres);
        left -= take;
        if (left <= EPS) break;
      }
    const taken = Math.max(0, q - Math.max(0, left));
    this.stock[g] = Math.max(0, this.stock[g] - taken);
    return { taken, haul };
  }

  // Removes up to `q` of `g` from one store, gone from the town (spoilage).
  lose(id: number, g: keyof Stock, q: number): void {
    const t = Math.min(q, this.held(id, g));
    if (t <= 0) return;
    this.add(id, g, -t);
    this.stock[g] = Math.max(0, this.stock[g] - t);
  }

  // Drops what lies in any store beyond its room for the group of `g` (an old save kept at the camp). Returns the amount.
  trim(g: keyof Stock): number {
    const group = groupOf(g);
    let out = 0;
    for (const p of this.points) {
      let load = 0;
      for (const k of STORE_GROUPS[group]) load += this.held(p.id, k);
      const over = Math.min(this.held(p.id, g), load - (p.room[group] ?? 0));
      if (over > EPS) {
        this.lose(p.id, g, over);
        out += over;
      }
    }
    return out;
  }

  // Takes into the stores what changed on the stock alone, and drops the stores that are gone (their contents go to
  // the others). Gains go to the stores nearest to the camp as far as they have room, the rest is lost; losses come
  // from the fullest stores first. With `overfill`, what finds no room stays at the camp (loading an old save).
  sync(overfill = false): void {
    for (const id of Object.keys(this.stores).map(Number)) if (!this.set.byId.has(id)) delete this.stores[id];
    const order = this.set.order;
    for (const g of KINDS) {
      let sum = 0;
      for (const h of Object.values(this.stores)) sum += h[g] ?? 0;
      let delta = this.stock[g] - sum;
      if (delta > EPS) {
        for (const p of order) {
          const take = Math.min(delta, this.free(p, g));
          if (take <= 0) continue;
          this.add(p.id, g, take);
          delta -= take;
          if (delta <= EPS) break;
        }
        if (delta > EPS) {
          if (overfill) this.add(CAMP_STORE_ID, g, delta);
          else {
            this.stock[g] -= delta;
            this.lost[g] = (this.lost[g] ?? 0) + delta;
          }
        }
      } else if (delta < -EPS) {
        const full = this.points.filter((p) => this.held(p.id, g) > 0).sort((a, b) => this.held(b.id, g) - this.held(a.id, g) || a.id - b.id);
        let need = -delta;
        for (const p of full) {
          const take = Math.min(need, this.held(p.id, g));
          this.add(p.id, g, -take);
          need -= take;
          if (need <= EPS) break;
        }
      }
    }
  }
}

// The stores brought in line with the stock (see Ledger.sync); the state itself when nothing moved.
export function settleStores<S extends Pick<SimState, "stock" | "stores" | "buildings" | "roads">>(s: S): S {
  if (settled(s)) return s; // most ticks: nothing for a ledger to move
  const l = new Ledger(s);
  if (sameStores(l.stores, s.stores) && KINDS.every((g) => l.stock[g] === s.stock[g])) return s;
  return { ...s, stock: l.stock, stores: l.stores };
}

// Do the stores already hold exactly the stock, all of them still standing? Then `Ledger.sync` would move nothing.
function settled(s: Pick<SimState, "stock" | "stores" | "buildings">): boolean {
  if (!s.stores) return false;
  const { byId } = storeSet(s.buildings);
  const sum: Partial<Stock> = {};
  for (const id in s.stores) {
    if (!byId.has(Number(id))) return false;
    const h = s.stores[id];
    for (const g in h) sum[g as keyof Stock] = (sum[g as keyof Stock] ?? 0) + h[g as keyof Stock]!;
  }
  return KINDS.every((g) => Math.abs(s.stock[g] - (sum[g] ?? 0)) <= EPS);
}

function sameStores(a: Stores, b: Stores | undefined): boolean {
  if (!b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const id of ka) {
    const x = a[Number(id)];
    const y = b[Number(id)];
    if (!y) return false;
    for (const g of KINDS) if ((x[g] ?? 0) !== (y[g] ?? 0)) return false;
  }
  return true;
}

// Stores for a stock that has none (a new town, an old save): spread over the stores nearest to the camp, what finds no
// room kept at the camp all the same.
export function spreadStores(s: Pick<SimState, "stock" | "buildings" | "roads">): Stores {
  const l = new Ledger({ ...s, stock: { ...s.stock, ...zero() }, stores: {} });
  for (const g of KINDS) l.stock[g] = s.stock[g];
  l.sync(true);
  return l.stores;
}
// The state with its stock replaced and the stores spread to match, nothing lost (a debug grant, a test fixture).
export const withStock = <S extends Pick<SimState, "stock" | "stores" | "buildings" | "roads">>(s: S, stock: Stock): S => ({ ...s, stock, stores: spreadStores({ ...s, stock }) });

const zero = (): Stock => ({ food: 0, logs: 0, planks: 0, stone: 0, clothes: 0, dishes: 0, furniture: 0, tools: 0 });

// What a store holds of a group, and its room for it.
export function storeLoad(stores: Stores, id: number, group: StoreGroup): number {
  let n = 0;
  for (const g of STORE_GROUPS[group]) n += stores[id]?.[g] ?? 0;
  return n;
}
