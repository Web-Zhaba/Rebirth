import { goodsTotal } from "../sim/goods";
import type { Away } from "../sim/protocol";
import { DAY_MIN } from "../sim/time";
import { away, catchUp } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { Button, Panel, ProgressBar } from "./kit";
import { currentWarnings } from "./TopBar";
import { SuppliesOffer } from "./SuppliesOffer";
import "./journal.css";
import { L, plural } from "../i18n";

const NUM = new Intl.NumberFormat(L("ru-RU", "en-US"), { maximumFractionDigits: 1 });
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

// "3 дн. 4 ч" for game time, "5 ч 20 мин" for real time.
function duration(minutes: number): string {
  const days = Math.floor(minutes / DAY_MIN);
  const hours = Math.floor((minutes % DAY_MIN) / 60);
  return days > 0 ? `${days} ${L("дн.", "d")} ${hours} ${L("ч", "h")}` : `${hours} ${L("ч", "h")}`;
}

function realDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  return h > 0 ? `${h} ${L("ч", "h")} ${mins % 60} ${L("мин", "min")}` : `${mins} ${L("мин", "min")}`;
}

// Lines of goods made; empty goods are left out. Food comes from fields and fishing: that is the harvest.
function produced(a: Away): string[] {
  const p = a.produced;
  const out: string[] = [];
  if (p.food >= 1) out.push(L(`еда ${NUM.format(p.food / 1000)} т`, `food ${NUM.format(p.food / 1000)} t`));
  if (p.logs >= 0.05) out.push(L(`брёвна ${NUM.format(p.logs)} м³`, `logs ${NUM.format(p.logs)} m³`));
  if (p.planks >= 0.05) out.push(L(`доски ${NUM.format(p.planks)} м³`, `planks ${NUM.format(p.planks)} m³`));
  if (p.stone >= 0.05) out.push(L(`камень ${NUM.format(p.stone)} т`, `stone ${NUM.format(p.stone)} t`));
  const goods = goodsTotal(p);
  if (goods >= 0.5) out.push(L(`товары ${Math.round(goods)} шт.`, `goods ${Math.round(goods)} pcs`));
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
      <Panel class="offline" role="status" aria-label={L("Пока вас не было", "While you were away")}>
        <div class="offline-title">{L("Пока вас не было…", "While you were away…")}</div>
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
    <Panel class="away" role="group" aria-label={L("Пока вас не было", "While you were away")}>
      <div class="away-head">
        <Icon name="scroll" size={22} />
        <h2>{L("Пока вас не было", "While you were away")}</h2>
      </div>
      <p class="away-lead">
        {L(`Вас не было ${realDuration(a.realMs)}, в поселении прошло ${duration(a.gameMinutes)}.`, `You were away for ${realDuration(a.realMs)}; ${duration(a.gameMinutes)} passed in the settlement.`)}
      </p>
      <ul class="away-list">
        <Row icon="person" label={L("Жителей", "Residents")}>{L(`было ${a.popBefore}, стало ${a.popAfter}`, `were ${a.popBefore}, now ${a.popAfter}`) + ` (${signed(a.popAfter - a.popBefore)})`}</Row>
        {people > 0 && (
          <Row icon="tent" label={L("Люди", "People")}>
            {[
              a.births > 0 && L(`родилось ${a.births}`, `${a.births} born`),
              a.deaths > 0 && L(`умерло ${a.deaths}`, `${a.deaths} died`),
              a.arrivals > 0 && L(`приехало ${a.arrivals}`, `${a.arrivals} arrived`),
              a.departures > 0 && L(`уехало ${a.departures}`, `${a.departures} left`),
            ]
              .filter(Boolean)
              .join(", ")}
          </Row>
        )}
        <Row icon="craft" label={L("Построено", "Built")}>{a.built > 0 ? `${a.built} ${plural(a.built, "здание", "здания", "зданий", "building")}` : L("ничего нового", "nothing new")}</Row>
        {a.researched?.length > 0 && <Row icon="scroll" label={L("Изучено", "Researched")}>{a.researched.join(", ")}</Row>}
        <Row icon="field" label={L("Сделано", "Made")}>{goods.length > 0 ? goods.join(", ") : L("ничего", "nothing")}</Row>
      </ul>
      {problems.length > 0 && (
        <>
          <h3 class="away-sub">{L("Что беспокоит сейчас", "Current concerns")}</h3>
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
        <details class="away-events">
          <summary>
            {L("Хроника", "Chronicle")} <span class="away-events-count">{a.chronicle.length}</span>
          </summary>
          <ul class="away-chronicle">
            {a.chronicle.map((e, i) => (
              <li key={i}>{e.text}</li>
            ))}
          </ul>
        </details>
      )}
      <SuppliesOffer />
      <Button variant="primary" onClick={() => (away.value = null)}>
        {L("Продолжить", "Continue")}
      </Button>
    </Panel>
  );
}
