import { groupOf, priorityOf, staffCap } from "../sim/jobs";
import type { Levers } from "../sim/levers";
import type { Building, BuildingQuery } from "../sim/types";
import type { IconName } from "../ui/icons";
import { L } from "../i18n";

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
    return { label: `${pct}%`, icon: "hourglass", tone: "build", title: L(`Строится: ${pct}%`, `Under construction: ${pct}%`) };
  }
  if (b.state !== "active" || b.upgrade || info?.kind !== "workplace") return null;
  // Hiring closed on purpose is a reason of its own, not a lack of people.
  const g = groupOf(b);
  if (g !== null && priorityOf(levers, g) === 0) return { label: L("приоритет «нет»", "priority “none”"), icon: "lock", tone: "warn", title: L("Набор закрыт: приоритет группы «нет»", "Hiring closed: group priority is “none”") };
  if (info.capacity > 0 && staffCap(b, info.capacity) === 0) return { label: L("набор закрыт", "hiring closed"), icon: "lock", tone: "warn", title: L("Набор закрыт: лимит работников 0", "Hiring closed: worker limit is 0") };
  if (info.production?.missing) return { label: L("нет сырья", "no input"), icon: "warning", tone: "bad", title: L("Не хватает сырья", "Short of raw materials") };
  if (info.capacity > 0 && info.workers.length === 0) return { label: L("нет людей", "no workers"), icon: "person", tone: "bad", title: L("Нет работников", "No workers") };
  return null;
}
