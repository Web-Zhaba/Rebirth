import { describe, expect, it } from "vitest";
import { DOMAIN_IDS } from "../sim/domains";
import { initialProgress, MAX_QUEUE, TECHS } from "../sim/tech";
import type { ProgressState, ResearchView } from "../sim/types";
import { buildTechView, eraProgress, formatDays, modifierLines, techBadge, type TechInput } from "./techModel";

const speeds = Object.fromEntries(DOMAIN_IDS.map((d) => [d, 1])) as ResearchView["speeds"];

function input(patch: Partial<ProgressState> = {}, view: Partial<ResearchView> = {}, pop = 10): TechInput {
  const progress = { ...initialProgress(), ...patch };
  const a = progress.research.active;
  const research: ResearchView = {
    active: a ? { techId: a.techId, share: 0.4, etaMinutes: 1440 * 2 } : null,
    queue: progress.research.queue,
    speeds,
    era: progress.era,
    eraTwoMet: false,
    ...view,
  };
  return { progress, research, pop };
}

describe("tech model", () => {
  it("marks free roots available and chained techs closed with the missing prerequisite", () => {
    const v = buildTechView(input());
    expect(v.nodes.get("carpentry")!.state).toBe("available");
    expect(v.nodes.get("carpentry")!.canStart).toBe(true);
    const stone = v.nodes.get("stonework")!;
    expect(stone.state).toBe("locked");
    expect(stone.reason).toBe("нужна технология Плотницкое дело");
    expect(stone.statusText).toContain("Закрыто");
    expect(v.idle).toBe(true);
  });

  it("closes era II techs by the era first", () => {
    const v = buildTechView(input({ techs: ["carpentry", "stonework"] }));
    const paving = v.nodes.get("paving")!;
    expect(paving.state).toBe("locked");
    expect(paving.reason).toBe("нужна эпоха II");
    expect(paving.canQueue).toBe(false);
    expect(buildTechView(input({ techs: ["carpentry", "stonework"], era: 2 })).nodes.get("paving")!.state).toBe("available");
  });

  it("tells done, active and queued apart, with time left", () => {
    const v = buildTechView(input({ techs: ["carpentry"], research: { active: { techId: "storage", done: 0.4 }, queue: ["stonework"] } }));
    expect(v.nodes.get("carpentry")!.state).toBe("done");
    const a = v.nodes.get("storage")!;
    expect(a.state).toBe("active");
    expect(a.days).toBeCloseTo(2);
    expect(a.statusText).toBe("Исследуется, 40 %");
    expect(a.canCancel).toBe(true);
    expect(v.active?.id).toBe("storage");
    expect(v.idle).toBe(false);
    const q = v.nodes.get("stonework")!;
    expect(q.state).toBe("queued");
    expect(q.queuePos).toBe(1);
    expect(v.queue.map((e) => e.node.id)).toEqual(["stonework"]);
    // with something under way an available tech can only be queued
    const crafts = v.nodes.get("crafts")!;
    expect(crafts.canStart).toBe(false);
    expect(crafts.canQueue).toBe(true);
  });

  it("scales the time by the domain speed and the insight", () => {
    const fast = { ...speeds, build: 2 };
    const v = buildTechView(input({ insights: ["carpenter-corner"] }, { speeds: fast }));
    // carpentry: 3 days, insight -40 %, speed 2
    expect(v.nodes.get("carpentry")!.days).toBeCloseTo(0.9);
    expect(v.nodes.get("carpentry")!.insight).toEqual({ text: "Плотницкий угол", cut: 0.4 });
    expect(v.nodes.get("storage")!.days).toBeCloseTo(3);
  });

  it("limits the queue", () => {
    const queue = ["stonework", "crafts", "fishing"].slice(0, MAX_QUEUE);
    const v = buildTechView(input({ research: { active: { techId: "carpentry", done: 0 }, queue } }));
    expect(v.nodes.get("storage")!.canQueue).toBe(false);
  });

  it("lists what a tech opens, with modifiers", () => {
    const v = buildTechView(input());
    expect(v.nodes.get("trade")!.opens).toEqual(["торговая зона", "рынок"]);
    expect(v.nodes.get("threefield")!.opens).toEqual(["урожай полей +10 %"]);
    expect(modifierLines(TECHS.find((t) => t.id === "trusses")!.modifiers)).toEqual(["свайный мост: пролёт +15 м", "каменный мост: пролёт +40 м"]);
  });

  it("shows the era II conditions only while the era is closed", () => {
    const v = buildTechView(input({ techs: ["carpentry", "storage"] }, {}, 40));
    expect(v.lanes[1].conditions).toEqual({ pop: 40, popNeed: 100, techs: 2, techsNeed: 12, met: false });
    expect(v.lanes[1].open).toBe(false);
    expect(v.lanes[0].conditions).toBeNull();
    expect(buildTechView(input({ era: 2 })).lanes[1].conditions).toBeNull();
    expect(eraProgress(100, { techs: TECHS.filter((t) => t.era === 1).map((t) => t.id) }).met).toBe(true);
  });

  it("groups lanes by era and domain, empty domains left out", () => {
    const v = buildTechView(input());
    expect(v.lanes.map((l) => l.era)).toEqual([1, 2]);
    expect(v.lanes[0].domains.map((d) => d.id)).not.toContain("learn");
    expect(v.lanes[1].domains.map((d) => d.id)).toContain("learn");
    expect(v.lanes.flatMap((l) => l.domains.flatMap((d) => d.nodes)).length).toBe(TECHS.length);
  });

  it("says why a queued tech waits", () => {
    const v = buildTechView(input({ research: { active: null, queue: ["stonework"] } }));
    expect(v.queue[0].waits).toBe("Плотницкое дело");
    expect(v.idle).toBe(true);
  });

  it("badge: done wins over idle, nothing while busy", () => {
    expect(techBadge(2, 3, true)).toBe("done");
    expect(techBadge(3, 3, true)).toBe("idle");
    expect(techBadge(3, 3, false)).toBeNull();
    expect(techBadge(null, 3, false)).toBeNull();
  });

  it("formats days", () => {
    expect(formatDays(0.05)).toBe("меньше дня");
    expect(formatDays(2.5)).toBe("2,5 дн.");
    expect(formatDays(12.4)).toBe("12 дн.");
  });
});
