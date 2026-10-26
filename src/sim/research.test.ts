import { describe, expect, it } from "vitest";
import { step } from "./clock";
import { emptyGrowth } from "./growth";
import { cancelResearch, eraStep, grantInsight, nextEra, queueResearch, researchSpeed, researchStep, researchView, startResearch, workDays } from "./research";
import { emptyRoads } from "./roads";
import { initialProgress, TECH_BY_ID, TECHS } from "./tech";
import { DAY_MIN } from "./time";
import type { Resident, SimState } from "./types";
import { emptyZones } from "./zones";

const town = (): SimState => ({ realTime: 1_800_000_000_000, gameMinutes: 1000, roads: emptyRoads(), zones: emptyZones(), ...emptyGrowth(7, 1000), buildings: {}, nextBuildingId: 1 });
const people = (s: SimState, n: number, school = 0): SimState => {
  const residents: Record<number, Resident> = {};
  for (let i = 1; i <= n; i++) residents[i] = { id: i, first: "Иван", last: "Тестов", sex: "m", born: -1e6, household: 1, spouse: null, job: null, commute: null, idleDays: 0, literate: school > 0, school };
  return { ...s, residents };
};
const ok = (r: { ok: boolean; sim?: SimState; reason?: string }): SimState => {
  if (!r.ok) throw new Error(r.reason);
  return r.sim!;
};
const run = (s: SimState, days: number): SimState => {
  let cur = s;
  for (let i = 0; i < Math.round(days * (DAY_MIN / 10)); i++) cur = researchStep({ ...cur, gameMinutes: cur.gameMinutes + 10 }, 10);
  return cur;
};
const have = (s: SimState, id: string) => s.progress.techs.includes(id);

describe("start, queue, cancel", () => {
  it("starts a tech whose prerequisites and era hold", () => {
    expect(ok(startResearch(town(), "carpentry")).progress.research.active).toEqual({ techId: "carpentry", done: 0 });
    expect(startResearch(town(), "stonework")).toMatchObject({ ok: false, reason: "Сначала: Плотницкое дело" });
    expect(startResearch(town(), "nope").ok).toBe(false);
    const p = { ...initialProgress(), techs: ["stonework", "carpentry"] };
    expect(startResearch({ ...town(), progress: p }, "paving")).toMatchObject({ ok: false, reason: "Нужна эпоха II" });
    expect(startResearch({ ...town(), progress: { ...p, era: 2 } }, "paving").ok).toBe(true);
  });
  it("refuses a second start and a tech already known", () => {
    const s = ok(startResearch(town(), "carpentry"));
    expect(startResearch(s, "storage").ok).toBe(false);
    expect(startResearch({ ...s, progress: { ...s.progress, techs: ["storage"] } }, "storage")).toMatchObject({ reason: "Уже изучено" });
  });
  it("queues up to three, rejects repeats, starts at once when idle", () => {
    let s = ok(queueResearch(town(), "carpentry"));
    expect(s.progress.research.active?.techId).toBe("carpentry");
    for (const id of ["storage", "foraging", "fishing"]) s = ok(queueResearch(s, id));
    expect(s.progress.research.queue).toEqual(["storage", "foraging", "fishing"]);
    expect(queueResearch(s, "stonework").ok).toBe(false);
    expect(queueResearch(s, "storage")).toMatchObject({ reason: "Уже в очереди" });
    expect(queueResearch(s, "carpentry")).toMatchObject({ reason: "Уже исследуется" });
  });
  it("lets a tech wait behind its own prerequisite", () => {
    let s = ok(queueResearch(town(), "carpentry"));
    s = ok(queueResearch(s, "stonework"));
    expect(s.progress.research.queue).toEqual(["stonework"]);
  });
  it("cancel drops the progress and starts the next; it also removes from the queue", () => {
    let s = ok(queueResearch(town(), "carpentry"));
    s = ok(queueResearch(s, "storage"));
    s = ok(queueResearch(s, "foraging"));
    s = run(s, 0.5);
    expect(s.progress.research.active!.done).toBeGreaterThan(0);
    s = ok(cancelResearch(s, "carpentry"));
    expect(s.progress.research.active).toEqual({ techId: "storage", done: 0 });
    s = ok(cancelResearch(s, "foraging"));
    expect(s.progress.research.queue).toEqual([]);
    expect(cancelResearch(s, "foraging").ok).toBe(false);
    expect(have(s, "carpentry")).toBe(false);
  });
});

