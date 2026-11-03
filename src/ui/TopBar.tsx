import type { View } from "../view/view";
import { TOWN_VIEW_MPP } from "../view/scale";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { clearingLogs, isCleared } from "../sim/clearing";
import { SERVICE_LIST } from "../sim/services";
import { lockReason, techOf } from "../sim/tech";
import { calendar, isNight, NIGHT_BOOST, type Speed } from "../sim/clock";
import type { City, Stock } from "../sim/types";
import { setManualOverlay, tool } from "../map/tools";
import { buildings, economy, incomingCount, people, roads, setSpeed, speed, state, stock } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { aboutOpen } from "./AboutDialog";
import { hotkeysOpen } from "./HotkeysDialog";
import { settingsOpen } from "./SettingsDialog";
import { openPanel, rightPanel, togglePanel } from "./panels";
import { BADGE_TEXT } from "./techModel";
import { badge } from "./techState";
import { Stat, Tooltip } from "./kit";
import { researchStatusView } from "./researchStatusModel";
import { amount, dayPhase, deltaDir, foodNet, LOW_FOOD_DAYS, pad, PHASE_LABEL, perDay, roadQueue, tons, warnings } from "./topbarModel";
import { weatherChip } from "./weatherModel";
import { useGameMinutes } from "./useGameMinutes";
import { signedDaily } from "./resourceModel";
import { freshWarnings, serviceWarningText, warningAction } from "./warningModel";
import { screenshotMode } from "./screenshotMode";
import { SEMANTIC_IDS } from "./semanticIds";
import { decimal, L, plural } from "../i18n";
import { SEASON_NAMES } from "../map/seasonPreview";

const families = (n: number) => plural(n, "семья", "семьи", "семей", "family", "families");
const SPEEDS: { v: Speed; label: string; key: string }[] = [
  { v: 0, label: L("Пауза", "Pause"), key: "P" },
  { v: 1, label: "1×", key: "1" },
  { v: 2, label: "2×", key: "2" },
  { v: 4, label: "4×", key: "3" },
];
const KEY_SPEED: Record<string, Speed> = { "1": 1, "2": 2, "3": 4 };

// 1/2/3 pick a speed, P pauses; Space too, unless a map tool is active (the zone brush pans with Space).
function onSpeedKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const el = e.target as HTMLElement | null;
  if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
  const toggle = () => setSpeed(speed.peek() === 0 ? 1 : 0);
  if (e.key in KEY_SPEED) setSpeed(KEY_SPEED[e.key]);
  else if (e.key === "p" || e.key === "P") toggle();
  else if (e.key === " " && tool.value === null && !(el && ["BUTTON", "A", "SUMMARY"].includes(el.tagName))) toggle();
  else return;
  e.preventDefault();
}

const Row = ({ label, value, tone }: { label: string; value: ComponentChildren; tone?: "ok" | "warn" | "bad" }) => (
  <span class={`tip-row${tone ? ` tip-${tone}` : ""}`}>
    <span>{label}</span>
    <span>{value}</span>
  </span>
);

// A stat with a tooltip; focusable so the breakdown opens from the keyboard as well.
function BarStat({ title, tip, align, ...stat }: { title: string; tip: ComponentChildren; align?: "start" | "end" } & Parameters<typeof Stat>[0]) {
  return (
    <Tooltip
      align={align}
      text={
        <>
          <b class="tip-title">{title}</b>
          {tip}
        </>
      }
    >
      <span class="bar-stat" tabIndex={0} role="group" aria-label={title}>
        <Stat {...stat} />
      </span>
    </Tooltip>
  );
}

type Good = Exclude<keyof Stock, "food">;
const GOOD_UNIT: Record<Good, string> = { logs: L("м³", "m³"), planks: L("м³", "m³"), stone: L("т", "t"), wares: L("шт", "pcs") };
const GOODS: { id: Good; icon: IconName; title: string; cap: string }[] = [
  { id: "logs", icon: "log", title: L("Брёвна", "Logs"), cap: L("брёвна", "logs") },
  { id: "planks", icon: "planks", title: L("Доски", "Planks"), cap: L("доски", "planks") },
  { id: "stone", icon: "stone", title: L("Камень", "Stone"), cap: L("камень", "stone") },
  { id: "wares", icon: "wares", title: L("Товары", "Goods"), cap: L("товары", "goods") },
];

