import type { ServiceId } from "../sim/types";
import { L, plural } from "../i18n";

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
  return id === "famine" || id === "lowfood" || id === "outlook" || id === "nohands" || id === "nologs" || id === "starving" || id === "tired" || id === "lonely" || id === "freezing" ? "town" : null;
}

export function serviceWarningText(name: string, uncovered: number): string {
  const word = plural(uncovered, "дом", "дома", "домов", "house");
  return L(`${uncovered} ${word} без услуги «${name}»`, `${uncovered} ${word} without ${name}`);
}
