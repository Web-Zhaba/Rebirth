import { describe, expect, it } from "vitest";
import { BUILDINGS } from "./buildings";
import { adminOf } from "./governance";
import { choices, chooseHead, GOV, govEffect, govStep, govView, recordDay, setForm, setTerm, termMinutes, traitOf, TRAITS } from "./government";
import { emptyGrowth, seedOf } from "./growth";
import { parseSave } from "./save";
import { addRoad, emptyRoads } from "./roads";
import { chooseHeadCmd } from "./leverCmds";
import { rebalanceJobs } from "./people";
import { YEAR_MIN } from "./time";
import type { Building, City, Resident, SimState } from "./types";
import { emptyZones } from "./zones";

const NOW = 1_800_000_000_000;
const city: City = { name: "Тест", lat: 59.12, lng: 37.9, foundedAt: NOW - 1000 };
const T0 = 40 * YEAR_MIN; // late enough for everyone to have been born

const hall = (state: Building["state"] = "active"): Building => {
  const t = BUILDINGS.townhall;
  return { id: 9, template: "townhall", zone: "placed", lot: { cx: 0, cy: 0, angle: 0, w: t.w, d: t.d }, side: 1, footprint: [[0, 0], [1, 0], [1, 1], [0, 1]], height: t.height, state, labor: 1, done: state === "active" ? 1 : 0, created: 0, paid: true, level: 1, streak: 0 };
};
const world = (bs: Building[] = [hall()]): SimState => ({
  realTime: NOW,
  gameMinutes: T0,
  roads: emptyRoads(),
  zones: emptyZones(),
  ...emptyGrowth(seedOf(city.foundedAt), T0),
  buildings: Object.fromEntries(bs.map((b) => [b.id, b])),
});
const ok = (r: ReturnType<typeof chooseHead>): SimState => {
  if (!r.ok) throw new Error(r.reason);
  return r.sim;
};
// the town hall opened and the monarchy confirmed
const opened = (s = world()): SimState => ok(setForm(govStep(s).sim, "monarchy"));
const adults = (s: SimState): Resident[] => Object.values(s.residents).filter((r) => (s.gameMinutes - r.born) / YEAR_MIN >= 20);

