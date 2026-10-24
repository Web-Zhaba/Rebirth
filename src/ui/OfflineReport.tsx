import { offlineReport } from "../game/state";
import { RESOURCES } from "../game/defs";
import { fmtDuration, RES_ICON } from "./format";

const sign = (n: number) => (n < 0 ? "−" : "+") + Math.abs(Math.round(n));

export function OfflineReport() {
  const r = offlineReport.value;
  if (!r) return null;
  return (
    <div class="offline panel">
      <div class="offline-title">Пока вас не было: {fmtDuration(r.ms)}</div>
      <div class="offline-gains">
        {RESOURCES.map((k) => (
          <span key={k}>
            {RES_ICON[k]} {sign(r[k])}
          </span>
        ))}
        <span>👥 {sign(r.popDelta)}</span>
      </div>
      <button onClick={() => (offlineReport.value = null)}>Ок</button>
    </div>
  );
}
