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

// The town hall window, laid out like the market's: a sheet with the head of the town and the form of rule, the
// orders (closed until the town hall stands) and the town's records as a chart from the hall's first day on.

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
function send(cmd: Cmd, ok: SoundName): void {
  void sendCmd(cmd).then((r) => {
    if (r.ok) play(ok);
    else {
      play("error");
      flash(r.reason ?? L("Не удалось", "Failed"));
    }
  });
}

const FORM_INFO: Record<Form, { name: string; text: string }> = {
  monarchy: { name: L("Монархия", "Monarchy"), text: L("Власть передаётся по наследству: главой становится один из взрослых детей главы. Выборов и сроков нет, но выбирать можно только среди наследников.", "Power is inherited: one of the head's grown children becomes the head. No elections and no terms, but only the heirs can be chosen.") },
  republic: { name: L("Республика", "Republic"), text: L("Главу выбирают из трёх жителей на срок. Когда срок кончается, глава остаётся на следующий, пока не выбран новый, и жители этим недовольны.", "The head is chosen out of three residents for a term. When it ends the head stays for another until a new one is chosen, and the residents dislike it.") },
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

// One person: name, age, follow; then what they would bring, trait by trait.
function Person({ p, action }: { p: PersonView; action?: { label: string; onClick: () => void } }) {
  return (
    <article class="th-person">
      <header class="th-person-head">
        <b>{p.name}</b>
        <span class="mk-dim">{years(p.age)}</span>
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
  const now = gameClock.value;
  const wait = v.formReady - now;
  const formOptions = FORMS.map((f) => ({ id: f, label: FORM_INFO[f].name, title: FORM_INFO[f].name, disabled: f !== v.form && wait > 0 }));
  const termOptions = TERMS.map((t) => ({ id: t, label: TERM_INFO[t], title: `${TERM_INFO[t]}: ${t} ${L("сез.", "seasons")}${GOV.termMood[t] ? L(`, настроение ${GOV.termMood[t] > 0 ? "+" : "−"}${Math.abs(GOV.termMood[t])}`, `, mood ${GOV.termMood[t] > 0 ? "+" : "−"}${Math.abs(GOV.termMood[t])}`) : ""}` }));
  const choose = (p: PersonView) => send({ type: "chooseHead", id: p.id }, "proclaim");
  const { kind, people } = v.choice;
  return (
    <div class="th-rule">
      <section class="th-block" aria-label={L("Форма правления", "Form of rule")}>
        <span class="mk-cap">{L("Форма правления", "Form of rule")}</span>
        <Segmented options={formOptions} value={v.form} label={L("Форма правления", "Form of rule")} onChange={(form) => send({ type: "setGovForm", form }, "stamp")} />
        <p class="mk-note">{FORM_INFO[v.form].text}</p>
        {wait > 0 && <p class="mk-note">{L(`Сменить форму можно через ${daysText(days(wait))}`, `The form can change in ${daysText(days(wait))}`)}</p>}
        {v.form === "republic" && (
          <>
            <span class="mk-cap">{L("Срок главы", "The head's term")}</span>
            <Segmented options={termOptions} value={v.term} label={L("Срок главы", "The head's term")} onChange={(term) => send({ type: "setTerm", term }, "stamp")} />
            <p class="mk-note">{L("Короткий срок жителям нравится, длинный — нет. Выборы бывают только в конце срока.", "The residents like a short term and dislike a long one. Elections come only at the end of a term.")}</p>
          </>
        )}
      </section>
      <section class="th-block" aria-label={L("Глава поселения", "Head of the town")}>
        <span class="mk-cap">{L("Глава поселения", "Head of the town")}</span>
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
        <section class="th-block th-choice" aria-label={kind === "heir" ? L("Наследники", "Heirs") : L("Кандидаты", "Candidates")}>
          <span class="mk-cap">{kind === "heir" ? L("Наследники", "Heirs") : v.form === "monarchy" ? L("Кто начнёт династию", "Who founds the dynasty") : L("Кандидаты", "Candidates")}</span>
          {kind === "heir" && v.head && <p class="mk-note">{L("Глава может передать власть одному из взрослых детей.", "The head may hand power to one of their grown children.")}</p>}
          {people.length === 0 ? (
            <p class="mk-note">{L("Подходящих жителей нет.", "No suitable residents.")}</p>
          ) : (
            <div class="th-people">
              {people.map((p) => (
                <Person key={p.id} p={p} action={{ label: kind === "heir" ? L("Передать власть", "Hand over power") : L("Выбрать главой", "Choose as head"), onClick: () => choose(p) }} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const RATION_IDS: Rations[] = ["reduced", "normal", "generous"];

function OrdersTab() {
  const lv = state.value?.levers;
  if (!lv) return null;
  return (
    <div class="th-orders" role="group" aria-label={L("Приказы", "Orders")}>
      <section class="th-block">
        <span class="mk-cap">{L("Рабочий день", "Workday")}</span>
        <Button
          aria-pressed={lv.strada}
          variant={lv.strada ? "primary" : "default"}
          title={L("Работа с 05 до 21 часа: на треть больше труда, но настроение ниже на 8", "Work from 05:00 to 21:00: a third more labour, but mood is 8 lower")}
          onClick={() => send({ type: "setSchedule", strada: !lv.strada }, "stamp")}
        >
          {lv.strada ? L("Долгий день: до 21:00", "Long day: until 21:00") : L("Обычный день: 07–19", "Normal day: 07–19")}
        </Button>
        <p class="mk-note">{L("Долгий день: работают с 5 до 21 часа, труда на треть больше, настроение ниже на 8.", "Long day: work from 5:00 to 21:00, a third more labour, mood 8 lower.")}</p>
      </section>
      <section class="th-block">
        <span class="mk-cap">{L("Школа", "School")}</span>
        <Button aria-pressed={lv.adultSchool} variant={lv.adultSchool ? "primary" : "default"} onClick={() => send({ type: "setAdultSchool", on: !lv.adultSchool }, "stamp")}>
          {lv.adultSchool ? L("Взрослые учатся", "Adults study") : L("Взрослые работают", "Adults work")}
        </Button>
        <p class="mk-note">{L("Неграмотные взрослые ходят в школу вместо работы, пока не выучатся. Мест 30 на школу, сначала дети.", "Illiterate adults go to school instead of work until they learn. 30 places per school, children first.")}</p>
      </section>
      <section class="th-block">
        <span class="mk-cap">{L("Нормы еды", "Rations")}</span>
        <Segmented
          options={RATION_IDS.map((id) => ({ id, label: RATIONS[id].name, title: `${RATIONS[id].name}: ${L("еда", "food")} ${RATIONS[id].food * 100 - 100 > 0 ? "+" : ""}${Math.round(RATIONS[id].food * 100 - 100)} %, ${L("настроение", "mood")} ${RATIONS[id].mood > 0 ? "+" : ""}${RATIONS[id].mood}` }))}
          value={lv.rations}
          label={L("Нормы еды", "Rations")}
          onChange={(rations) => send({ type: "setRations", rations }, "stamp")}
        />
        <p class="mk-note">{L(`Урезанные: еды −25 %, настроение ${RATIONS.reduced.mood}. Сытные: еды +25 %, настроение +${RATIONS.generous.mood}.`, `Reduced: food −25%, mood ${RATIONS.reduced.mood}. Generous: food +25%, mood +${RATIONS.generous.mood}.`)}</p>
      </section>
    </div>
  );
}

const W = 600;
const H = 200;

function RecordsTab() {
  const rows = state.value?.history ?? [];
  const key = series.value;
  const [hover, setHover] = useState<number | null>(null);
  const c = chartOf(rows, key, W, H);
  const s = SERIES[key];
  const at = hover !== null ? rowAt(rows, hover, W) : null;
  const yearOf = (day: number) => Math.floor(day / YEAR_DAYS) + 1;
  const change = c && c.yearAgo !== null ? c.last - c.yearAgo : null;
  const cursorX = at ? ((at.day - rows[0].day) / Math.max(1, rows[rows.length - 1].day - rows[0].day)) * W : 0;
  return (
    <div class="th-records">
      <div class="th-series" role="radiogroup" aria-label={L("Что показать", "What to show")}>
        {HISTORY_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === key}
            class={k === key ? "th-series-btn on" : "th-series-btn"}
            onClick={() => {
              series.value = k;
              play("page");
            }}
          >
            {SERIES[k].label}
          </button>
        ))}
      </div>
      {!c ? (
        <p class="mk-note">{L("Записи начнутся в первую полночь после открытия ратуши.", "The records start at the first midnight after the town hall opens.")}</p>
      ) : (
        <>
          <div class="th-figures">
            <span>
              <span class="mk-cap">{L("Сейчас", "Now")}</span>
              <b>
                {num(c.last)} {s.unit}
              </b>
            </span>
            <span>
              <span class="mk-cap">{L("За год", "Over a year")}</span>
              <b class={change === null ? "" : change > 0 ? "is-ok" : change < 0 ? "is-bad" : ""}>{change === null ? "—" : `${change > 0 ? "+" : change < 0 ? "−" : ""}${num(Math.abs(change))} ${s.unit}`}</b>
            </span>
            <span>
              <span class="mk-cap">{L("Меньше всего / больше всего", "Lowest / highest")}</span>
              <b>
                {num(c.min)} / {num(c.max)}
              </b>
            </span>
          </div>
          <figure class="th-chart">
            <span class="th-y th-y-max">{num(c.max)}</span>
            <span class="th-y th-y-min">{num(Math.min(0, c.min))}</span>
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
              {c.years.map((y) => (
                <line key={y.year} class="th-grid" x1={y.x} x2={y.x} y1={0} y2={H} />
              ))}
              <path class="th-area" d={c.area} />
              <path class="th-line" d={c.line} />
              {at && <line class="th-cursor" x1={cursorX} x2={cursorX} y1={0} y2={H} />}
            </svg>
            <div class="th-x">
              {c.years.map((y) => (
                <span key={y.year} style={{ left: `${(y.x / W) * 100}%` }}>
                  {L(`${y.year} г.`, `Y${y.year}`)}
                </span>
              ))}
            </div>
            <figcaption class="th-readout" aria-live="polite">
              {at ? `${L("Год", "Year")} ${yearOf(at.day)}, ${L("день", "day")} ${(at.day % YEAR_DAYS) + 1}: ${num(at[key])} ${s.unit}` : L("Наведите на график, чтобы увидеть день", "Point at the chart to see a day")}
            </figcaption>
          </figure>
        </>
      )}
    </div>
  );
}

export function TownhallPanel() {
  const st = state.value;
  if (rightPanel.value !== "townhall" || !st) return null;
  const v = st.govView;
  const sub = !v ? L("Ратуша ещё не построена", "The town hall is not built yet") : `${FORM_INFO[v.form].name} · ${v.head ? `${L("глава", "head")} ${v.head.name}` : L("главы нет", "no head")}`;
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
        <div class="mk-body th-body" role="tabpanel" id={tabPanelId("hall", tab.value)} aria-labelledby={tabId("hall", tab.value)}>
          {!v ? <p class="mk-note">{L("Постройте ратушу: из неё отдают приказы и выбирают главу поселения.", "Build a town hall: orders are given and the head of the town is chosen there.")}</p> : tab.value === "rule" ? <RuleTab v={v} /> : tab.value === "orders" ? <OrdersTab /> : <RecordsTab />}
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
