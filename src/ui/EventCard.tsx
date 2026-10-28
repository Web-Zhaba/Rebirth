import { flyOrJump } from "../map/motion";
import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "preact/hooks";
import { frame, pendingChoice, sendCmd, setSpeed, speed } from "../simClient";
import { play } from "./sound";
import { Icon } from "./Icon";
import { Button, Panel } from "./kit";
import { hoursLeft } from "./toastModel";
import { useGameMinutes } from "./useGameMinutes";

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
  const m = h % 100;
  const w = m >= 11 && m <= 14 ? "часов" : h % 10 === 1 ? "час" : h % 10 >= 2 && h % 10 <= 4 ? "часа" : "часов";
  return `${h} ${w}`;
};

// An event with two choices (PLAN-pace.md section 10); every option states its effect. Unanswered, it resolves on its
// own with the safe option when `until` passes. Enter picks the safe option while the focus is on the card itself.
export function EventCard({ map }: { map: maplibregl.Map }) {
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
    <Panel class="event-card" role="dialog" aria-label={c.title} tabIndex={0} onKeyDown={onKey}>
      <div class="event-card-head">
        <div class="event-card-title">
          <Icon name="scroll" size={18} /> {c.title}
        </div>
        <div class="event-card-actions">
          <button
            class="event-card-pause-btn"
            type="button"
            title={isPaused ? "Возобновить время (1×)" : "Поставить на паузу"}
            onClick={togglePause}
          >
            <Icon name={isPaused ? "play" : "pause"} size={14} />
            <span>{isPaused ? "На паузе" : "Пауза"}</span>
          </button>
        </div>
      </div>
      <p class="event-card-text">{c.text}</p>
      {pos && fl && (
        <button class="link event-card-place" onClick={() => flyOrJump(map, { center: fl.toLngLat(pos[0], pos[1]), zoom: Math.max(map.getZoom(), 17) })}>
          <Icon name="find" size={14} /> Показать на карте
        </button>
      )}
      {c.options.map((o, i) => (
        <Button key={i} variant={i === c.safe ? "default" : "primary"} class="event-card-option" onClick={() => choose(i)}>
          <strong>{o.label}</strong>
          <span class="event-card-effect">{o.effect}</span>
          {i === c.safe && <span class="event-card-safe">решится так, если не выбрать</span>}
        </Button>
      ))}
      <div class="event-card-foot">
        <span class={`event-card-timer${isUrgent ? " urgent" : ""}`}>
          <Icon name="hourglass" size={14} /> Решение через {hoursText(leftHours)}
        </span>
        <label class="event-card-autopause" title="Автоматически ставить симуляцию на паузу при появлении события">
          <input type="checkbox" checked={autopause} onChange={toggleAutopause} />
          <span>Автопауза</span>
        </label>
        <span class="event-card-key">Enter на карточке: «{c.options[c.safe].label}»</span>
      </div>
    </Panel>
  );
}