describe("the government", () => {
  it("opens with the town hall, and the town suffers until a head is chosen", () => {
    expect(govStep(world([hall("building")])).sim.gov).toBeNull();
    const fresh = govStep(world()).sim;
    expect(fresh.gov?.settled).toBe(false);
    expect(govEffect(fresh)).toEqual(GOV.noHead);
    expect(choices(fresh).kind).toBe("none"); // the form comes first
    expect(chooseHead(fresh, Object.keys(fresh.residents).map(Number)[0])).toMatchObject({ ok: false });
    const s = opened();
    expect(s.gov?.form).toBe("monarchy");
    expect(govEffect(s)).toEqual(GOV.noHead);
    expect(govStep(world()).said[0].kind).toBe("head");
    const c = choices(s);
    expect(c.kind).toBe("open"); // no monarch yet: a dynasty is founded by an open choice
    expect(c.ids).toHaveLength(GOV.candidates);
    expect(adminOf(s).capacity).toBeLessThan(adminOf({ ...s, gov: null }).capacity);
  });

  it("a head brings their character and takes the penalty away", () => {
    const s0 = opened();
    const id = choices(s0).ids[0];
    const s = ok(chooseHead(s0, id));
    expect(s.gov?.head).toBe(id);
    expect(govEffect(s).mood).not.toBe(GOV.noHead.mood);
    expect(govView(s)?.head?.parts[0].name).toBe(TRAITS[traitOf(id)].name);
    expect(chooseHead(s, 99999)).toMatchObject({ ok: false });
  });

  it("a monarch's grown children are the heirs, and power passes to one of them", () => {
    let s = opened();
    const [mother] = adults(s).filter((r) => r.sex === "f");
    s = ok(chooseHead(s, choices(s).ids[0]));
    s = { ...s, gov: { ...s.gov!, head: mother.id } };
    const kid = Object.values(s.residents).find((r) => r.id !== mother.id && r.household !== mother.household)!;
    s = { ...s, residents: { ...s.residents, [kid.id]: { ...kid, mother: mother.id, born: s.gameMinutes - 20 * YEAR_MIN } } };
    expect(choices(s)).toEqual({ kind: "heir", ids: [kid.id] });
    // the monarch dies: the heir is offered, the town is without a head until chosen
    const { [mother.id]: _gone, ...rest } = s.residents;
    const after = govStep({ ...s, residents: rest }).sim;
    expect(after.gov?.head).toBeNull();
    expect(choices(after)).toEqual({ kind: "heir", ids: [kid.id] });
    expect(ok(chooseHead(after, kid.id)).gov?.head).toBe(kid.id);
  });

  it("a republican term that runs out goes on with the same head, at a cost, and opens the choice", () => {
    let s = ok(setForm(govStep(world()).sim, "republic"));
    s = ok(setTerm(s, 2));
    expect(govEffect({ ...s, gov: { ...s.gov!, head: null } })).toEqual(GOV.noHead);
    const id = choices(s).ids[0];
    s = ok(chooseHead(s, id));
    expect(choices(s).kind).toBe("none"); // the first term runs
    const one = govEffect(s);
    s = govStep({ ...s, gameMinutes: s.gameMinutes + termMinutes(2) }).sim;
    expect(s.gov?.terms).toBe(2);
    expect(govEffect(s).mood).toBe(one.mood + GOV.extraTerm.mood);
    expect(choices(s).kind).toBe("open");
    expect(choices(s).ids).not.toContain(id);
  });

  it("every character comes up among the residents", () => {
    const seen = new Set(Array.from({ length: 400 }, (_, i) => traitOf(i + 1)));
    expect(seen.size).toBe(Object.keys(TRAITS).length);
  });

  it("the form changes at most once in five years, unless forced from the developer panel", () => {
    const s = ok(setForm(ok(setForm(govStep(world()).sim, "republic")), "republic"));
    expect(s.gov?.form).toBe("republic");
    expect(setForm(s, "monarchy")).toMatchObject({ ok: false });
    expect(setForm({ ...s, gameMinutes: s.gameMinutes + 4 * YEAR_MIN }, "monarchy")).toMatchObject({ ok: false });
    expect(setForm({ ...s, gameMinutes: s.gameMinutes + 5 * YEAR_MIN }, "monarchy")).toMatchObject({ ok: true });
    expect(setForm(s, "monarchy", true)).toMatchObject({ ok: true });
  });

  it("the head works as a clerk of the town hall and keeps the place when the hall is full", () => {
    const r = addRoad(emptyRoads(), [[-50, 0], [50, 0]], "dirt", 1, [0]);
    if (!r.ok) throw new Error(r.reason);
    let s = opened({ ...world(), roads: r.graph });
    const id = choices(s).ids[0];
    // the hall is full of other clerks already
    const others = Object.values(s.residents).filter((x) => x.id !== id).slice(0, BUILDINGS.townhall.jobs);
    s = { ...s, residents: { ...s.residents, ...Object.fromEntries(others.map((x) => [x.id, { ...x, job: 9 }])) } };
    const c = chooseHeadCmd(s, id);
    if (!c.ok) throw new Error(c.reason);
    expect(c.sim.residents[id].job).toBe(9);
    expect(Object.values(c.sim.residents).filter((x) => x.job === 9).length).toBeLessThanOrEqual(BUILDINGS.townhall.jobs); // the others in tents lose theirs; the head never
    expect(rebalanceJobs(c.sim).residents[id].job).toBe(9);
  });

  it("records a row a day and keeps the government and the records in the save", () => {
    let s = recordDay(opened(), 100);
    s = recordDay(s, 100); // the same day again: no second row
    s = recordDay(s, 101);
    expect(s.history.map((r) => r.day)).toEqual([100, 101]);
    expect(s.history[0].pop).toBe(Object.keys(s.residents).length);
    s = ok(chooseHead(s, choices(s).ids[0]));
    const back = parseSave({ version: 4, city, sim: JSON.parse(JSON.stringify({ ...s, realTime: NOW })) }, NOW + 1000);
    expect(back?.sim.gov).toEqual(s.gov);
    expect(back?.sim.history).toEqual(s.history);
  });

  it("a save from before the confirmed form starts with the form unless a head was chosen", () => {
    const load = (s: SimState) => {
      const { settled: _s, ...old } = s.gov!;
      return parseSave({ version: 4, city, sim: JSON.parse(JSON.stringify({ ...s, gov: old, realTime: NOW })) }, NOW + 1000)?.sim.gov?.settled;
    };
    const s = opened();
    expect(load(s)).toBe(false);
    expect(load(ok(chooseHead(s, choices(s).ids[0])))).toBe(true);
  });

  it("an old save's children get their parents from the household's couple", () => {
    const s = world();
    const plain = Object.fromEntries(Object.values(s.residents).map(({ mother: _m, father: _f, ...r }) => [r.id, r]));
    const back = parseSave({ version: 4, city, sim: JSON.parse(JSON.stringify({ ...s, residents: plain, realTime: NOW })) }, NOW + 1000);
    for (const r of Object.values(s.residents)) {
      expect(back?.sim.residents[r.id].mother).toBe(r.mother);
      expect(back?.sim.residents[r.id].father).toBe(r.father);
    }
    expect(Object.values(s.residents).some((r) => r.mother !== undefined)).toBe(true);
  });
});
