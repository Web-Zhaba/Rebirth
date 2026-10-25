import { describe, expect, it } from "vitest";
import { newTally, observe, summarize } from "./away";
import { advanceTo, step } from "./clock";
import { BUILDINGS } from "./buildings";
import { ANSWER_WITHIN, AUTO, CART, COOLDOWN, DIG_LABOR, EVENT_GAP, EVENT_IDS, eventStep, FEAST, FIRE, FIRST_EVENT, FLOOD, FROST_MOOD, HOARD, MINSTREL, RAID, resolveChoice, RETRY, SHELTER_FOOD, SICK, WOLF } from "./events";
import { FIELD } from "./fields";
import { emptyGrowth } from "./growth";
import { Handler, toSnapshot, type Storage } from "./handler";
import { allUnlocked } from "./goals";
import { emptyRoads } from "./roads";
import { parseSave } from "./save";
import { DAY_MIN } from "./time";
import type { Building, City, Household, Resident, SaveV4, SimState } from "./types";
import { emptyZones } from "./zones";
import type { FromWorker } from "./protocol";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59, lng: 37, foundedAt: NOW - 1e6 };
// Day index d (0 = founding day) at the given hour.
const at = (d: number, hour = 9) => d * DAY_MIN + hour * 60 - 360;
const AUTUMN = at(16, 9); // first day of the harvest window
const SUMMER = at(10, 9);

function bld(id: number, template: string, state: Building["state"] = "active", x = id * 20): Building {
  const t = BUILDINGS[template];
  return {
    id,
    template,
    zone: t.zone,
    lot: { cx: x, cy: 10, angle: 0, w: t.w, d: t.d },
    side: 1,
    footprint: [[x, 5], [x + 1, 5], [x + 1, 6], [x, 6]],
    height: t.height,
    state,
    labor: t.labor,
    done: state === "active" ? t.labor : 0,
    created: 0,
    paid: true,
    level: 1,
    streak: 0,
  };
}

function town(bs: Building[] = [], gm = SUMMER): SimState {
  const buildings: Record<number, Building> = {};
  for (const b of bs) buildings[b.id] = b;
  const s: SimState = { realTime: NOW, gameMinutes: gm, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(7, gm), buildings, nextBuildingId: bs.length + 1 };
  return { ...s, goals: allUnlocked(), stock: { food: 2000, logs: 0, planks: 0, stone: 0, wares: 0 }, nextEvent: gm };
}

const person = (id: number, household: number, born = -1e6): Resident => ({ id, first: "Иван", last: "Тестов", sex: "m", born, household, spouse: null, job: null, commute: null, idleDays: 0, literate: false, school: 0 });
// One household of `n` people living in house `home`.
function family(s: SimState, home: number, n = 3): SimState {
  const id = s.nextHouseholdId;
  const residents = { ...s.residents };
  const members: number[] = [];
  for (let i = 0; i < n; i++) {
    const pid = s.nextPersonId + i;
    residents[pid] = person(pid, id);
    members.push(pid);
  }
  const h: Household = { id, last: "Тестов", home, members, arrived: 0, founder: false, mood: 50 };
  return { ...s, residents, households: { ...s.households, [id]: h }, nextPersonId: s.nextPersonId + n, nextHouseholdId: id + 1 };
}
// The founders' tents are in the way of "no families" checks: start from an empty town where a test needs one.
const noPeople = (s: SimState): SimState => ({ ...s, residents: {}, households: {}, nextPersonId: 1, nextHouseholdId: 1 });
// Only `id` may be drawn: every other kind was just put.
const only = (s: SimState, id: string): SimState => ({ ...s, eventLast: Object.fromEntries(EVENT_IDS.filter((k) => k !== id).map((k) => [k, s.gameMinutes])) });
const moods = (s: SimState) => Object.values(s.households).map((h) => h.mood);

