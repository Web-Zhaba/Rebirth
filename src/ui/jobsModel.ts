import type { JobKey } from "../sim/buildings";
import { MAX_COMMUTE } from "../sim/people";
import type { JobReport } from "../sim/types";
import type { IconName } from "./icons";
import { L, plural } from "../i18n";

// Pure helpers behind the «Работа» tab and the staff controls of the building inspector.

export const JOB_ICON: Record<JobKey, IconName> = { food: "food", materials: "log", crafts: "craft", trade: "trade", services: "well", build: "build" };
export const PRIORITY_SHORT: readonly string[] = [L("Нет", "None"), L("Низк.", "Low"), L("Обыч.", "Norm."), L("Выс.", "High")];
export const PRIORITY_LONG: readonly string[] = [L("Нет", "None"), L("Низкий", "Low"), L("Обычный", "Normal"), L("Высокий", "High")];

// Staff limit shown for a workplace: its places, cut by the limit.
export const staffLimit = (staff: number | undefined, jobs: number): number => (staff === undefined ? jobs : Math.max(0, Math.min(jobs, staff)));

// Lines under the group rows: who is without work and why places stay empty.
export function jobNotes(r: JobReport): string[] {
  const out: string[] = [];
  const open = r.groups.reduce((a, g) => a + g.open, 0);
  const byPriority = r.groups.reduce((a, g) => a + g.closedByPriority, 0);
  const byStaff = r.groups.reduce((a, g) => a + g.closedByStaff, 0);
  if (r.jobless > 0) out.push(L(`Без работы: ${r.jobless} ${plural(r.jobless, "взрослый", "взрослых", "взрослых")}${r.construction ? ", они идут на стройку" : ""}`, `Without work: ${r.jobless} ${plural(r.jobless, "", "", "", "adult")}${r.construction ? "; they go to the building sites" : ""}`));
  if (open > 0) {
    out.push(L(`Свободных мест: ${open}`, `Open jobs: ${open}`));
    if (r.jobless === 0) out.push(L("Все взрослые при деле: людей не хватает на открытые места", "All adults are busy: not enough people for the open jobs"));
    else {
      if (r.tentAdults > 0) out.push(L(`${r.tentAdults} ${plural(r.tentAdults, "взрослый живёт", "взрослых живут", "взрослых живут")} в палатках: пока нет дома, работы им не дают`, `${r.tentAdults} ${plural(r.tentAdults, "", "", "", "adult lives", "adults live")} in tents: no jobs for them until they have a house`));
      if (r.jobless > r.tentAdults) out.push(L(`Остальные не дойдут до свободных мест за ${MAX_COMMUTE} мин: нужно жильё ближе к работе или дорога короче`, `The rest can’t reach the open jobs within ${MAX_COMMUTE} min: they need housing closer to work or a shorter road`));
    }
  }
  if (byPriority > 0) out.push(L(`${byPriority} ${plural(byPriority, "место закрыто", "места закрыто", "мест закрыто")} приоритетом «Нет»`, `${byPriority} ${plural(byPriority, "", "", "", "job is", "jobs are")} closed by priority “None”`));
  if (byStaff > 0) out.push(L(`${byStaff} ${plural(byStaff, "место закрыто", "места закрыто", "мест закрыто")} лимитом найма в зданиях`, `${byStaff} ${plural(byStaff, "", "", "", "job is", "jobs are")} closed by building hiring limits`));
  return out;
}
