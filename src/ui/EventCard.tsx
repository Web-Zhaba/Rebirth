import type { View } from "../view/view";
import { atLeastAsClose, CLOSE_UP_MPP } from "../view/scale";
import { useEffect, useRef, useState } from "preact/hooks";
import { frame, pendingChoice, sendCmd, setSpeed, speed } from "../simClient";
import { play } from "./sound";
import { Icon } from "./Icon";
import { Button, Panel } from "./kit";
import { hoursLeft } from "./toastModel";
import { useGameMinutes } from "./useGameMinutes";
import { SEMANTIC_IDS } from "./semanticIds";
import { L, plural } from "../i18n";

const AUTOPAUSE_KEY = "rebirth.events.autopause";
const readAutopause = (): boolean => {
  try {
    const val = localStorage.getItem(AUTOPAUSE_KEY);
    return val === null ? true : val === "1";
  } catch {
    return true;
  }
};

const hoursText = (h: number): string => {
  return `${h} ${plural(h, "час", "часа", "часов", "hour")}`;
};

// An event with two choices (PLAN-pace.md section 10); every option states its effect. Unanswered, it resolves on its
// own with the safe option when `until` passes. Enter picks the safe option while the focus is on the card itself.
export function EventCard({ view }: { view: View }) {
  const c = pendingChoice.value;
  const gm = useGameMinutes();
  const [autopause, setAutopause] = useState(readAutopause);
  const lastPausedId = useRef<string | null>(null);

  // Auto-pause when a new event arrives if autopause is enabled
  useEffect(() => {
    if (!c) return;
    if (lastPausedId.current !== c.id) play("notify");
    if (autopause && lastPausedId.current !== c.id) {
      lastPausedId.current = c.id;
      if (speed.peek() > 0) {
        setSpeed(0);
      }
    }
  }, [c?.id, autopause]);

  if (!c) return null;
  const fl = frame.value;
  const pos = c.pos;
  const isPaused = speed.value === 0;
  const leftHours = hoursLeft(c.until, gm);
  const isUrgent = leftHours <= 4;

  const togglePause = () => setSpeed(isPaused ? 1 : 0);
  const toggleAutopause = () => {
    const next = !autopause;
    setAutopause(next);
    try {
      localStorage.setItem(AUTOPAUSE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const choose = (i: number) => void sendCmd({ type: "choose", id: c.id, option: i as 0 | 1 });
  const onKey = (e: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      choose(c.safe);
    }
  };

  return (
    <Panel class="event-card" role="dialog" aria-labelledby={SEMANTIC_IDS.eventCardTitle} tabIndex={0} onKeyDown={onKey}>
      <div class="event-card-head">
        <h2 class="event-card-title" id={SEMANTIC_IDS.eventCardTitle}>
          <Icon name="scroll" size={18} /> {c.title}
        </h2>
        <div class="event-card-actions">
          <button
            class="event-card-pause-btn"
            type="button"
            title={isPaused ? L("Возобновить время (1×)", "Resume time (1×)") : L("Поставить на паузу", "Pause")}
            onClick={togglePause}
          >
            <Icon name={isPaused ? "play" : "pause"} size={14} />
            <span>{isPaused ? L("На паузе", "Paused") : L("Пауза", "Pause")}</span>
          </button>
        </div>
      </div>
      <p class="event-card-text">{c.text}</p>
      {pos && fl && (
        <button class="link event-card-place" onClick={() => view.flyTo({ center: fl.toLngLat(pos[0], pos[1]), mpp: atLeastAsClose(view.metersPerPixel(), CLOSE_UP_MPP) })}>
          <Icon name="find" size={14} /> {L("Показать на карте", "Show on the map")}
        </button>
      )}
      {c.options.map((o, i) => (
        <Button key={i} variant={i === c.safe ? "default" : "primary"} class="event-card-option" onClick={() => choose(i)}>
          <strong>{o.label}</strong>
          <span class="event-card-effect">{o.effect}</span>
          {i === c.safe && <span class="event-card-safe">{L("решится так, если не выбрать", "the outcome if you don’t choose")}</span>}
        </Button>
      ))}
      <div class="event-card-foot">
        <span class={`event-card-timer${isUrgent ? " urgent" : ""}`}>
          <Icon name="hourglass" size={14} /> {L("Решение через", "Decides in")} {hoursText(leftHours)}
        </span>
        <label class="event-card-autopause" title={L("Автоматически ставить симуляцию на паузу при появлении события", "Pause the simulation automatically when an event appears")}>
          <input type="checkbox" checked={autopause} onChange={toggleAutopause} />
          <span>{L("Автопауза", "Auto-pause")}</span>
        </label>
        <span class="event-card-key">{L("Enter на карточке:", "Enter on the card:")} «{c.options[c.safe].label}»</span>
      </div>
    </Panel>
  );
}