export function TopBar({ city, view }: { city: City; view?: View }) {
  const gm = useGameMinutes();
  const cal = calendar(gm);
  const phase = dayPhase(cal.hour);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      onSpeedKey(e);
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (e.key === "?") {
        e.preventDefault();
        hotkeysOpen.value = true;
        return;
      }
      if (e.code === "KeyN") {
        e.preventDefault();
        togglePanel("tech");
        return;
      }
      if (e.key === "h" || e.key === "H" || e.key === "Home") {
        if (view) {
          e.preventDefault();
          view.flyTo({ center: [city.lng, city.lat], mpp: TOWN_VIEW_MPP });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, city.lng, city.lat]);
  const p = people.value;
  const st = stock.value;
  const eco = economy.value;
  const clearing = (state.value?.clearings ?? []).filter((c) => !isCleared(c));
  const clearGot = clearing.reduce((a, c) => a + (clearingLogs(c.area, c.forest) * c.done) / c.labor, 0);
  const clearAll = clearing.reduce((a, c) => a + clearingLogs(c.area, c.forest), 0);
  const mood = eco ? Math.round(eco.avgMood) : 0;
  const net = eco ? foodNet(eco) : 0;
  const wx = weatherChip(state.value?.weather, cal.season, eco);
  const text = (id: Good) => (st ? (id === "wares" ? String(Math.floor(st[id])) : amount(st[id])) : "");

  const time = `${pad(cal.hour)}:${pad(cal.minute)}`;

  return (
    <header class="topbar" aria-label={L("Верхняя панель управления", "Top control bar")}>
      <div class="tb-plate">
        <span class="logo-mark tb-mark" aria-hidden="true" />
        <div class="tb-city">
          {view ? (
            <Tooltip text={L("К центру поселения (H)", "To the settlement centre (H)")}>
              <button class="city-name-btn" type="button" aria-keyshortcuts="H" onClick={() => view.flyTo({ center: [city.lng, city.lat], mpp: TOWN_VIEW_MPP })}>
                <span class="city-name">{city.name}</span>
              </button>
            </Tooltip>
          ) : (
            <div class="city-name">{city.name}</div>
          )}
          <div class="city-date">
            {L("Год", "Year")} {cal.year} · {SEASON_NAMES[cal.season]}, {L("день", "day")} {cal.dayOfSeason}
          </div>
        </div>
        <div class="tb-clock" role="group" aria-label={`${L("Время", "Time")} ${time}, ${PHASE_LABEL[phase]}`}>
          <span class="tb-time" aria-hidden="true">
            <Icon name={phase} size={14} class={`phase-${phase}`} />
            {time}
          </span>
          {/* The day as a ruler: night, morning, day and evening spans, a resin needle at the current minute. */}
          <span class="tb-ruler" aria-hidden="true">
            <i style={{ left: `${((cal.hour * 60 + cal.minute) / 1440) * 100}%` }} />
          </span>
        </div>
        <div class="speed" role="toolbar" aria-label={L("Скорость времени", "Time speed")} aria-orientation="horizontal">
          {SPEEDS.map((s) => (
            <button key={s.v} type="button" aria-pressed={speed.value === s.v} aria-keyshortcuts={s.key} title={`${s.label} · ${L("клавиша", "key")} ${s.key}`} aria-label={s.v === 0 ? L("Пауза", "Pause") : undefined} onClick={() => setSpeed(s.v)}>
              {s.v === 0 ? <Icon name="pause" size={14} /> : s.label}
            </button>
          ))}
          {speed.value > 0 && isNight(gm) && (
            <span class="speed-note" title={L("Ночью время идёт быстрее", "Night passes faster")}>
              <Icon name="night" size={12} />×{NIGHT_BOOST}
            </span>
          )}
        </div>
      </div>
      {p && st && eco && (
        <section class="stats" aria-label={L("Состояние поселения", "Settlement status")}>
          {wx && (
            <BarStat
              icon={wx.icon}
              value={wx.temp}
              caption={wx.word}
              tone={wx.impact ?? undefined}
              title={`${L("Погода", "Weather")}: ${wx.word}`}
              tip={
                <>
                  {wx.rows.map((r) => (
                    <Row key={r.label} label={r.label} value={r.value} />
                  ))}
                  {wx.notes.map((n) => (
                    <span key={n} class="tip-note">
                      {n}
                    </span>
                  ))}
                  {wx.effects.length > 0 && <b class="tip-title tip-section">{L("Что это значит сегодня", "What it means today")}</b>}
                  {wx.effects.map((e) => (
                    <Row key={e.key} label={e.label} value={e.value} tone={e.tone} />
                  ))}
                </>
              }
            />
          )}
          <BarStat
            icon="person"
            value={String(p.pop)}
            caption={L("жители", "residents")}
            title={L("Население", "Population")}
            tip={
              <>
                <Row label={L("Семей", "Families")} value={p.households} />
                <Row label={L("В палатках", "In tents")} value={p.tents} />
                {incomingCount.value > 0 && <Row label={L("В пути", "On the way")} value={`${incomingCount.value} ${families(incomingCount.value)}`} />}
                <Row label={L("Работают", "Working")} value={p.employed} />
                <Row label={L("На стройке", "Building")} value={p.builders} />
                <Row label={L("Без работы", "Without work")} value={p.unemployed} />
              </>
            }
          />
          <BarStat
            icon="food"
            value={`${tons(st.food)} ${L("т", "t")}`}
            delta={perDay(net, L("кг", "kg"))}
            dir={deltaDir(net)}
            caption={eco.foodPerDay > 0 ? L(`на ${eco.foodDays >= 999 ? "999+" : Math.floor(eco.foodDays)} дн.`, `for ${eco.foodDays >= 999 ? "999+" : Math.floor(eco.foodDays)} d`) : L("еда", "food")}
            tone={eco.foodPerDay > 0 && st.food < eco.foodPerDay ? "bad" : eco.foodPerDay > 0 && eco.foodDays < LOW_FOOD_DAYS ? "warn" : undefined}
            title={L("Еда", "Food")}
            tip={
              <>
                <Row label={L("На складах", "In store")} value={L(`${tons(st.food)} из ${tons(eco.foodCap)} т`, `${tons(st.food)} of ${tons(eco.foodCap)} t`)} />
                {eco.foodPerDay > 0 && <Row label={L("Хватит на", "Lasts")} value={`${eco.foodDays >= 999 ? "999+" : Math.floor(eco.foodDays)} ${L("дн.", "d")}`} />}
                <Row label={L("Сделано вчера", "Made yesterday")} value={`+${amount(eco.yesterday.food)} ${L("кг", "kg")}`} />
                <Row label={L("Собирают за день", "Gathered per day")} value={`+${amount(eco.forage)} ${L("кг", "kg")}`} />
                <Row label={L("Съедают за день", "Eaten per day")} value={`−${amount(eco.foodPerDay)} ${L("кг", "kg")}`} />
                <Row label={L("Чистый баланс", "Net balance")} value={signedDaily(net, L("кг", "kg"))} tone={net < 0 ? "warn" : "ok"} />
                {eco.foodPerDay > 0 && eco.outlook < 1 && <span class="tip-note">{L("Запасов и одного урожая не хватит на год вперёд: приезжих меньше.", "Stores plus one harvest won’t last a year ahead: fewer newcomers.")}</span>}
              </>
            }
          />
          {GOODS.map((g) => {
            const made = eco.yesterday[g.id];
            return (
              <BarStat
                key={g.id}
                icon={g.icon}
                value={text(g.id)}
                delta={perDay(made)}
                dir={deltaDir(made)}
                caption={g.cap}
                title={g.title}
                tip={
                  <>
                    <Row label={L("На складе", "In store")} value={`${text(g.id)} ${GOOD_UNIT[g.id]}`} />
                    <Row label={L("Сделано вчера", "Made yesterday")} value={`${made > 0 ? "+" : ""}${amount(made)} ${GOOD_UNIT[g.id]}`} />
                    {g.id === "logs" && clearing.length > 0 && <Row label={L("Вырубка уже дала", "Clearing has yielded")} value={L(`+${amount(clearGot)} из ${amount(clearAll)} м³`, `+${amount(clearGot)} of ${amount(clearAll)} m³`)} />}
                    {g.id === "logs" && eco.brushwood > 0 && <Row label={L("Хворост, без дров в запасе", "Brushwood, no firewood in store")} value={L(`+${amount(eco.brushwood)} м³ в день`, `+${amount(eco.brushwood)} m³ a day`)} />}
                    {g.id === "logs" && eco.firewood > 0 && <Row label={L("Отопление сегодня", "Heating today")} value={signedDaily(-eco.firewood, L("м³", "m³"))} tone="warn" />}
                    {g.id === "wares" && eco.eveningWares > 0 && <Row label={L("Вечерние ремёсла, 19–22 ч", "Evening crafts, 19–22 h")} value={`+${decimal(eco.eveningWares.toFixed(2))} ${L("шт/ч", "pcs/h")}`} />}
                  </>
                }
              />
            );
          })}
          <BarStat
            icon="mood"
            value={mood > 0 ? String(mood) : "—"}
            caption={L("настроение", "mood")}
            title={L("Настроение", "Mood")}
            align="end"
            tip={
              <>
                <Row label={L("Сытость", "Food")} value={Math.round(p.needs.avg.food)} />
                <Row label={L("Отдых", "Rest")} value={Math.round(p.needs.avg.rest)} />
                <Row label={L("Общение", "Company")} value={Math.round(p.needs.avg.social)} />
                <Row label={L("Тепло", "Warmth")} value={Math.round(p.needs.avg.warmth)} />
                <Row label={L("Силы к работе", "Fitness for work")} value={`${Math.round(p.needs.work * 100)}${L(" %", "%")}`} tone={p.needs.work < 0.85 ? "warn" : "ok"} />
                <span class="tip-note">{L("Среднее по семьям, от 0 до 100. Недовольство снижает труд, рождения и учёбу, отпугивает приезжих; несчастные семьи уезжают.", "Average over families, 0 to 100. Discontent lowers work, births and learning and scares off newcomers; unhappy families leave.")}</span>
              </>
            }
          />
        </section>
      )}
      <div class="tb-end" role="toolbar" aria-label={L("Основные действия", "Main actions")}>
        <ResearchButton />
        <button type="button" class="tb-btn" title={L("Город", "Town")} aria-controls={SEMANTIC_IDS.townPanel} aria-pressed={rightPanel.value === "town"} onClick={() => togglePanel("town")}>
          <Icon name="town" size={20} />
          <span class="tb-btn-label">{L("Город", "Town")}</span>
        </button>
        <MainMenu />
      </div>
    </header>
  );
}

