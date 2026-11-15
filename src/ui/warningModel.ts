import type { ServiceId } from "../sim/types";
import { SERVICE_IDS } from "../sim/services";
import { L, plural } from "../i18n";

export interface WarningLike {
  id: string;
  text: string;
}

export type WarningAction = "town" | { overlay: ServiceId } | null;

const SERVICES_SET = new Set<string>(SERVICE_IDS);

export function freshWarnings(previous: ReadonlySet<string>, current: readonly WarningLike[]): WarningLike[] {
  return current.filter((w) => !previous.has(w.id));
}

export function warningAction(id: string): WarningAction {
  if (id.startsWith("service:")) {
    const service = id.slice("service:".length) as ServiceId;
    if (SERVICES_SET.has(service)) return { overlay: service };
  }
  return id === "famine" || id === "lowfood" || id === "outlook" || id === "nohands" || id === "nologs" || id === "admin" || id === "starving" || id === "tired" || id === "lonely" || id === "freezing" ? "town" : null;
}

export function serviceWarningText(name: string, uncovered: number): string {
  const word = plural(uncovered, "дом", "дома", "домов", "house");
  return L(`${uncovered} ${word} без услуги «${name}»`, `${uncovered} ${word} without ${name}`);
}