describe("scheduling", () => {
  it("a new town waits three days and starts with nothing pending", () => {
    const s = emptyGrowth(3, 0);
    expect(s.pending).toBeNull();
    expect(s.nextEvent).toBe(FIRST_EVENT);
  });

  it("puts an event when it is due, in the day, and schedules the next one 1-2 days later", () => {
    const s0 = only(town([bld(1, "izba")]), "shelter");
    const s = eventStep(s0);
    expect(s.pending?.id).toBe("shelter");
    expect(s.pending!.until).toBe(s0.gameMinutes + ANSWER_WITHIN);
    expect(s.nextEvent).toBeGreaterThanOrEqual(s0.gameMinutes + EVENT_GAP.min);
    expect(s.nextEvent).toBeLessThanOrEqual(s0.gameMinutes + EVENT_GAP.min + EVENT_GAP.span);
    expect(s.events.at(-1)!.kind).toBe("event");
    expect(s.eventLast.shelter).toBe(s0.gameMinutes);
  });

  it("does nothing before the time, at night, or while one event waits", () => {
    const s0 = only(town([bld(1, "izba")]), "shelter");
    const early = { ...s0, nextEvent: s0.gameMinutes + 10 };
    expect(eventStep(early)).toBe(early);
    const night = { ...s0, gameMinutes: at(10, 23), nextEvent: 0 };
    expect(eventStep(night)).toBe(night);
    const first = eventStep(s0);
    const again = eventStep({ ...first, nextEvent: 0 });
    expect(again.pending).toBe(first.pending);
  });

  it("draws only kinds whose condition holds and retries later when none does", () => {
    // Hoard and minstrels have no condition: put them on cooldown so the bare town has nothing that fits.
    const bare = { ...noPeople(town()), stock: { food: 0, logs: 0, planks: 0, stone: 0, wares: 0 }, eventLast: { hoard: SUMMER, minstrels: SUMMER } };
    const s = eventStep(bare);
    expect(s.pending).toBeNull();
    expect(s.nextEvent).toBe(bare.gameMinutes + RETRY);
    expect(eventStep(only(town([bld(1, "izba")]), "cart")).pending?.id).toBe("cart");
    expect(eventStep(only(town([bld(1, "dig")]), "dig")).pending?.id).toBe("dig");
    expect(eventStep(only(noPeople(town([bld(1, "dig")])), "sick")).pending).toBeNull();
    expect(eventStep(only(town([bld(1, "izba")]), "frost")).pending).toBeNull();
  });

  it("does not repeat a kind within the cooldown", () => {
    const s = town([bld(1, "izba")]);
    const first = eventStep(only(s, "cart"));
    const resolved = resolveChoice(first, 1, false);
    const soon = { ...resolved, gameMinutes: s.gameMinutes + COOLDOWN - 10, nextEvent: 0 };
    const o = only(soon, "cart");
    expect(eventStep({ ...o, eventLast: { ...o.eventLast, cart: first.eventLast.cart } }).pending).toBeNull();
    expect(eventStep({ ...o, gameMinutes: soon.gameMinutes + 20, eventLast: { ...o.eventLast, cart: first.eventLast.cart } }).pending?.id).toBe("cart");
  });

  it("is deterministic", () => {
    const s = only(family(town([bld(1, "izba"), bld(2, "izba")]), 1), "sick");
    const a = eventStep(s);
    const b = eventStep(s);
    expect(a).toEqual(b);
    expect(a.rng).not.toBe(s.rng);
  });
});

describe("shelter", () => {
  const base = () => eventStep(only(noPeople(town([bld(1, "izba")])), "shelter"));
  it("accept: a family is promised the free house and the food goes", () => {
    const p = base();
    const s = resolveChoice(p, 0, false);
    expect(s.pending).toBeNull();
    expect(s.incoming).toHaveLength(1);
    expect(s.incoming[0].house).toBe(1);
    expect(s.stock.food).toBe(p.stock.food - SHELTER_FOOD);
    expect(s.chronicle.at(-1)!.kind).toBe("event:shelter");
  });
  it("refuse: nothing changes but the record", () => {
    const p = base();
    const s = resolveChoice(p, 1, false);
    expect(s.incoming).toEqual([]);
    expect(s.stock).toEqual(p.stock);
    expect(s.chronicle.at(-1)!.text).toContain("отказали");
  });
  it("the safe option is refusing", () => {
    expect(base().pending!.safe).toBe(1);
  });
});

