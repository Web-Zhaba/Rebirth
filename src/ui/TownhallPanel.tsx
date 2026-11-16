import { signal } from "@preact/signals";
import { useState } from "preact/hooks";
import { BUILDINGS } from "../sim/buildings";
import { FORMS, GOV, HISTORY_KEYS, TERMS, type Form, type GovView, type HistoryKey, type PersonView, type Term } from "../sim/government";
import { RATIONS, type Rations } from "../sim/levers";
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

// The town hall window, on the market's sheet. «Правление»: first the form of rule, chosen on two cards and confirmed,
// then the head (the founder of a dynasty, an heir, or one of three candidates). «Приказы»: the orders as charters on
// bark, each sealed while it departs from the usual. «Записи»: the census and stock report, a ruled sheet with the
// figures of every series and the chart of the one chosen. The charters and the report lie on moss, like records on
// the ground.

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
      { good: true, text: L("Нет выборов и сроков: глава правит, пока жив", "No elections and no terms: the head rules for life") },
      { good: true, text: L("Власть можно передать взрослому ребёнку в любой момент", "Power can pass to a grown child at any time") },
      { good: false, text: L("Выбирать можно только среди детей главы", "Only the head's children can be chosen") },
      { good: false, text: L("Неудачного главу не сменить, пока нет наследника", "A poor head stays until there is an heir") },
    ],
  },
  republic: {
    name: L("Республика", "Republic"),
    lead: L("Главу выбирают на срок.", "The head is chosen for a term."),
    points: [
      { good: true, text: L("Выбор из трёх жителей на каждых выборах", "A choice of three residents at every election") },
      { good: true, text: L("Короткий срок поднимает настроение", "A short term lifts the mood") },
      { good: false, text: L("Выборы только в конце срока", "Elections only at the end of a term") },
      { good: false, text: L("Глава, оставшийся на новый срок, злит жителей", "A head kept for another term angers the residents") },
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

// The two forms as cards: one is picked, then confirmed with «Продолжить».
function FormCards({ current, settled, ready, onDone }: { current: Form; settled: boolean; ready: number; onDone: () => void }) {
  const [pick, setPick] = useState<Form | null>(settled ? current : null);
  const wait = settled ? ready - gameClock.value : 0;
  const changing = settled && pick !== null && pick !== current;
  return (
    <section class="th-forms" aria-label={L("Форма правления", "Form of rule")}>
      <h3 class="th-h">{settled ? L("Сменить форму правления", "Change the form of rule") : L("Как будет управляться поселение?", "How will the town be ruled?")}</h3>
      <div class="th-form-cards" role="radiogroup" aria-label={L("Форма правления", "Form of rule")}>
        {FORMS.map((f) => {
          const info = FORM_INFO[f];
          const on = pick === f;
          return (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={on}
              class={on ? "th-form on" : "th-form"}
              onClick={() => {
                setPick(f);
                play("page");
              }}
            >
              <FormFigure form={f} />
              <span class="th-form-name">{info.name}</span>
              <span class="th-form-lead">{info.lead}</span>
              <ul class="th-form-points">
                {info.points.map((p) => (
                  <li key={p.text} class={p.good ? "is-ok" : "is-bad"}>
                    <Icon name={p.good ? "check" : "close"} size={12} />
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
              {settled && f === current && <span class="th-form-tag">{L("сейчас", "now")}</span>}
            </button>
          );
        })}
      </div>
      <div class="th-continue">
        <Button variant="primary" disabled={pick === null || (settled && (!changing || wait > 0))} onClick={() => pick && send({ type: "setGovForm", form: pick }, "stamp", onDone)}>
          {settled ? L("Сменить форму", "Change the form") : L("Продолжить", "Continue")}
        </Button>
        {settled && <Button onClick={onDone}>{L("Оставить как есть", "Keep it as it is")}</Button>}
        <span class="mk-note">
          {settled && wait > 0
            ? L(`Сменить можно через ${daysText(days(wait))}`, `Can change in ${daysText(days(wait))}`)
            : L("Потом форму можно будет менять не чаще раза в 5 лет", "After that the form changes at most once in 5 years")}
        </span>
      </div>
    </section>
  );
}

// One person: name, age, follow; then what they would bring, trait by trait.
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

function RuleTab({ v }: { v: GovView }) {
  const [changing, setChanging] = useState(false);
  if (!v.settled || changing) return <FormCards current={v.form} settled={v.settled} ready={v.formReady} onDone={() => setChanging(false)} />;
  const now = gameClock.value;
  const termOptions = TERMS.map((t) => ({ id: t, label: TERM_INFO[t], title: `${TERM_INFO[t]}: ${t} ${L("сез.", "seasons")}${GOV.termMood[t] ? L(`, настроение ${GOV.termMood[t] > 0 ? "+" : "−"}${Math.abs(GOV.termMood[t])}`, `, mood ${GOV.termMood[t] > 0 ? "+" : "−"}${Math.abs(GOV.termMood[t])}`) : ""}` }));
  const choose = (p: PersonView) => send({ type: "chooseHead", id: p.id }, "proclaim");
  const { kind, people } = v.choice;
  const founding = v.form === "monarchy" && kind === "open";
  return (
    <div class="th-rule">
      <section class="th-block th-form-now" aria-label={L("Форма правления", "Form of rule")}>
        <FormFigure form={v.form} />
        <div>
          <h3 class="th-h">{FORM_INFO[v.form].name}</h3>
          <p class="mk-note">{FORM_INFO[v.form].lead}</p>
        </div>
        <Button onClick={() => setChanging(true)}>{L("Сменить", "Change")}</Button>
        {v.form === "republic" && (
          <div class="th-term">
            <span class="mk-cap">{L("Срок главы", "The head's term")}</span>
            <Segmented options={termOptions} value={v.term} label={L("Срок главы", "The head's term")} onChange={(term) => send({ type: "setTerm", term }, "stamp")} />
          </div>
        )}
      </section>
      <section class="th-block" aria-label={L("Глава поселения", "Head of the town")}>
        <h3 class="th-h">{L("Глава поселения", "Head of the town")}</h3>
        {v.head ? (
          <>
            <Person p={v.head} />
            <p class="mk-note">{L("Глава работает писарем в ратуше и занимает одно из её мест.", "The head works as a clerk in the town hall and takes one of its places.")}</p>
            {v.form === "republic" && (
              <p class={v.terms > 1 ? "mk-note is-warn" : "mk-note"}>
                {v.terms > 1 ? L(`Идёт ${v.terms}-й срок подряд: выберите нового главу, чтобы жители успокоились.`, `Term ${v.terms} in a row: choose a new head to calm the residents.`) : L(`Срок кончится через ${daysText(days(v.termEnd - now))}.`, `The term ends in ${daysText(days(v.termEnd - now))}.`)}
              </p>
            )}
          </>
        ) : (
          <p class="mk-note is-warn">{L("Главы нет: жители недовольны, поселением управлять труднее, новые семьи едут неохотно.", "No head: the residents are unhappy, the town is harder to manage and new families are reluctant to come.")}</p>
        )}
      </section>
      {kind !== "none" && (
        <section class="th-block th-choice" aria-label={founding ? L("Основать династию", "Found a dynasty") : kind === "heir" ? L("Наследники", "Heirs") : L("Выборы", "Election")}>
          <h3 class="th-h">{founding ? L("Основать династию", "Found a dynasty") : kind === "heir" ? L("Наследники", "Heirs") : L("Выборы главы", "Election of the head")}</h3>
          <p class="mk-note">
            {founding
              ? L("Выберите, кто начнёт династию. Дальше власть будет переходить к его взрослым детям.", "Choose who founds the dynasty. Power will then pass to their grown children.")
              : kind === "heir"
                ? v.head
                  ? L("Глава может передать власть одному из взрослых детей.", "The head may hand power to one of their grown children.")
                  : L("Власть переходит к одному из взрослых детей прежнего главы.", "Power passes to one of the late head's grown children.")
                : L("Выберите главу из трёх жителей.", "Choose the head out of three residents.")}
          </p>
          {people.length === 0 ? (
            <p class="mk-note">{L("Подходящих жителей нет.", "No suitable residents.")}</p>
          ) : (
            <div class="th-people">
              {people.map((p) => (
                <Person key={p.id} p={p} action={{ label: founding ? L("Начать династию", "Found the dynasty") : kind === "heir" ? L("Передать власть", "Hand over power") : L("Выбрать главой", "Choose as head"), onClick: () => choose(p) }} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ---------- the orders: charters on bark ----------

interface Clause<T> {
  id: T;
  text: string;
  note?: string;
}

// One charter: its title and purpose, the clauses to choose from, the head's signature, and a seal while the order
// departs from the usual.
function Charter<T extends string | number | boolean>({ title, purpose, clauses, value, usual, onPick, signed, tilt }: { title: string; purpose: string; clauses: Clause<T>[]; value: T; usual: T; onPick: (v: T) => void; signed: string | null; tilt: number }) {
  return (
    <article class="th-charter" style={{ "--tilt": `${tilt}deg` }}>
      <h3 class="th-charter-title">{title}</h3>
      <p class="th-charter-purpose">{purpose}</p>
      <div class="th-clauses" role="radiogroup" aria-label={title}>
        {clauses.map((c) => (
          <button key={String(c.id)} type="button" role="radio" aria-checked={c.id === value} class={c.id === value ? "th-clause on" : "th-clause"} onClick={() => c.id !== value && onPick(c.id)}>
            <span class="th-tick" aria-hidden="true" />
            <span class="th-clause-text">
              {c.text}
              {c.note && <small>{c.note}</small>}
            </span>
          </button>
        ))}
      </div>
      <footer class="th-sign">
        <span>{signed ? L(`Подписал ${signed}`, `Signed by ${signed}`) : L("Без подписи главы", "Not signed by a head")}</span>
      </footer>
      {value !== usual && (
        <span class="th-seal" aria-label={L("Указ в силе", "The order is in force")}>
          {L("В СИЛЕ", "IN FORCE")}
        </span>
      )}
    </article>
  );
}

const RATION_IDS: Rations[] = ["reduced", "normal", "generous"];
const signedPct = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v)}`;

function OrdersTab({ v }: { v: GovView }) {
  const lv = state.value?.levers;
  if (!lv) return null;
  const signed = v.head?.name ?? null;
  return (
    <div class="th-desk th-charters" role="group" aria-label={L("Приказы", "Orders")}>
      <Charter
        title={L("Указ о рабочем дне", "Order on the workday")}
        purpose={L("Сколько часов в день работает поселение.", "How many hours a day the town works.")}
        value={lv.strada}
        usual={false}
        signed={signed}
        tilt={-0.8}
        clauses={[
          { id: false, text: L("Обычный день: с 7 до 19", "Normal day: 7:00 to 19:00") },
          { id: true, text: L("Долгий день: с 5 до 21", "Long day: 5:00 to 21:00"), note: L("труда на треть больше, настроение −8", "a third more labour, mood −8") },
        ]}
        onPick={(strada) => send({ type: "setSchedule", strada }, "stamp")}
      />
      <Charter
        title={L("Указ о школе", "Order on the school")}
        purpose={L("Кто ходит в школу, пока в ней есть места: 30 на школу, сначала дети.", "Who goes to school while it has places: 30 per school, children first.")}
        value={lv.adultSchool}
        usual={false}
        signed={signed}
        tilt={0.6}
        clauses={[
          { id: false, text: L("Учатся только дети", "Only children study") },
          { id: true, text: L("Неграмотные взрослые учатся вместо работы", "Illiterate adults study instead of working"), note: L("пока не выучатся", "until they learn") },
        ]}
        onPick={(on) => send({ type: "setAdultSchool", on }, "stamp")}
      />
      <Charter
        title={L("Указ о нормах еды", "Order on rations")}
        purpose={L("Сколько еды получает каждый житель в день.", "How much food each resident gets a day.")}
        value={lv.rations}
        usual="normal"
        signed={signed}
        tilt={-0.4}
        clauses={RATION_IDS.map((id) => ({ id, text: RATIONS[id].name, note: id === "normal" ? undefined : L(`еды ${id === "reduced" ? "−25" : "+25"} %, настроение ${signedPct(RATIONS[id].mood)}`, `food ${id === "reduced" ? "−25" : "+25"}%, mood ${signedPct(RATIONS[id].mood)}`) }))}
        onPick={(rations) => send({ type: "setRations", rations }, "stamp")}
      />
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
        <table class="th-ledger">
          <thead>
            <tr>
              <th scope="col">{L("Что учтено", "Entry")}</th>
              <th scope="col">{L("Сейчас", "Now")}</th>
              <th scope="col">{L("За год", "Over a year")}</th>
              <th scope="col">{L("Меньше / больше", "Low / high")}</th>
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
                <span key={y.year} style={{ left: `${(y.x / W) * 100}%` }}>
                  {L(`${y.year}-й год`, `Year ${y.year}`)}
                </span>
              ))}
            </div>
          </div>
          <p class="th-readout" aria-live="polite">
            {at ? `${L("Год", "Year")} ${yearOf(at.day)}, ${L("день", "day")} ${(at.day % YEAR_DAYS) + 1}: ${num(at[key])} ${s.unit}` : L("Наведите на график, чтобы увидеть запись дня", "Point at the chart to see a day's entry")}
          </p>
        </figure>
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
          {!v ? <p class="mk-note">{L("Постройте ратушу: из неё отдают приказы и выбирают главу поселения.", "Build a town hall: orders are given and the head of the town is chosen there.")}</p> : tab.value === "rule" ? <RuleTab v={v} /> : tab.value === "orders" ? <OrdersTab v={v} /> : <RecordsTab />}
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