// «Наука» with what is being studied and how far it is: the tech, a resin progress line, or a warning that nothing is
// under research. A tech finished since the panel was last open adds a «готово» tag.
function ResearchButton() {
  const s = state.value;
  const r = s?.research;
  const active = r?.active ? techOf(r.active.techId) : null;
  const queued = s ? s.progress.research.queue.map((id) => techOf(id)?.name ?? id) : [];
  const view = researchStatusView(active?.name ?? null, r?.active?.share ?? null, queued);
  const pct = view.progress === null ? null : Math.floor(view.progress * 100);
  const done = badge.value === "done";
  const label = `${L("Наука", "Research")} (N). ${view.title}${view.next ? `. ${view.next}` : ""}${done ? `. ${BADGE_TEXT.done}` : ""}`;
  return (
    <button type="button" class={`tb-research${view.idle ? " is-idle" : ""}`} title={label} aria-label={label} aria-controls={SEMANTIC_IDS.techPanel} aria-keyshortcuts="N" aria-pressed={rightPanel.value === "tech"} onClick={() => togglePanel("tech")}>
      <Icon name="scroll" size={20} />
      <span class="tb-research-body" aria-hidden="true">
        <span class="tb-research-head">
          {L("Наука", "Research")}
          {done && <span class="tb-badge">{BADGE_TEXT.done}</span>}
        </span>
        <span class="tb-research-what">
          {view.idle ? BADGE_TEXT.idle : active?.name}
          {pct !== null && <b>{pct}%</b>}
        </span>
        {pct !== null && (
          <span class="tb-research-track">
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
      </span>
    </button>
  );
}

const MENU: { icon: IconName; label: string; key?: string; run: () => void }[] = [
  { icon: "camera", label: L("Скрыть интерфейс", "Hide interface"), key: "F10", run: () => (screenshotMode.value = true) },
  { icon: "help", label: L("Горячие клавиши", "Keyboard shortcuts"), key: "?", run: () => (hotkeysOpen.value = true) },
  { icon: "settings", label: L("Настройки", "Settings"), run: () => (settingsOpen.value = true) },
  { icon: "info", label: L("Об игре", "About"), run: () => (aboutOpen.value = true) },
];

// The rare actions folded behind one button: a menu button with arrow keys, Esc and a click outside to close it.
function MainMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      items[to]?.focus();
    } else if (e.key === "Escape") {
      // Before the window handler that would also close the right panel.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };
  return (
    <div class="tb-menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={button} type="button" class="tb-btn tb-menu-btn" title={L("Меню", "Menu")} aria-label={L("Меню", "Menu")} aria-haspopup="menu" aria-expanded={open} aria-controls="tb-menu" onClick={() => setOpen(!open)}>
        <Icon name="menu" size={20} />
      </button>
      {open && (
        <ul class="tb-menu" id="tb-menu" role="menu" aria-label={L("Меню", "Menu")}>
          {MENU.map((m) => (
            <li key={m.label} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-keyshortcuts={m.key}
                onClick={() => {
                  setOpen(false);
                  m.run();
                }}
              >
                <Icon name={m.icon} size={16} />
                <span>{m.label}</span>
                {m.key && <kbd>{m.key}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Problems as icon + text chips under the bar.
export function currentWarnings() {
  const p = people.value;
  const st = stock.value;
  const eco = economy.value;
  const snap = state.value;
  if (!p || !st || !eco || !snap) return [];
  const { queue } = roadQueue(roads.value);
  const b = buildings.value;
  const building = b ? Object.values(b).filter((x) => x.state === "building").length : 0;
  const out = warnings({ food: st.food, eco, builders: p.builders, queue, logs: st.logs, building, needs: p.needs });
  if (snap.services.houses > 0) {
    for (const service of SERVICE_LIST) {
      if (lockReason({ progress: snap.progress }, service.id)) continue;
      const uncovered = snap.services.houses - snap.services.covered[service.id];
      if (uncovered > 0) out.push({ id: `service:${service.id}`, text: serviceWarningText(service.name, uncovered) });
    }
  }
  return out;
}

export function Warnings() {
  const current = currentWarnings();
  const currentKey = current.map((w) => w.id).sort().join("|");
  const previous = useRef<Set<string>>(new Set(current.map((w) => w.id)));
  const [list, setList] = useState(current.slice(0, 0));

  useEffect(() => {
    const fresh = freshWarnings(previous.current, current);
    previous.current = new Set(current.map((w) => w.id));
    if (fresh.length === 0) return;
    setList(fresh);
    const timer = window.setTimeout(() => setList([]), 8000);
    return () => window.clearTimeout(timer);
  }, [currentKey]);

  if (list.length === 0) return null;
  return (
    <div class="warns" role="status" aria-label={L("Новые предупреждения", "New warnings")}>
      {list.map((w) => {
        const action = warningAction(w.id);
        return (
          <button
            key={w.id}
            type="button"
            class="warn-chip"
            onClick={() => {
              if (action === "town") openPanel("town");
              else if (action && "overlay" in action) {
                tool.value = null;
                setManualOverlay(action.overlay);
              }
            }}
          >
            <Icon name="warning" size={16} />
            {w.text}
          </button>
        );
      })}
    </div>
  );
}