describe("cart", () => {
  it("swaps wares for planks", () => {
    const p = eventStep(only({ ...town(), stock: { food: 10, logs: 0, planks: 0, stone: 0, wares: 30 } }, "cart"));
    expect(p.pending!.arg).toBe(0);
    const s = resolveChoice(p, 0, false);
    expect(s.stock).toMatchObject({ wares: 30 - CART.wares, planks: CART.planks });
  });
  it("swaps food for stone", () => {
    const p = eventStep(only({ ...town(), stock: { food: 1000, logs: 0, planks: 0, stone: 0, wares: 0 } }, "cart"));
    expect(p.pending!.arg).toBe(1);
    const s = resolveChoice(p, 0, false);
    expect(s.stock).toMatchObject({ food: 1000 - CART.food, stone: CART.stone });
  });
  it("letting the cart go changes nothing", () => {
    const p = eventStep(only(town(), "cart"));
    expect(resolveChoice(p, 1, false).stock).toEqual(p.stock);
  });
  it("the swap fails when the goods are gone by then", () => {
    const p = eventStep(only({ ...town(), stock: { food: 10, logs: 0, planks: 0, stone: 0, wares: 30 } }, "cart"));
    const s = resolveChoice({ ...p, stock: { ...p.stock, wares: 0 } }, 0, false);
    expect(s.stock.planks).toBe(0);
  });
});

describe("frost", () => {
  const FIELD2 = { id: 1, pts: [[0, 40], [100, 40], [100, 240], [0, 240]] as [number, number][], area: 20_000 };
  const farm = (gm: number): SimState => {
    const s = family(town([bld(1, "gumno"), bld(2, "izba")], gm), 2);
    return { ...s, zones: { ...s.zones, fields: [FIELD2] }, prod: { ...s.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa * 2, harvH: 0, reaped: 0 } } } };
  };
  it("needs a harvest window with grain standing", () => {
    expect(eventStep(only(farm(SUMMER), "frost")).pending).toBeNull();
    expect(eventStep(only(farm(AUTUMN), "frost")).pending?.id).toBe("frost");
    const reaped = farm(AUTUMN);
    const done = { ...reaped, prod: { ...reaped.prod, fields: { 1: { year: 1, sowH: FIELD.sowHoursHa * 2, harvH: 1, reaped: FIELD.yieldKgHa * 2 } } } };
    expect(eventStep(only(done, "frost")).pending).toBeNull();
  });
  it("drafting everyone keeps the grain and lowers the mood", () => {
    const p = eventStep(only(farm(AUTUMN), "frost"));
    const s = resolveChoice(p, 0, false);
    expect(s.prod.fields).toEqual(p.prod.fields);
    expect(moods(s)[0]).toBe(moods(p)[0] + FROST_MOOD);
    expect(p.pending!.safe).toBe(0);
  });
  it("accepting the loss takes a fifth of the standing grain", () => {
    const p = eventStep(only(farm(AUTUMN), "frost"));
    const s = resolveChoice(p, 1, false);
    const w = s.prod.fields[1];
    expect(FIELD.yieldKgHa * 2 * Math.min(1, w.sowH / (FIELD.sowHoursHa * 2))).toBeCloseTo(FIELD.yieldKgHa * 2 * 0.8, 5);
    expect(moods(s)).toEqual(moods(p));
  });
});

describe("dig", () => {
  const withSite = () => {
    const site = { ...bld(2, "izba", "building"), done: 20 };
    const other = { ...bld(3, "izba", "building"), done: 10 };
    return eventStep(only(town([bld(1, "dig"), site, other]), "dig"));
  };
  it("digging deeper widens the disc and costs labor on the sites in progress", () => {
    const p = withSite();
    expect(p.pending!.pos).toBeDefined();
    const s = resolveChoice(p, 0, false);
    expect(s.buildings[1].radius!).toBeGreaterThan(15);
    expect(s.buildings[2].done + s.buildings[3].done).toBeCloseTo(30 - Math.min(30, DIG_LABOR), 6);
    expect(s.buildings[2].state).toBe("building");
  });
  it("moving on changes nothing", () => {
    const p = withSite();
    const s = resolveChoice(p, 1, false);
    expect(s.buildings).toEqual(p.buildings);
  });
  it("is not offered when the disc is full", () => {
    const full = { ...bld(1, "dig"), radius: 120 };
    expect(eventStep(only(town([full]), "dig")).pending).toBeNull();
  });
});

