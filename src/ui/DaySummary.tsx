import type maplibregl from "maplibre-gl";
import { useState } from "preact/hooks";
import { summaryShown } from "../sim/summary";
import type { SummaryLine } from "../sim/types";
import { daySummary, frame } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { IconButton, Panel } from "./kit";
import { useGameMinutes } from "./useGameMinutes";

const LINE_ICON: Record<SummaryLine["kind"], IconName> = { built: "craft", arrived: "res", born: "res", made: "gumno", problem: "warning" };

// «Итоги дня»: the card made at 22:00. A line with a position flies the map there; the card is closed by
// the button or on its own at 07:00 the next morning. Mount it once inside the HUD layer: <DaySummary map={map} />.
export function DaySummary({ map }: { map: maplibregl.Map }) {
  const [closed, setClosed] = useState<number | null>(null); // `at` of the summary the player dismissed
  const gm = useGameMinutes();
  const summary = daySummary.value;
  if (!summaryShown(summary, gm) || closed === summary.at) return null;
  const fl = frame.value;
  return (
    <Panel class="day-summary" role="dialog" aria-label="Итоги дня" style={{ position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)", maxWidth: 360, width: "calc(100% - 32px)", pointerEvents: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong>
          <Icon name="night" size={18} /> Итоги дня
        </strong>
        <IconButton icon="close" label="Закрыть" size={16} onClick={() => setClosed(summary.at)} />
      </div>
      {summary.lines.length === 0 && <div>День прошёл тихо.</div>}
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
            class="link"
            title="Показать на карте"
            style={{ display: "block", textAlign: "left" }}
            onClick={() => map.flyTo({ center: fl.toLngLat(pos[0], pos[1]), zoom: Math.max(map.getZoom(), 17) })}
          >
            {body}
          </button>
        ) : (
          <div key={i}>{body}</div>
        );
      })}
    </Panel>
  );
}
