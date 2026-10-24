import { away } from "../simClient";

export function AwayNotice() {
  const a = away.value;
  if (!a) return null;
  const mins = Math.floor(a.realMs / 60000);
  const days = Math.floor(a.gameMinutes / 1440);
  const hours = Math.floor((a.gameMinutes % 1440) / 60);
  return (
    <div class="offline panel">
      <div class="offline-title">
        Пока вас не было: {Math.floor(mins / 60)} ч {mins % 60} мин — прошло {days} игр. дней {hours} ч
      </div>
      <button onClick={() => (away.value = null)}>Ок</button>
    </div>
  );
}
