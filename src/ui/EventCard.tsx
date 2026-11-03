import type { View } from "../view/view";
import { atLeastAsClose, CLOSE_UP_MPP } from "../view/scale";
import { useEffect, useRef, useState } from "preact/hooks";
import { frame, pendingChoice, sendCmd, setSpeed, speed } from "../simClient";
import { play } from "./sound";
import { Icon } from "./Icon";
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
// A tar strip carries the title, the time left and the card's tools; the bark under it, the text and the choices.
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

  const pauseLabel = isPaused ? L("Возобновить время (1×)", "Resume time (1×)") : L("Поставить на паузу", "Pause");
  const leftText = `${L("Решение через", "Decides in")} ${hoursText(leftHours)}`;

  return (
    <section class="event-card" role="dialog" aria-labelledby={SEMANTIC_IDS.eventCardTitle} tabIndex={0} onKeyDown={onKey}>
      <header class="event-card-head">
        <Icon name="scroll" size={16} />
        <h2 class="event-card-title" id={SEMANTIC_IDS.eventCardTitle}>
          {c.title}
        </h2>
        <span class={`event-card-timer${isUrgent ? " urgent" : ""}`} title={leftText}>
          <Icon name="hourglass" size={12} />
          <span aria-hidden="true">
            {leftHours} {L("ч", "h")}
          </span>
          <span class="event-card-sr">{leftText}</span>
        </span>
        {pos && fl && (
          <button
            type="button"
            class="event-card-tool"
            title={L("Показать на карте", "Show on the map")}
            aria-label={L("Показать на карте", "Show on the map")}
            onClick={() => view.flyTo({ center: fl.toLngLat(pos[0], pos[1]), mpp: atLeastAsClose(view.metersPerPixel(), CLOSE_UP_MPP) })}
          >
            <Icon name="find" size={16} />
          </button>
        )}
        <button type="button" class="event-card-tool" title={pauseLabel} aria-label={pauseLabel} aria-pressed={isPaused} onClick={togglePause}>
          <Icon name={isPaused ? "play" : "pause"} size={16} />
        </button>
      </header>
      <p class="event-card-text">{c.text}</p>
      <div class="event-card-options">
        {c.options.map((o, i) => (
          <button key={i} type="button" class={`event-card-option${i === c.safe ? " is-safe" : ""}`} onClick={() => choose(i)}>
            <span class="event-card-label">
              <strong>{o.label}</strong>
              {i === c.safe && <kbd title={L("Enter на карточке", "Enter on the card")}>Enter</kbd>}
            </span>
            <span class="event-card-effect">{o.effect}</span>
            {i === c.safe && <span class="event-card-safe">{L("решится так, если не выбрать", "the outcome if you don’t choose")}</span>}
          </button>
        ))}
      </div>
      <label class="event-card-autopause" title={L("Автоматически ставить симуляцию на паузу при появлении события", "Pause the simulation automatically when an event appears")}>
        <input type="checkbox" checked={autopause} onChange={toggleAutopause} />
        <span>{L("Автопауза", "Auto-pause")}</span>
      </label>
    </section>
  );
}
