import { NEED_NAMES, NEEDS } from "../sim/needs";
import type { Needs } from "../sim/types";
import { L } from "../i18n";

// Four small bars under a resident: satiety, rest, company and warmth. Text and numbers carry the meaning; the bar is
// only a second reading of the same value, so the component is safe for screen readers and never relies on colour.
export function NeedsBars({ needs, compact = false }: { needs?: Needs; compact?: boolean }) {
  if (!needs) return null;
  return (
    <div class={compact ? "needs needs-compact" : "needs"} role="group" aria-label={L("Потребности", "Needs")}>
      {(Object.keys(NEED_NAMES) as (keyof Needs)[]).map((id) => {
        const value = Math.round(needs[id]);
        const tone = needs[id] < NEEDS.warn[id] ? "bad" : needs[id] < 60 ? "warn" : "";
        return (
          <span key={id} class={tone ? `need ${tone}` : "need"}>
            <span class="need-name">{NEED_NAMES[id]}</span>
            <span class="need-track" aria-hidden="true">
              <i class="need-fill" style={{ width: `${value}%` }} />
            </span>
            <span class="need-value">{value}</span>
          </span>
        );
      })}
    </div>
  );
}