describe("feast", () => {
  const harvested = (): SimState => {
    const s = family(town([bld(1, "izba")], AUTUMN), 1, 4);
    return { ...s, goals: { ...s.goals, feast: true }, nextEvent: AUTUMN + 5 * DAY_MIN };
  };
  it("comes from goals.feast, consumes it, and ignores the schedule", () => {
    const s = eventStep(harvested());
    expect(s.pending?.id).toBe("feast");
    expect(s.goals.feast).toBe(false);
    expect(s.nextEvent).toBeGreaterThanOrEqual(AUTUMN + 5 * DAY_MIN);
  });
  it("waits for a pending event, keeping the flag", () => {
    const p = eventStep(harvested());
    const busy = { ...harvested(), pending: { ...p.pending!, id: "cart" } };
    const s = eventStep(busy);
    expect(s.goals.feast).toBe(true);
    expect(s.pending!.id).toBe("cart");
  });
  it("the feast spends food for mood", () => {
    const p = eventStep(harvested());
    const s = resolveChoice(p, 0, false);
    expect(s.stock.food).toBe(p.stock.food - p.pending!.arg);
    expect(moods(s)[0]).toBe(moods(p)[0] + FEAST.mood);
    expect(p.pending!.arg).toBe(FEAST.minKg);
  });
  it("declining keeps food", () => {
    const p = eventStep(harvested());
    expect(resolveChoice(p, 1, false).stock).toEqual(p.stock);
  });
  it("is never drawn at random", () => {
    for (let i = 0; i < 20; i++) expect(eventStep({ ...town([bld(1, "izba")]), rng: i * 977 + 1 }).pending?.id).not.toBe("feast");
  });
});

describe("sick family", () => {
  const sick = () => eventStep(only(family(noPeople(town([bld(1, "izba")])), 1, 3), "sick"));
  it("nursing costs food and nobody dies", () => {
    const p = sick();
    expect(p.pending!.pos).toBeDefined();
    const s = resolveChoice(p, 0, false);
    expect(s.stock.food).toBe(p.stock.food - SICK.food);
    expect(Object.keys(s.residents)).toHaveLength(3);
  });
  it("waiting may cost a life, by the generator", () => {
    const p = sick();
    const sizes = new Set<number>();
    for (let i = 0; i < 40; i++) sizes.add(Object.keys(resolveChoice({ ...p, rng: i * 7919 + 3 }, 1, false).residents).length);
    expect([...sizes].sort()).toEqual([2, 3]);
  });
  it("without food to nurse them the family takes the risk", () => {
    const p = sick();
    const poor = { ...p, stock: { ...p.stock, food: 5 } };
    const s = resolveChoice(poor, 0, false);
    expect(s.stock.food).toBe(5);
    expect(s.chronicle.at(-1)!.text).toContain("не хватило");
  });
  it("is not drawn for a family a healer covers", () => {
    const s = family(noPeople(town([bld(1, "izba")])), 1, 3);
    expect(eventStep(only({ ...s, coverage: { 1: 0b11111 } }, "sick")).pending).toBeNull();
  });
  it("a single person is not a family", () => {
    expect(eventStep(only(family(noPeople(town([bld(1, "izba")])), 1, 1), "sick")).pending).toBeNull();
  });
});

describe("auto-resolve and offline", () => {
  it("an unanswered event resolves with the safe option after a game day", () => {
    const p = eventStep(only(noPeople(town([bld(1, "izba")])), "shelter"));
    const early = eventStep({ ...p, gameMinutes: p.pending!.until - 10, nextEvent: 1e12 });
    expect(early.pending).not.toBeNull();
    const late = eventStep({ ...p, gameMinutes: p.pending!.until, nextEvent: 1e12 });
    expect(late.pending).toBeNull();
    expect(late.incoming).toEqual([]);
    expect(late.events.at(-1)!.text).toMatch(/\(никто не ответил\)$/);
    expect(late.chronicle).toBe(p.chronicle); // routine: the feed only, not the chronicle
  });
  it("step resolves it too", () => {
    const p = eventStep(only(town([bld(1, "izba")]), "cart"));
    let s: SimState = { ...p, nextEvent: 1e12 };
    for (let i = 0; i < 160 && s.pending; i++) s = step(s);
    expect(s.pending).toBeNull();
    expect(s.stock.wares).toBe(p.stock.wares);
  });
  it("events that resolved while away are listed in the summary", () => {
    const base = only(town([bld(1, "izba")], at(10, 7)), "cart");
    const start: SimState = { ...base, realTime: NOW };
    const tally = newTally();
    const gap = 5 * DAY_MIN * 1000; // offline: one game minute per real second
    const end = advanceTo(start, NOW + gap, undefined, gap * 2, (a, b) => observe(tally, a, b));
    const away = summarize(tally, start, end, gap);
    expect(away.choices.length).toBeGreaterThan(0);
    expect(away.choices.every((t) => t.endsWith("(никто не ответил)"))).toBe(true);
  });
});

