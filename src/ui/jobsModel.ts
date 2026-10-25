import type { JobKey } from "../sim/buildings";
import { MAX_COMMUTE } from "../sim/people";
import type { JobReport } from "../sim/types";
import type { IconName } from "./icons";

const plural = (n: number, one: string, few: string, many: string): string => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

// Pure helpers behind the «Работа» tab and the staff controls of the building inspector.

export const JOB_ICON: Record<JobKey, IconName> = { food: "food", materials: "log", crafts: "craft", trade: "trade", services: "well", build: "build" };
export const PRIORITY_SHORT: readonly string[] = ["Нет", "Низк.", "Обыч.", "Выс."];
export const PRIORITY_LONG: readonly string[] = ["Нет", "Низкий", "Обычный", "Высокий"];

// Staff limit shown for a workplace: its places, cut by the limit.
export const staffLimit = (staff: number | undefined, jobs: number): number => (staff === undefined ? jobs : Math.max(0, Math.min(jobs, staff)));

// Lines under the group rows: who is without work and why places stay empty.
export function jobNotes(r: JobReport): string[] {
  const out: string[] = [];
  const open = r.groups.reduce((a, g) => a + g.open, 0);
  const byPriority = r.groups.reduce((a, g) => a + g.closedByPriority, 0);
  const byStaff = r.groups.reduce((a, g) => a + g.closedByStaff, 0);
  if (r.jobless > 0) out.push(`Без работы: ${r.jobless} ${plural(r.jobless, "взрослый", "взрослых", "взрослых")}${r.construction ? ", они идут на стройку" : ""}`);
  if (open > 0) {
    out.push(`Свободных мест: ${open}`);
    if (r.jobless === 0) out.push("Все взрослые при деле: людей не хватает на открытые места");
    else {
      if (r.tentAdults > 0) out.push(`${r.tentAdults} ${plural(r.tentAdults, "взрослый живёт", "взрослых живут", "взрослых живут")} в палатках: пока нет дома, работы им не дают`);
      if (r.jobless > r.tentAdults) out.push(`Остальные не дойдут до свободных мест за ${MAX_COMMUTE} мин: нужно жильё ближе к работе или дорога короче`);
    }
  }
  if (byPriority > 0) out.push(`${byPriority} ${plural(byPriority, "место закрыто", "места закрыто", "мест закрыто")} приоритетом «Нет»`);
  if (byStaff > 0) out.push(`${byStaff} ${plural(byStaff, "место закрыто", "места закрыто", "мест закрыто")} лимитом найма в зданиях`);
  return out;
}
