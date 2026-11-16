import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { BUILDINGS } from "../sim/buildings";
import { FORMS, GOV, HISTORY_KEYS, TERMS, type Form, type GovView, type HistoryKey, type PersonView, type Term } from "../sim/government";
import { RATIONS, type Levers } from "../sim/levers";
import type { Cmd } from "../sim/protocol";
import { DAY_MIN, YEAR_DAYS } from "../sim/time";
import { gameClock, sendCmd, state } from "../simClient";
import { flash } from "../map/tools";
import { followResident } from "./follow";
import { Icon } from "./Icon";
import { num, plural } from "./InspectorParts";
import { Button, IconButton, Segmented, Tabs, type TabItem } from "./kit";
import { closePanel, openPanel, rightPanel } from "./panels";
import { play, type SoundName } from "./sound";
import { tabId, tabPanelId } from "./tabSemantics";
import { chartOf, effectChips, rowAt, SERIES, type Chip } from "./townhallModel";
import { L } from "../i18n";
import "./market.css";
import "./townhall.css";

// The town hall window, on the market's sheet. «Правление» is split in two: the form of rule on the left (two cards,
// confirmed with «Продолжить»), the head of the town on the right, shut until the form is chosen. «Приказы»: four
// orders as charters on bark, each sealed or cancelled. «Записи»: the census and stock report, the ledger of every
// series beside the chart of the chosen one. The charters and the report lie on moss, like records on the ground.

export type HallTab = "rule" | "orders" | "records";
const tab = signal<HallTab>("rule");
const series = signal<HistoryKey>("pop");

const TABS: TabItem<HallTab>[] = [
  { id: "rule", label: L("Правление", "Rule") },
  { id: "orders", label: L("Приказы", "Orders") },
  { id: "records", label: L("Записи", "Records") },
];

// Is there a finished town hall: the orders and the window open with it.
export const hallReady = (): boolean => Object.values(state.value?.buildings ?? {}).some((b) => b.state === "active" && BUILDINGS[b.template]?.seat);

export function openTownhall(at: HallTab = "rule"): void {
  tab.value = at;
  openPanel("townhall");
  play("page");
}

// A command with its sound: `ok` when it goes through, the error tone and the reason when it does not.
function send(cmd: Cmd, ok: SoundName, then?: () => void): void {
  void sendCmd(cmd).then((r) => {
    if (r.ok) {
      play(ok);
      then?.();
    } else {
      play("error");
      flash(r.reason ?? L("Не удалось", "Failed"));
    }
  });
}

const FORM_INFO: Record<Form, { name: string; lead: string; points: { good: boolean; text: string }[] }> = {
  monarchy: {
    name: L("Монархия", "Monarchy"),
    lead: L("Власть передаётся по наследству.", "Power is inherited."),
    points: [
      { good: true, text: L("Нет выборов и сроков", "No elections and no terms") },
      { good: true, text: L("Власть можно передать ребёнку в любой момент", "Power can pass to a child at any time") },
      { good: false, text: L("Выбор только среди детей главы", "Only the head's children can be chosen") },
    ],
  },
  republic: {
    name: L("Республика", "Republic"),
    lead: L("Главу выбирают на срок.", "The head is chosen for a term."),
    points: [
      { good: true, text: L("На выборах — трое кандидатов", "Three candidates at every election") },
      { good: true, text: L("Короткий срок поднимает настроение", "A short term lifts the mood") },
      { good: false, text: L("Глава на новый срок злит жителей", "A head kept for another term angers the residents") },
    ],
  },
};

const TERM_INFO: Record<Term, string> = { 2: L("Полгода", "Half a year"), 4: L("Год", "A year"), 8: L("Два года", "Two years") };

const days = (min: number) => Math.max(0, Math.ceil(min / DAY_MIN));
const daysText = (n: number) => `${n} ${plural(n, "день", "дня", "дней", "day")}`;
const years = (n: number) => `${n} ${plural(n, "год", "года", "лет", "year")}`;

function Chips({ chips, empty }: { chips: Chip[]; empty?: string }) {
  if (chips.length === 0) return empty ? <span class="th-chip">{empty}</span> : null;
  return (
    <>
      {chips.map((c) => (
        <span key={c.text} class={`th-chip is-${c.tone}`}>
          {c.text}
        </span>
      ))}
    </>
  );
}

