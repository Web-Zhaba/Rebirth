import { ADULT_MAX, ADULT_MIN, ageOf, buildNet, isFinishedHouse, lotFront, nearestNode, reach } from "./people";
import { covers } from "./services";
import { workHours, type Levers } from "./levers";
import { calendar } from "./time";
import type { SimState } from "./types";

// Evenings (PLAN-pace.md section 7): home crafts and gatherings between the end of work and the night.
export const EVENING = {
  from: 19, // hour: the normal workday is over (see workHours for the «Долгий день»)
  to: 22, // hour: the night begins and the day summary is made
  waresPerAdultHour: 0.01, // pieces an adult at home makes
  winter: 2, // multiplier of the winter evening
  gatherMood: 3, // added to the mood target of households covered by a tavern or a chapel
  tavernReach: 600, // m of road from a staffed tavern
};

// The evening starts when work ends (19:00, or 21:00 in the «Долгий день»).
export const isEvening = (hour: number, levers?: Levers): boolean => hour >= workHours(levers).end && hour < EVENING.to;

// Adults living in a finished house (tent dwellers have no hearth to sit at).
export function adultsAtHome(s: Pick<SimState, "residents" | "households" | "buildings" | "gameMinutes">): number {
  let n = 0;
  for (const r of Object.values(s.residents)) {
    const h = s.households[r.household];
    if (!h || h.home === null || !isFinishedHouse(s.buildings[h.home])) continue;
    const age = ageOf(r.born, s.gameMinutes);
    if (age >= ADULT_MIN && age < ADULT_MAX) n++;
  }
  return n;
}

// Pieces of wares an hour the adults at home make in the evening, at the season of `gameMinutes`.
export const eveningRate = (s: Pick<SimState, "residents" | "households" | "buildings" | "gameMinutes">): number =>
  adultsAtHome(s) * EVENING.waresPerAdultHour * (calendar(s.gameMinutes).season === 3 ? EVENING.winter : 1);

// One tick of `dt` hours of вечерние ремёсла. Call in evening hours only. The wares count toward the day's output under key 0.
export function eveningStep(s: SimState, dt: number): SimState {
  const q = eveningRate(s) * dt;
  if (!(q > 0)) return s;
  return { ...s, stock: { ...s.stock, wares: s.stock.wares + q }, prod: { ...s.prod, today: { ...s.prod.today, 0: (s.prod.today[0] ?? 0) + q } } };
}

// Houses whose households gather in the evening: covered by a chapel, or within reach of a staffed tavern.
export function gatherHouses(s: Pick<SimState, "buildings" | "roads" | "residents" | "coverage">): Set<number> {
  const out = new Set<number>();
  for (const b of Object.values(s.buildings)) if (isFinishedHouse(b) && covers(s.coverage[b.id], "chapel")) out.add(b.id);
  const workers = new Set<number>();
  for (const r of Object.values(s.residents)) if (r.job !== null) workers.add(r.job);
  const taverns = Object.values(s.buildings).filter((b) => b.template === "tavern" && b.state === "active" && workers.has(b.id));
  if (taverns.length === 0) return out;
  const net = buildNet(s.roads);
  if (net.adj.size === 0) return out;
  const spots: { id: number; node: number; off: number }[] = [];
  for (const b of Object.values(s.buildings)) {
    if (!isFinishedHouse(b)) continue;
    const [x, y] = lotFront(b);
    const l = nearestNode(net, x, y);
    if (l) spots.push({ id: b.id, node: l.node, off: l.off });
  }
  for (const t of taverns) {
    const [x, y] = lotFront(t);
    const from = nearestNode(net, x, y);
    if (!from || from.off > EVENING.tavernReach) continue;
    const dist = reach(net, from.node, EVENING.tavernReach - from.off);
    for (const h of spots) {
      const d = dist.get(h.node);
      if (d !== undefined && d + from.off + h.off <= EVENING.tavernReach) out.add(h.id);
    }
  }
  return out;
}
