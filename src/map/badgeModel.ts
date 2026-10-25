import { groupOf, priorityOf, staffCap } from "../sim/jobs";
import type { Levers } from "../sim/levers";
import type { Building, BuildingQuery } from "../sim/types";
import type { IconName } from "../ui/icons";

// Pure part of the map badges: which tag a building gets.

export interface BadgeSpec {
  label: string;
  icon: IconName;
  tone: "bad" | "warn" | "build";
  title: string;
}

// Which badge a building gets, from the snapshot and (for finished workplaces) the last answer of the worker.
export function badgeFor(b: Building, info: BuildingQuery | null | undefined, levers?: Pick<Levers, "jobs">): BadgeSpec | null {
  if (b.state === "building" && b.labor > 0) {
    const pct = Math.min(99, Math.floor((b.done / b.labor) * 100));
    return { label: `${pct}%`, icon: "hourglass", tone: "build", title: `Строится: ${pct}%` };
  }
  if (b.state !== "active" || b.upgrade || info?.kind !== "workplace") return null;
  // Hiring closed on purpose is a reason of its own, not a lack of people.
  const g = groupOf(b);
  if (g !== null && priorityOf(levers, g) === 0) return { label: "приоритет «нет»", icon: "lock", tone: "warn", title: "Набор закрыт: приоритет группы «нет»" };
  if (info.capacity > 0 && staffCap(b, info.capacity) === 0) return { label: "набор закрыт", icon: "lock", tone: "warn", title: "Набор закрыт: лимит работников 0" };
  if (info.production?.missing) return { label: "нет сырья", icon: "warning", tone: "bad", title: "Не хватает сырья" };
  if (info.capacity > 0 && info.workers.length === 0) return { label: "нет людей", icon: "person", tone: "bad", title: "Нет работников" };
  return null;
}
