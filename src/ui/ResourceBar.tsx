import { RESOURCES } from "../game/defs";
import { rates } from "../game/sim";
import { economy } from "../game/state";
import { fmtRate, RES_ICON } from "./format";

export function ResourceBar() {
  const e = economy.value;
  if (!e) return null;
  const r = rates(e);
  return (
    <div class="resbar panel">
      {RESOURCES.map((k) => (
        <span class="res" key={k}>
          {RES_ICON[k]} {Math.floor(e[k])}
          <span class={r[k] < 0 ? "rate neg" : "rate"}>{fmtRate(r[k])}</span>
        </span>
      ))}
      <span class="res">
        👥 {Math.floor(e.pop)}/{r.housing}
      </span>
    </div>
  );
}