describe("running", () => {
  it("finishes in its days at base speed, then starts the next in the queue", () => {
    let s = ok(queueResearch(town(), "carpentry"));
    s = ok(queueResearch(s, "storage"));
    s = run(s, 1.02);
    expect(have(s, "carpentry")).toBe(true);
    expect(s.progress.research.active?.techId).toBe("storage");
    expect(s.chronicle.at(-1)).toMatchObject({ kind: "tech:carpentry" });
    expect(s.events.at(-1)).toMatchObject({ kind: "tech" });
    expect(s.events.at(-1)!.text).toContain("лесопилка");
  });
  it("a long stretch passes several techs", () => {
    let s = town();
    for (const id of ["carpentry", "storage", "foraging"]) s = ok(queueResearch(s, id));
    s = run(s, 3.1);
    expect(s.progress.techs).toEqual(["carpentry", "storage", "foraging"]);
    expect(s.progress.research.active).toBeNull();
  });
  it("runs through the real tick", () => {
    let s = ok(queueResearch(people(town(), 2), "carpentry"));
    for (let i = 0; i < 160; i++) s = step(s);
    expect(have(s, "carpentry")).toBe(true);
  });
  it("idle with an empty queue changes nothing", () => {
    const s = town();
    expect(researchStep(s, 10)).toBe(s);
  });
  it("a queued entry that cannot start waits without blocking one that can", () => {
    let s = ok(queueResearch(town(), "carpentry"));
    s = ok(queueResearch(s, "trade")); // needs crafts
    s = ok(queueResearch(s, "storage"));
    s = run(s, 1.02);
    expect(s.progress.research.active?.techId).toBe("storage");
    expect(s.progress.research.queue).toEqual(["trade"]);
  });
});

describe("speed", () => {
  it("is 1 without literacy, up to +0.5 with it, +0.05 per restored building, at most 2", () => {
    expect(researchSpeed(town(), "learn")).toBe(1);
    expect(researchSpeed(people(town(), 10, 100), "learn")).toBeCloseTo(1.5);
    expect(researchSpeed(people(town(), 10, 50), "learn")).toBeCloseTo(1.25);
    const s = { ...people(town(), 10, 100), progress: { ...initialProgress(), restored: { learn: 4, farm: 100 } } };
    expect(researchSpeed(s, "learn")).toBeCloseTo(1.7);
    expect(researchSpeed(s, "farm")).toBeCloseTo(2); // capped at 10 restorations and at 2
    expect(researchSpeed(s, "build")).toBeCloseTo(1.5);
  });
  it("a faster town finishes sooner", () => {
    const fast = run(ok(queueResearch(people(town(), 10, 100), "carpentry")), 0.7);
    expect(have(fast, "carpentry")).toBe(true);
    expect(have(run(ok(queueResearch(town(), "carpentry")), 0.7), "carpentry")).toBe(false);
  });
  it("the view reports the share, the eta and the speeds", () => {
    expect(researchView(town()).active).toBeNull();
    const t = run(ok(queueResearch(town(), "carpentry")), 0.5);
    const v = researchView(t);
    expect(v.active!.share).toBeCloseTo(0.5, 1);
    expect(v.active!.etaMinutes).toBeCloseTo(0.5 * DAY_MIN, -2);
    expect(v.speeds.learn).toBe(1);
    expect(v.era).toBe(1);
  });
});

describe("insights", () => {
  it("cut the time of their tech and are used up with it", () => {
    let s = grantInsight(town(), "carpenter-corner");
    expect(workDays(s.progress, TECH_BY_ID.get("carpentry")!)).toBeCloseTo(0.6);
    s = ok(queueResearch(s, "carpentry"));
    s = run(s, 0.65);
    expect(have(s, "carpentry")).toBe(true);
    expect(s.progress.insights).toEqual([]);
  });
  it("do not stack: the best one counts", () => {
    const s = grantInsight(grantInsight(town(), "firing"), "ledger");
    expect(workDays(s.progress, TECH_BY_ID.get("guildwork")!)).toBeCloseTo(7 * 0.7);
  });
  it("apply to work already done", () => {
    let s = ok(queueResearch(town(), "carpentry"));
    s = run(s, 0.7);
    expect(have(s, "carpentry")).toBe(false);
    s = grantInsight(s, "carpenter-corner");
    s = run(s, 0.01);
    expect(have(s, "carpentry")).toBe(true);
  });
  it("burn with a message when the tech is known; none is given twice or unknown", () => {
    const known = { ...town(), progress: { ...initialProgress(), techs: ["carpentry"] } };
    const s = grantInsight(known, "carpenter-corner");
    expect(s.progress.insights).toEqual([]);
    expect(s.events.at(-1)!.text).toContain("уже известна");
    const held = grantInsight(town(), "masonry");
    expect(grantInsight(held, "masonry")).toBe(held);
    expect(grantInsight(held, "nope")).toBe(held);
  });
  it("the book insight adds speed to every domain and stays", () => {
    const s = grantInsight(town(), "bookmaking");
    expect(researchSpeed(s, "build")).toBeCloseTo(1.1);
    expect(s.progress.insights).toEqual(["bookmaking"]);
  });
});

describe("eras", () => {
  const era1 = TECHS.filter((t) => t.era === 1).map((t) => t.id);
  const ready = (): SimState => ({ ...people(town(), 100), progress: { ...initialProgress(), techs: era1.slice(0, 12) } });
  it("era II opens once, with a chronicle line and an event", () => {
    const s = eraStep(ready());
    expect(s.progress.era).toBe(2);
    expect(s.chronicle.at(-1)).toMatchObject({ kind: "era:2" });
    expect(s.events.at(-1)).toMatchObject({ kind: "era" });
    expect(eraStep(s)).toBe(s);
  });
  it("waits for the conditions", () => {
    expect(eraStep(people(town(), 100)).progress.era).toBe(1);
  });
  it("the admin step goes to the next era once", () => {
    const s = nextEra(town());
    expect(s.progress.era).toBe(2);
    expect(nextEra(s)).toBe(s);
  });
});
