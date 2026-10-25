import type maplibregl from "maplibre-gl";
import { summaryShown } from "../sim/summary";
import { daySummary, frame, pendingChoice, sendCmd } from "../simClient";
import { Icon } from "./Icon";
import { Button, Panel } from "./kit";
import { useGameMinutes } from "./useGameMinutes";

// An event with two choices (PLAN-pace.md section 10); every option states its effect. Unanswered, it resolves on its
// own with the safe option when `until` passes. U5 polishes it.
export function EventCard({ map }: { map: maplibregl.Map }) {
  const c = pendingChoice.value;
  const gm = useGameMinutes();
  if (!c) return null;
  const fl = frame.value;
  const pos = c.pos;
  const lowered = summaryShown(daySummary.value, gm);
  return (
    <Panel class="event-card" role="dialog" aria-label={c.title} style={lowered ? { top: "280px" } : undefined}>
      <div class="event-card-title">
        <Icon name="warning" size={18} /> {c.title}
      </div>
      <div>{c.text}</div>
      {pos && fl && (
        <button class="link" onClick={() => map.flyTo({ center: fl.toLngLat(pos[0], pos[1]), zoom: Math.max(map.getZoom(), 17) })}>
          Показать на карте
        </button>
      )}
      {c.options.map((o, i) => (
        <Button key={i} variant={i === c.safe ? "default" : "primary"} class="event-card-option" onClick={() => void sendCmd({ type: "choose", id: c.id, option: i as 0 | 1 })}>
          <strong>{o.label}</strong>
          <span class="event-card-effect">{o.effect}</span>
        </Button>
      ))}
    </Panel>
  );
}