describe("saves and the snapshot", () => {
  const raw = (s: SimState) => JSON.parse(JSON.stringify({ version: 4, city, sim: s }));
  it("round-trips pending, schedule and history", () => {
    const p = eventStep(only(family(noPeople(town([bld(1, "izba")])), 1), "sick"));
    const sim = parseSave(raw(p), NOW + 1)!.sim;
    expect(sim.pending).toEqual(p.pending);
    expect(sim.nextEvent).toBe(p.nextEvent);
    expect(sim.eventLast).toEqual(p.eventLast);
  });
  it("an old save loads with nothing pending and the first event three days away", () => {
    const p = town([bld(1, "izba")]);
    const old = raw(p);
    delete old.sim.pending;
    delete old.sim.nextEvent;
    delete old.sim.eventLast;
    const sim = parseSave(old, NOW + 1)!.sim;
    expect(sim.pending).toBeNull();
    expect(sim.eventLast).toEqual({});
    expect(sim.nextEvent).toBe(p.gameMinutes + FIRST_EVENT);
  });
  it("drops a broken pending event", () => {
    const p = eventStep(only(town([bld(1, "izba")]), "cart"));
    const bad = raw(p);
    bad.sim.pending.options = [bad.sim.pending.options[0]];
    expect(parseSave(bad, NOW + 1)!.sim.pending).toBeNull();
    const unknown = raw(p);
    unknown.sim.pending.id = "nope";
    expect(parseSave(unknown, NOW + 1)!.sim.pending).toBeNull();
  });
  it("accepts the event kind in the feed", () => {
    const p = eventStep(only(town([bld(1, "izba")]), "cart"));
    expect(parseSave(raw(p), NOW + 1)!.sim.events.at(-1)!.kind).toBe("event");
  });
  it("the snapshot carries the pending event", () => {
    const p = eventStep(only(town([bld(1, "izba")]), "cart"));
    expect(toSnapshot(p).pending).toEqual(p.pending);
  });
});

describe("the choose command", () => {
  const mem = (save: SaveV4): Storage => ({ get: async () => save, put: async () => {}, clear: async () => {} });
  it("answers the pending event, and refuses a stale one", async () => {
    const p = eventStep(only(town([bld(1, "izba")]), "cart"));
    const save: SaveV4 = { version: 4, city, sim: { ...p, realTime: NOW } };
    const results: { ok: boolean; reason?: string }[] = [];
    const snaps: SimState["pending"][] = [];
    const h = new Handler(mem(save), (m: FromWorker) => {
      if (m.t === "cmdResult") results.push(m);
      else if (m.t === "snapshot") snaps.push(m.sim.pending);
    });
    await h.handle({ t: "load", legacy: null, now: NOW + 1000 });
    await h.handle({ t: "cmd", id: 1, cmd: { type: "choose", id: "frost", option: 0 } });
    expect(results[0].ok).toBe(false);
    await h.handle({ t: "cmd", id: 2, cmd: { type: "choose", id: "cart", option: 1 } });
    expect(results[1].ok).toBe(true);
    expect(snaps.at(-1)).toBeNull();
    await h.handle({ t: "cmd", id: 3, cmd: { type: "choose", id: "cart", option: 1 } });
    expect(results[2].ok).toBe(false);
  });
});

describe("fire", () => {
  // One finished house with a family, and an unfinished site with done work to take back.
  const fire = () => eventStep(only(family(noPeople(town([bld(1, "izba"), { ...bld(2, "izba", "building"), done: 10 }])), 1, 2), "fire"));
  it("putting it out takes labor from the sites and keeps the house", () => {
    const p = fire();
    expect(p.pending!.arg).toBe(1);
    const s = resolveChoice(p, 0, false);
    expect(s.buildings[1]).toBeDefined();
    expect(s.buildings[2].done).toBe(0); // the site had 10 person-hours done, fewer than the fire takes
  });
  it("letting it burn removes the house and the family has no home", () => {
    const s = resolveChoice(fire(), 1, false);
    expect(s.buildings[1]).toBeUndefined();
    expect(s.households[1].home).toBeNull();
    expect(s.chronicle.at(-1)!.text).toContain("без крова");
  });
});

describe("flood", () => {
  const flood = () => eventStep(only(town([bld(1, "izba")]), "flood"));
  it("waiting out the water spoils a share of the food", () => {
    const p = flood();
    expect(resolveChoice(p, 1, false).stock.food).toBeCloseTo(2000 * (1 - FLOOD.share));
  });
  it("digging ditches keeps the food", () => {
    expect(resolveChoice(flood(), 0, false).stock.food).toBe(2000);
  });
});

