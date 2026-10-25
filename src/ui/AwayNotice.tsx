import type { Away } from "../sim/protocol";
import { DAY_MIN } from "../sim/time";
import { away, catchUp } from "../simClient";

const NUM = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function duration(minutes: number): string {
  const days = Math.floor(minutes / DAY_MIN);
  const hours = Math.floor((minutes % DAY_MIN) / 60);
  return days > 0 ? `${days} дн. ${hours} ч` : `${hours} ч`;
}

// Lines of goods made; empty goods are left out.
function produced(a: Away): string[] {
  const p = a.produced;
  const out: string[] = [];
  if (p.food >= 1) out.push(`провизия ${NUM.format(p.food / 1000)} т`);
  if (p.logs >= 0.05) out.push(`брёвна ${NUM.format(p.logs)} м³`);
  if (p.planks >= 0.05) out.push(`доски ${NUM.format(p.planks)} м³`);
  if (p.stone >= 0.05) out.push(`камень ${NUM.format(p.stone)} т`);
  if (p.wares >= 0.5) out.push(`утварь ${Math.round(p.wares)} шт.`);
  return out;
}

export function AwayNotice() {
  const c = catchUp.value;
  if (c) {
    const pct = c.total > 0 ? Math.min(100, Math.floor((c.done / c.total) * 100)) : 0;
    return (
      <div class="offline panel">
        <div class="offline-title">Пока вас не было…</div>
        <div class="progress">
          <div class="progress-bar" style={{ width: `${pct}%` }} />
        </div>
        <div class="offline-line">{pct}%</div>
      </div>
    );
  }
  const a = away.value;
  if (!a) return null;
  const mins = Math.floor(a.realMs / 60000);
  const goods = produced(a);
  return (
    <div class="offline offline-wide panel">
      <div class="offline-title">Пока вас не было</div>
      <div class="offline-body">
        <div class="offline-line">
          Прошло {Math.floor(mins / 60)} ч {mins % 60} мин, в игре — {duration(a.gameMinutes)}
        </div>
        <div class="offline-line">
          Население: с {a.popBefore} до {a.popAfter} ({signed(a.popAfter - a.popBefore)})
        </div>
        <div class="offline-line">
          Родилось {a.births}, умерло {a.deaths}, приехало {a.arrivals}, уехало {a.departures}
        </div>
        <div class="offline-line">Достроено зданий: {a.built}</div>
        <div class="offline-line">Произведено: {goods.length > 0 ? goods.join(", ") : "ничего"}</div>
        {a.chronicle.length > 0 && (
          <>
            <div class="offline-sub">Летопись</div>
            <ul class="offline-chronicle">
              {a.chronicle.map((e, i) => (
                <li key={i}>{e.text}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <button onClick={() => (away.value = null)}>Ок</button>
    </div>
  );
}
