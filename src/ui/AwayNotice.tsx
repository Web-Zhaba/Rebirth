import type { Away } from "../sim/protocol";
import { DAY_MIN } from "../sim/time";
import { away, catchUp } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { Button, Panel, ProgressBar } from "./kit";
import { currentWarnings } from "./TopBar";
import "./journal.css";

const NUM = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

const plural = (n: number, one: string, few: string, many: string): string => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

// "3 дн. 4 ч" for game time, "5 ч 20 мин" for real time.
function duration(minutes: number): string {
  const days = Math.floor(minutes / DAY_MIN);
  const hours = Math.floor((minutes % DAY_MIN) / 60);
  return days > 0 ? `${days} дн. ${hours} ч` : `${hours} ч`;
}

function realDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} ч ${mins % 60} мин` : `${mins} мин`;
}

// Lines of goods made; empty goods are left out. Food comes from fields and fishing: that is the harvest.
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

const Row = ({ icon, label, children }: { icon: IconName; label: string; children: string }) => (
  <li class="away-row">
    <Icon name={icon} size={18} />
    <span class="away-label">{label}</span>
    <span class="away-val">{children}</span>
  </li>
);

// «Пока вас не было»: a progress card while the catch-up runs, then a field-book page about what changed.
export function AwayNotice() {
  const c = catchUp.value;
  if (c) {
    const pct = c.total > 0 ? Math.min(100, Math.floor((c.done / c.total) * 100)) : 0;
    return (
      <Panel class="offline" role="status" aria-label="Пока вас не было">
        <div class="offline-title">Пока вас не было…</div>
        <ProgressBar value={pct / 100} label={`${pct}%`} />
        <div class="offline-line">{pct}%</div>
      </Panel>
    );
  }
  const a = away.value;
  if (!a) return null;
  const goods = produced(a);
  const problems = currentWarnings();
  const people = a.births + a.deaths + a.arrivals + a.departures;
  return (
    <Panel class="away" role="group" aria-label="Пока вас не было">
      <div class="away-head">
        <Icon name="scroll" size={22} />
        <h2>Пока вас не было</h2>
      </div>
      <p class="away-lead">
        Вас не было {realDuration(a.realMs)}, в поселении прошло {duration(a.gameMinutes)}.
      </p>
      <ul class="away-list">
        <Row icon="person" label="Жителей">{`было ${a.popBefore}, стало ${a.popAfter} (${signed(a.popAfter - a.popBefore)})`}</Row>
        {people > 0 && (
          <Row icon="tent" label="Люди">
            {[
              a.births > 0 && `родилось ${a.births}`,
              a.deaths > 0 && `умерло ${a.deaths}`,
              a.arrivals > 0 && `приехало ${a.arrivals}`,
              a.departures > 0 && `уехало ${a.departures}`,
            ]
              .filter(Boolean)
              .join(", ")}
          </Row>
        )}
        <Row icon="craft" label="Построено">{a.built > 0 ? `${a.built} ${plural(a.built, "здание", "здания", "зданий")}` : "ничего нового"}</Row>
        <Row icon="field" label="Сделано">{goods.length > 0 ? goods.join(", ") : "ничего"}</Row>
      </ul>
      {problems.length > 0 && (
        <>
          <h3 class="away-sub">Что беспокоит сейчас</h3>
          <ul class="away-problems">
            {problems.map((w) => (
              <li key={w.id}>
                <Icon name="warning" size={16} />
                {w.text}
              </li>
            ))}
          </ul>
        </>
      )}
      {a.chronicle.length > 0 && (
        <>
          <h3 class="away-sub">Летопись</h3>
          <ul class="away-chronicle">
            {a.chronicle.map((e, i) => (
              <li key={i}>{e.text}</li>
            ))}
          </ul>
        </>
      )}
      <Button variant="primary" onClick={() => (away.value = null)}>
        Продолжить
      </Button>
    </Panel>
  );
}