describe("wolves", () => {
  const wolves = (s: SimState) => eventStep(only(s, "wolves"));
  it("come in winter only", () => {
    const home = family(noPeople(town([bld(1, "izba")])), 1, 3);
    expect(wolves({ ...home, gameMinutes: at(10, 9) }).pending).toBeNull();
    expect(wolves({ ...home, gameMinutes: at(26, 9) }).pending?.id).toBe("wolves");
  });
  it("a hunt may cost a hunter", () => {
    const p = wolves({ ...family(noPeople(town([bld(1, "izba")])), 1, 3), gameMinutes: at(26, 9) });
    const sizes = new Set<number>();
    for (let i = 0; i < 40; i++) sizes.add(Object.keys(resolveChoice({ ...p, rng: i * 7919 + 3 }, 0, false).residents).length);
    expect([...sizes].sort()).toEqual([2, 3]);
  });
  it("locking the yards lowers the mood of every family", () => {
    const p = wolves({ ...family(noPeople(town([bld(1, "izba")])), 1, 3), gameMinutes: at(26, 9) });
    expect(moods(resolveChoice(p, 1, false))).toEqual(moods(p).map((m) => m + WOLF.mood));
  });
});

describe("raid", () => {
  it("paying the raiders takes food; a fight may cost an adult", () => {
    const p = eventStep(only(town([bld(1, "izba")]), "raid"));
    expect(resolveChoice(p, 0, false).stock.food).toBe(2000 - RAID.food);
    const sizes = new Set<number>();
    const q = eventStep(only(family(noPeople(town([bld(1, "izba")])), 1, 3), "raid"));
    for (let i = 0; i < 40; i++) sizes.add(Object.keys(resolveChoice({ ...q, rng: i * 7919 + 3 }, 1, false).residents).length);
    expect([...sizes].sort()).toEqual([2, 3]);
  });
});

describe("collapse", () => {
  // A quarryman: the first resident of the family is put to work at the quarry.
  const collapse = () => {
    const base = family(noPeople(town([bld(1, "izba"), bld(2, "quarry")])), 1, 2);
    const [first] = Object.keys(base.residents).map(Number);
    const s = { ...base, residents: { ...base.residents, [first]: { ...base.residents[first], job: 2 } } };
    return { first, p: eventStep(only(s, "collapse")) };
  };
  it("is drawn only when someone works at a quarry", () => {
    const { first, p } = collapse();
    expect(p.pending!.arg).toBe(first);
    expect(eventStep(only(noPeople(town([bld(1, "izba")])), "collapse")).pending).toBeNull();
  });
  it("digging him out costs labor and keeps him", () => {
    const { first, p } = collapse();
    expect(resolveChoice(p, 0, false).residents[first]).toBeDefined();
  });
  it("leaving him may cost his life", () => {
    const { p } = collapse();
    const sizes = new Set<number>();
    for (let i = 0; i < 40; i++) sizes.add(Object.keys(resolveChoice({ ...p, rng: i * 7919 + 3 }, 1, false).residents).length);
    expect([...sizes].sort()).toEqual([1, 2]);
  });
});

describe("hoard and minstrels", () => {
  it("a find given to the common store adds wares and stone", () => {
    const s = resolveChoice(eventStep(only(town([bld(1, "izba")]), "hoard")), 0, false);
    expect(s.stock.wares).toBe(HOARD.wares);
    expect(s.stock.stone).toBe(HOARD.stone);
  });
  it("feeding the minstrels spends food for mood", () => {
    const p = eventStep(only(family(noPeople(town([bld(1, "izba")])), 1, 2), "minstrels"));
    const s = resolveChoice(p, 0, false);
    expect(s.stock.food).toBe(p.stock.food - MINSTREL.food);
    expect(moods(s)).toEqual(moods(p).map((m) => m + MINSTREL.mood));
  });
});

describe("chronicle cleanup", () => {
  it("a save drops the events nobody answered from the chronicle and keeps the rest", () => {
    const base = town([bld(1, "izba")]);
    const chronicle = [
      { at: 1, kind: "house", text: "Построен первый дом" },
      { at: 2, kind: "event:cart", text: `Торговая подвода: разъехались${AUTO}` },
      { at: 3, kind: "event:feast", text: "Праздник урожая: устроили праздник" },
    ];
    const save = parseSave({ version: 4, city, sim: { ...base, chronicle } }, NOW);
    expect(save!.sim.chronicle.map((e) => e.kind)).toEqual(["house", "event:feast"]);
  });
});
