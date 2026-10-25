import { describe, expect, it } from "vitest";
import { JOB_GROUPS, JOB_KEYS } from "../sim/buildings";
import type { JobReport } from "../sim/types";
import { JOB_ICON, jobNotes, staffLimit } from "./jobsModel";

const report = (patch: Partial<JobReport> = {}): JobReport => ({
  groups: JOB_GROUPS.map((key) => ({ key, workers: 0, places: 0, open: 0, closedByPriority: 0, closedByStaff: 0 })),
  adults: 10,
  jobless: 0,
  tentAdults: 0,
  construction: false,
  floor: 0,
  drafted: 0,
  ...patch,
});

describe("jobs model", () => {
  it("has an icon for every group and construction", () => {
    expect(Object.keys(JOB_ICON).sort()).toEqual([...JOB_KEYS].sort());
  });
  it("staff limit is the places unless cut", () => {
    expect(staffLimit(undefined, 4)).toBe(4);
    expect(staffLimit(2, 4)).toBe(2);
    expect(staffLimit(9, 4)).toBe(4);
    expect(staffLimit(-1, 4)).toBe(0);
  });
  it("says nothing when everything is in order", () => {
    expect(jobNotes(report())).toEqual([]);
  });
  it("explains why places stay empty", () => {
    const r = report({ jobless: 3, tentAdults: 1, construction: true });
    r.groups[0].open = 2;
    r.groups[1].closedByPriority = 3;
    r.groups[2].closedByStaff = 1;
    const notes = jobNotes(r).join("|");
    expect(notes).toContain("Без работы: 3 взрослых, они идут на стройку");
    expect(notes).toContain("Свободных мест: 2");
    expect(notes).toContain("в палатках");
    expect(notes).toContain("не дойдут");
    expect(notes).toContain("приоритетом «Нет»");
    expect(notes).toContain("лимитом найма");
    const idle = report();
    idle.groups[0].open = 2;
    expect(jobNotes(idle).join("|")).toContain("людей не хватает");
  });
});