// A small drawing of how the form passes power: a line of descent, or three residents with one chosen.
function FormFigure({ form }: { form: Form }) {
  return form === "monarchy" ? (
    <svg class="th-figure" viewBox="0 0 96 64" aria-hidden="true">
      <path d="M48 14 V30 M24 30 H72 M24 30 V44 M48 30 V44 M72 30 V44" />
      <circle cx="48" cy="9" r="6" class="is-held" />
      <circle cx="24" cy="50" r="5" />
      <circle cx="48" cy="50" r="5" />
      <circle cx="72" cy="50" r="5" />
    </svg>
  ) : (
    <svg class="th-figure" viewBox="0 0 96 64" aria-hidden="true">
      <circle cx="20" cy="30" r="6" />
      <circle cx="48" cy="30" r="6" class="is-held" />
      <circle cx="76" cy="30" r="6" />
      <path d="M8 46 H32 M36 46 H60 M64 46 H88" />
      <path d="M40 54 H56" class="is-mark" />
    </svg>
  );
}

function FormCard({ form, on, now, onPick }: { form: Form; on: boolean; now?: boolean; onPick?: () => void }) {
  const info = FORM_INFO[form];
  const body = (
    <>
      <FormFigure form={form} />
      <span class="th-form-text">
        <span class="th-form-name">
          {info.name}
          {now && <span class="th-form-tag">{L("сейчас", "now")}</span>}
        </span>
        <span class="th-form-lead">{info.lead}</span>
        <ul class="th-form-points">
          {info.points.map((p) => (
            <li key={p.text} class={p.good ? "is-ok" : "is-bad"}>
              <Icon name={p.good ? "check" : "close"} size={12} />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </span>
    </>
  );
  return onPick ? (
    <button type="button" role="radio" aria-checked={on} class={on ? "th-form on" : "th-form"} onClick={onPick}>
      {body}
    </button>
  ) : (
    <div class="th-form is-static">{body}</div>
  );
}

// The left half: the two forms as cards, one picked and confirmed; once chosen, the form with its term and a way to
// change it every five years.
function FormSide({ v }: { v: GovView }) {
  const [changing, setChanging] = useState(false);
  const [pick, setPick] = useState<Form | null>(v.settled ? v.form : null);
  const wait = v.formReady - gameClock.value;
  if (v.settled && !changing) {
    const termOptions = TERMS.map((t) => ({ id: t, label: TERM_INFO[t], title: `${TERM_INFO[t]}: ${t} ${L("сез.", "seasons")}${GOV.termMood[t] ? L(`, настроение ${GOV.termMood[t] > 0 ? "+" : "−"}${Math.abs(GOV.termMood[t])}`, `, mood ${GOV.termMood[t] > 0 ? "+" : "−"}${Math.abs(GOV.termMood[t])}`) : ""}` }));
    return (
      <section class="th-side th-form-side" aria-label={L("Форма правления", "Form of rule")}>
        <h3 class="th-h">{L("Форма правления", "Form of rule")}</h3>
        <FormCard form={v.form} on />
        {v.form === "republic" && (
          <div class="th-term">
            <span class="mk-cap">{L("Срок главы", "The head's term")}</span>
            <Segmented options={termOptions} value={v.term} label={L("Срок главы", "The head's term")} onChange={(term) => send({ type: "setTerm", term }, "stamp")} />
          </div>
        )}
        <div class="th-continue">
          <Button
            disabled={wait > 0}
            onClick={() => {
              setPick(v.form);
              setChanging(true);
              play("page");
            }}
          >
            {L("Сменить форму", "Change the form")}
          </Button>
          <span class="mk-note">{wait > 0 ? L(`Сменить можно через ${daysText(days(wait))}`, `Can change in ${daysText(days(wait))}`) : L("Можно сменить сейчас", "Can change now")}</span>
        </div>
      </section>
    );
  }
  const changingTo = v.settled && pick !== null && pick !== v.form;
  return (
    <section class="th-side th-form-side" aria-label={L("Форма правления", "Form of rule")}>
      <h3 class="th-h">{v.settled ? L("Сменить форму правления", "Change the form of rule") : L("Выберите форму правления", "Choose the form of rule")}</h3>
      <div class="th-form-cards" role="radiogroup" aria-label={L("Форма правления", "Form of rule")}>
        {FORMS.map((f) => (
          <FormCard
            key={f}
            form={f}
            on={pick === f}
            now={v.settled && f === v.form}
            onPick={() => {
              setPick(f);
              play("page");
            }}
          />
        ))}
      </div>
      <div class="th-continue">
        <Button variant="primary" disabled={pick === null || (v.settled && !changingTo)} onClick={() => pick && send({ type: "setGovForm", form: pick }, "stamp", () => setChanging(false))}>
          {v.settled ? L("Сменить", "Change") : L("Продолжить", "Continue")}
        </Button>
        {v.settled ? (
          <Button onClick={() => setChanging(false)}>{L("Оставить как есть", "Keep it")}</Button>
        ) : (
          <span class="mk-note">{L("Потом форму можно менять раз в 5 лет", "Afterwards it changes once in 5 years")}</span>
        )}
      </div>
    </section>
  );
}

// One person in a line: name, age, follow, what they would bring, and the action.
function Person({ p, action }: { p: PersonView; action?: { label: string; onClick: () => void } }) {
  return (
    <article class="th-person">
      <header class="th-person-head">
        <b>{p.name}</b>
        <span class="th-dim">{years(p.age)}</span>
        <IconButton icon="locate" size={14} label={`${L("Следить за", "Follow")} ${p.name}`} onClick={() => followResident(p.id, p.name)} />
      </header>
      <ul class="th-parts">
        {p.parts.map((part) => (
          <li key={part.name}>
            <span>{part.name}</span>
            <span class="th-chips">
              <Chips chips={effectChips(part.effect)} />
            </span>
          </li>
        ))}
      </ul>
      {action && (
        <Button variant="primary" class="th-pick" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </article>
  );
}

// The right half: the head and the choice, shut until the form of rule is chosen.
function HeadSide({ v }: { v: GovView }) {
  if (!v.settled)
    return (
      <section class="th-side th-head-side is-shut" aria-label={L("Глава поселения", "Head of the town")}>
        <h3 class="th-h">{L("Глава поселения", "Head of the town")}</h3>
        <div class="th-shut">
          <Icon name="lock" size={22} />
          <p>{L("Сначала выберите форму правления. Потом здесь появится выбор главы.", "Choose the form of rule first. The choice of the head appears here then.")}</p>
        </div>
        <p class="mk-note is-warn">{L("Пока главы нет, жители недовольны, поселением управлять труднее, новые семьи едут неохотно.", "Until there is a head, the residents are unhappy, the town is harder to manage and new families are reluctant to come.")}</p>
      </section>
    );
  const now = gameClock.value;
  const choose = (p: PersonView) => send({ type: "chooseHead", id: p.id }, "proclaim");
  const { kind, people } = v.choice;
  const founding = v.form === "monarchy" && kind === "open";
  return (
    <section class="th-side th-head-side" aria-label={L("Глава поселения", "Head of the town")}>
      <h3 class="th-h">{L("Глава поселения", "Head of the town")}</h3>
      {v.head ? (
        <>
          <Person p={v.head} />
          <p class={v.form === "republic" && v.terms > 1 ? "mk-note is-warn" : "mk-note"}>
            {L("Глава работает писарем в ратуше.", "The head works as a clerk in the town hall.")}{" "}
            {v.form === "republic" && (v.terms > 1 ? L(`Идёт ${v.terms}-й срок подряд: выберите нового главу, чтобы жители успокоились.`, `Term ${v.terms} in a row: choose a new head to calm the residents.`) : L(`Срок кончится через ${daysText(days(v.termEnd - now))}.`, `The term ends in ${daysText(days(v.termEnd - now))}.`))}
          </p>
        </>
      ) : (
        <p class="mk-note is-warn">{L("Главы нет: жители недовольны, поселением управлять труднее, новые семьи едут неохотно.", "No head: the residents are unhappy, the town is harder to manage and new families are reluctant to come.")}</p>
      )}
      {kind !== "none" && (
        <div class="th-choice">
          <h4 class="th-h4">{founding ? L("Основать династию", "Found a dynasty") : kind === "heir" ? L("Наследники", "Heirs") : L("Выборы главы: трое кандидатов", "Election of the head: three candidates")}</h4>
          {kind !== "open" || founding ? (
            <p class="mk-note">
              {founding
                ? L("Выберите, кто начнёт династию. Дальше власть будет переходить к его взрослым детям.", "Choose who founds the dynasty. Power will then pass to their grown children.")
                : v.head
                  ? L("Глава может передать власть одному из взрослых детей.", "The head may hand power to one of their grown children.")
                  : L("Власть переходит к одному из взрослых детей прежнего главы.", "Power passes to one of the late head's grown children.")}
            </p>
          ) : null}
          {people.length === 0 ? (
            <p class="mk-note">{L("Подходящих жителей нет.", "No suitable residents.")}</p>
          ) : (
            <div class="th-people">
              {people.map((p) => (
                <Person key={p.id} p={p} action={{ label: founding ? L("Начать династию", "Found the dynasty") : kind === "heir" ? L("Передать власть", "Hand over power") : L("Выбрать", "Choose"), onClick: () => choose(p) }} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- the orders: charters on bark, sealed or cancelled ----------

interface Order {
  key: string;
  title: string;
  text: string; // what the order says
  effect: Chip[];
  on: (l: Levers) => boolean;
  seal: Cmd;
  cancel: Cmd;
  replaces?: (l: Levers) => string | null; // the order in force that this one takes the place of
}

const ok = (text: string): Chip => ({ text, tone: "ok" });
const bad = (text: string): Chip => ({ text, tone: "bad" });

const ORDERS: Order[] = [
  {
    key: "strada",
    title: L("Указ о долгом дне", "Order of the long day"),
    text: L("Работать с 5 до 21 часа вместо обычных 7–19.", "Work from 5:00 to 21:00 instead of the usual 7:00 to 19:00."),
    effect: [ok(L("труда +33 %", "labour +33%")), bad(L("настроение −8", "mood −8"))],
    on: (l) => l.strada,
    seal: { type: "setSchedule", strada: true },
    cancel: { type: "setSchedule", strada: false },
  },
  {
    key: "school",
    title: L("Указ о школе для взрослых", "Order of school for adults"),
    text: L("Неграмотные взрослые учатся вместо работы, пока не выучатся. В школе 30 мест, сначала дети.", "Illiterate adults study instead of working until they learn. 30 places per school, children first."),
    effect: [ok(L("грамотных больше", "more literate")), bad(L("рук меньше", "fewer hands"))],
    on: (l) => l.adultSchool,
    seal: { type: "setAdultSchool", on: true },
    cancel: { type: "setAdultSchool", on: false },
  },
  {
    key: "reduced",
    title: L("Указ об урезанных нормах", "Order of reduced rations"),
    text: L("Каждый житель получает на четверть меньше еды.", "Every resident gets a quarter less food."),
    effect: [ok(L("еды −25 %", "food −25%")), bad(L(`настроение ${RATIONS.reduced.mood}`, `mood ${RATIONS.reduced.mood}`))],
    on: (l) => l.rations === "reduced",
    seal: { type: "setRations", rations: "reduced" },
    cancel: { type: "setRations", rations: "normal" },
    replaces: (l) => (l.rations === "generous" ? L("Заменит указ о сытных нормах", "Replaces the order of generous rations") : null),
  },
  {
    key: "generous",
    title: L("Указ о сытных нормах", "Order of generous rations"),
    text: L("Каждый житель получает на четверть больше еды.", "Every resident gets a quarter more food."),
    effect: [ok(L(`настроение +${RATIONS.generous.mood}`, `mood +${RATIONS.generous.mood}`)), bad(L("еды +25 %", "food +25%"))],
    on: (l) => l.rations === "generous",
    seal: { type: "setRations", rations: "generous" },
    cancel: { type: "setRations", rations: "normal" },
    replaces: (l) => (l.rations === "reduced" ? L("Заменит указ об урезанных нормах", "Replaces the order of reduced rations") : null),
  },
];

const TILTS = [-0.8, 0.6, -0.4, 0.7];

// One charter. With a mouse the whole sheet is the control: pointing at it shows a pale seal where the seal will go,
// or, on a sealed one, the seal struck through; a click seals it or lifts the seal. A touch screen has no pointing,
// so it keeps a plain button at the foot (the CSS shows one or the other).
function Charter({ o, lv, signed, tilt }: { o: Order; lv: Levers; signed: string | null; tilt: number }) {
  const on = o.on(lv);
  const note = !on && o.replaces?.(lv);
  const act = () => (on ? send(o.cancel, "page") : send(o.seal, "stamp"));
  const label = on ? L(`Снять печать: ${o.title}`, `Lift the seal: ${o.title}`) : L(`Поставить печать: ${o.title}`, `Seal: ${o.title}`);
  return (
    <article class={on ? "th-charter is-on" : "th-charter"} style={{ "--tilt": `${tilt}deg` }}>
      <h3 class="th-charter-title">{o.title}</h3>
      <p class="th-charter-text">{o.text}</p>
      <span class="th-chips">
        <Chips chips={o.effect} />
      </span>
      <footer class="th-charter-foot">
        <span class="th-sign">{on ? (signed ? L(`Подписал ${signed}`, `Signed by ${signed}`) : L("Издан без главы", "Issued without a head")) : note || L("Не издан", "Not issued")}</span>
        <span class="th-hint" aria-hidden="true">
          {on ? L("Нажмите, чтобы снять печать", "Click to lift the seal") : L("Нажмите, чтобы поставить печать", "Click to seal")}
        </span>
        <Button class="th-touch" variant={on ? "default" : "primary"} onClick={act}>
          {on ? L("Отменить указ", "Cancel the order") : L("Поставить печать", "Seal it")}
        </Button>
      </footer>
      {on ? (
        <span key="seal" class="th-seal" aria-hidden="true">
          {L("В СИЛЕ", "IN FORCE")}
          <span class="th-strike" />
        </span>
      ) : (
        <span key="ghost" class="th-seal is-ghost" aria-hidden="true">
          {L("В СИЛЕ", "IN FORCE")}
        </span>
      )}
      <button type="button" class="th-hit" aria-label={label} aria-pressed={on} onClick={act} />
    </article>
  );
}

function OrdersTab({ v }: { v: GovView }) {
  const lv = state.value?.levers;
  if (!lv) return null;
  return (
    <div class="th-desk th-charters" role="group" aria-label={L("Приказы", "Orders")}>
      {ORDERS.map((o, i) => (
        <Charter key={o.key} o={o} lv={lv} signed={v.head?.name ?? null} tilt={TILTS[i]} />
      ))}
    </div>
  );
}

// ---------- the records: the census and stock report ----------

const W = 600;
const H = 200;

function RecordsTab() {
  const rows = state.value?.history ?? [];
  const key = series.value;
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0)
    return (
      <div class="th-desk">
        <article class="th-report">
          <h3 class="th-report-title">{L("Перепись и учёт", "Census and stock report")}</h3>
          <p class="mk-note">{L("Записи начнутся в первую полночь после открытия ратуши.", "The records start at the first midnight after the town hall opens.")}</p>
        </article>
      </div>
    );
  const charts = Object.fromEntries(HISTORY_KEYS.map((k) => [k, chartOf(rows, k, W, H)!])) as Record<HistoryKey, NonNullable<ReturnType<typeof chartOf>>>;
  const c = charts[key];
  const s = SERIES[key];
  const at = hover !== null ? rowAt(rows, hover, W) : null;
  const first = rows[0].day;
  const span = Math.max(1, rows[rows.length - 1].day - first);
  const cursorX = at ? ((at.day - first) / span) * W : 0;
  const yearOf = (day: number) => Math.floor(day / YEAR_DAYS) + 1;
  const lo = Math.min(0, c.min);
  const hi = c.max > lo ? c.max : lo + 1;
  const levels = [0, 1 / 3, 2 / 3, 1].map((f) => ({ y: H - f * H, v: lo + f * (hi - lo) }));
  const change = (k: HistoryKey) => {
    const ch = charts[k];
    if (ch.yearAgo === null) return "—";
    const d = ch.last - ch.yearAgo;
    return d === 0 ? "0" : `${d > 0 ? "+" : "−"}${num(Math.abs(d))}`;
  };
  return (
    <div class="th-desk">
      <article class="th-report">
        <header class="th-report-head">
          <h3 class="th-report-title">{L("Перепись и учёт", "Census and stock report")}</h3>
          <span class="th-dim">
            {L(`с ${yearOf(first)}-го года по ${yearOf(rows[rows.length - 1].day)}-й · записей ${rows.length}`, `year ${yearOf(first)} to year ${yearOf(rows[rows.length - 1].day)} · ${rows.length} entries`)}
          </span>
        </header>
        <div class="th-report-body">
          <table class="th-ledger">
            <thead>
              <tr>
                <th scope="col">{L("Что учтено", "Entry")}</th>
                <th scope="col">{L("Сейчас", "Now")}</th>
                <th scope="col">{L("За год", "A year")}</th>
                <th scope="col">{L("Мин. / макс.", "Low / high")}</th>
              </tr>
            </thead>
            <tbody>
              {HISTORY_KEYS.map((k) => (
                <tr key={k} class={k === key ? "on" : ""}>
                  <th scope="row">
                    <button
                      type="button"
                      aria-pressed={k === key}
                      onClick={() => {
                        series.value = k;
                        play("page");
                      }}
                    >
                      {SERIES[k].label}
                    </button>
                  </th>
                  <td>
                    {num(charts[k].last)} <small>{SERIES[k].unit}</small>
                  </td>
                  <td>{change(k)}</td>
                  <td>
                    {num(charts[k].min)} / {num(charts[k].max)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <figure class="th-chart">
            <figcaption class="th-chart-title">
              {s.label}, {s.unit}
            </figcaption>
            <div class="th-plot">
              {levels.map((l) => (
                <span key={l.y} class="th-y" style={{ top: `${(l.y / H) * 100}%` }}>
                  {num(Math.round(l.v * 10) / 10)}
                </span>
              ))}
              <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${s.label}: ${L("с", "from")} ${num(rows[0][key])} ${L("до", "to")} ${num(c.last)} ${s.unit}`}
                onPointerMove={(e) => {
                  const r = (e.currentTarget as SVGElement).getBoundingClientRect();
                  setHover(((e.clientX - r.left) / r.width) * W);
                }}
                onPointerLeave={() => setHover(null)}
              >
                {levels.map((l) => (
                  <line key={l.y} class="th-level" x1={0} x2={W} y1={l.y} y2={l.y} />
                ))}
                <path class="th-area" d={c.area} />
                <path class="th-line" d={c.line} />
                {at && <line class="th-cursor" x1={cursorX} x2={cursorX} y1={0} y2={H} />}
              </svg>
              <div class="th-x">
                {c.years.map((y) => (
                  <span key={y.year} class={y.x > W * 0.86 ? "is-end" : undefined} style={{ left: `${(y.x / W) * 100}%` }}>
                    {L(`${y.year}-й год`, `Year ${y.year}`)}
                  </span>
                ))}
              </div>
            </div>
            <p class="th-readout" aria-live="polite">
              {at ? `${L("Год", "Year")} ${yearOf(at.day)}, ${L("день", "day")} ${(at.day % YEAR_DAYS) + 1}: ${num(at[key])} ${s.unit}` : L("Наведите на график, чтобы увидеть запись дня", "Point at the chart to see a day's entry")}
            </p>
          </figure>
        </div>
        <footer class="th-report-foot">
          <span>{L("Записи ведёт писарь ратуши каждую полночь", "The town hall's clerk writes the records every midnight")}</span>
          <span class="th-seal is-flat">{L("РАТУША", "TOWN HALL")}</span>
        </footer>
      </article>
    </div>
  );
}

export function TownhallPanel() {
  const st = state.value;
  if (rightPanel.value !== "townhall" || !st) return null;
  const v = st.govView;
  const sub = !v ? L("Ратуша ещё не построена", "The town hall is not built yet") : !v.settled ? L("форма правления не выбрана", "no form of rule chosen") : `${FORM_INFO[v.form].name} · ${v.head ? `${L("глава", "head")} ${v.head.name}` : L("главы нет", "no head")}`;
  return (
    <div class="mk-screen" role="dialog" aria-modal="false" aria-label={L("Ратуша", "Town hall")}>
      <div class="mk-sheet th-sheet">
        <header class="mk-head">
          <Icon name="townhall" size={28} />
          <div class="mk-title-block">
            <h2 class="mk-title">{L("Ратуша", "Town hall")}</h2>
            <span class="mk-sub">{sub}</span>
          </div>
          <IconButton icon="close" size={18} label={L("Закрыть", "Close")} onClick={closePanel} />
        </header>
        <Tabs
          tabs={TABS}
          active={tab.value}
          onChange={(id) => {
            tab.value = id;
            play("page");
          }}
          label={L("Разделы ратуши", "Town hall sections")}
          class="th-tabs"
          idPrefix="hall"
        />
        <div class={`mk-body th-body is-${tab.value}`} role="tabpanel" id={tabPanelId("hall", tab.value)} aria-labelledby={tabId("hall", tab.value)}>
          {!v ? (
            <p class="mk-note">{L("Постройте ратушу: из неё отдают приказы и выбирают главу поселения.", "Build a town hall: orders are given and the head of the town is chosen there.")}</p>
          ) : tab.value === "rule" ? (
            <div class="th-rule">
              <FormSide key={String(v.settled)} v={v} />
              <HeadSide v={v} />
            </div>
          ) : tab.value === "orders" ? (
            <OrdersTab v={v} />
          ) : (
            <RecordsTab />
          )}
        </div>
        {v && (
          <footer class="mk-foot th-foot">
            <span class="mk-cap">{L("Влияние на поселение", "Effect on the town")}</span>
            <span class="th-chips">
              <Chips chips={effectChips(v.effect)} empty={L("нет", "none")} />
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}
