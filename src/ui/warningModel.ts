import type { ServiceId } from "../sim/types";

export interface WarningLike {
  id: string;
  text: string;
}

export type WarningAction = "town" | { overlay: ServiceId } | null;

const SERVICE_IDS = new Set<ServiceId>(["well", "market", "chapel", "school", "healer"]);

export function freshWarnings(previous: ReadonlySet<string>, current: readonly WarningLike[]): WarningLike[] {
  return current.filter((w) => !previous.has(w.id));
}

export function warningAction(id: string): WarningAction {
  if (id.startsWith("service:")) {
    const service = id.slice("service:".length) as ServiceId;
    if (SERVICE_IDS.has(service)) return { overlay: service };
  }
  return id === "famine" || id === "lowfood" || id === "outlook" || id === "nohands" || id === "nologs" ? "town" : null;
}

export function serviceWarningText(name: string, uncovered: number): string {
  const m = uncovered % 100;
  const word = m >= 11 && m <= 14 ? "домов" : uncovered % 10 === 1 ? "дом" : uncovered % 10 >= 2 && uncovered % 10 <= 4 ? "дома" : "домов";
  return `${uncovered} ${word} без услуги «${name}»`;
}
