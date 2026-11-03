import type { View } from "../view/view";
import { atLeastAsClose, CLOSE_UP_MPP } from "../view/scale";
import { useEffect, useState } from "preact/hooks";
import type { SummaryLine } from "../sim/types";
import { daySummary, frame } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { IconButton, Panel } from "./kit";
import { DAY_SUMMARY_MS, daySummaryRemaining } from "./daySummaryTimerModel";
import { SEMANTIC_IDS } from "./semanticIds";
import { L } from "../i18n";

const LINE_ICON: Record<SummaryLine["kind"], IconName> = { built: "craft", arrived: "res", born: "res", made: "gumno", problem: "warning" };

// «Итоги дня»: each new card stays on screen for five real seconds. The countdown is independent
// of game speed and pause; the close button can dismiss it earlier.
export function DaySummary({ view }: { view: View }) {
  const [closed, setClosed] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(1);
  const summary = daySummary.value;
  const at = summary?.at ?? null;

  useEffect(() => {
    if (at === null || closed === at) return;
    const started = performance.now();
    let raf = 0;
    setRemaining(1);

    const tick = (now: number) => {
      const next = daySummaryRemaining(now - started);
      setRemaining(next);
      if (next <= 0) {
        setClosed(at);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const timer = window.setTimeout(() => setClosed(at), DAY_SUMMARY_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [at, closed]);

  if (!summary || closed === summary.at) return null;
  const fl = frame.value;
  return (
    <Panel class="day-summary" role="region" aria-labelledby={SEMANTIC_IDS.daySummaryTitle}>
      <div class="day-summary-head">
        <strong id={SEMANTIC_IDS.daySummaryTitle}>
          <Icon name="night" size={18} /> {L("Итоги дня", "Day summary")}
        </strong>
        <IconButton icon="close" label={L("Закрыть", "Close")} size={16} onClick={() => setClosed(summary.at)} />
      </div>
      <div
        class="day-summary-timer"
        role="progressbar"
        aria-label={L("До автоматического закрытия", "Until it closes automatically")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remaining * 100)}
        aria-valuetext={L(`Осталось ${(remaining * DAY_SUMMARY_MS / 1000).toFixed(1)} с`, `${(remaining * DAY_SUMMARY_MS / 1000).toFixed(1)} s left`)}
      >
        <span style={{ width: `${remaining * 100}%` }} />
      </div>
      {summary.lines.length === 0 && <div>{L("День прошёл тихо.", "A quiet day.")}</div>}
      {summary.lines.map((l, i) => {
        const pos = l.pos;
        const body = (
          <>
            <Icon name={LINE_ICON[l.kind]} size={14} /> {l.text}
          </>
        );
        return pos && fl ? (
          <button
            key={i}
            class="link day-summary-line"
            title={L("Показать на карте", "Show on the map")}
            onClick={() => view.flyTo({ center: fl.toLngLat(pos[0], pos[1]), mpp: atLeastAsClose(view.metersPerPixel(), CLOSE_UP_MPP) })}
          >
            {body}
          </button>
        ) : (
          <div key={i} class="day-summary-line">{body}</div>
        );
      })}
    </Panel>
  );
}
