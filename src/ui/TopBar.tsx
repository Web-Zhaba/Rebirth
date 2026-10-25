import { flyOrJump } from "../map/motion";
import type maplibregl from "maplibre-gl";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { clearingLogs, isCleared } from "../sim/clearing";
import { calendar, isNight, NIGHT_BOOST, type Speed } from "../sim/clock";
import type { City, Stock } from "../sim/types";
import { tool } from "../map/tools";
import { buildings, economy, incomingCount, people, roads, setSpeed, speed, state, stock } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { aboutOpen } from "./AboutDialog";
import { hotkeysOpen } from "./HotkeysDialog";
import { settingsOpen } from "./SettingsDialog";
import { rightPanel, togglePanel } from "./panels";
import { IconButton, Stat, Tooltip } from "./kit";
import { amount, dayPhase, deltaDir, foodNet, LOW_FOOD_DAYS, pad, PHASE_LABEL, perDay, roadQueue, tons, warnings } from "./topbarModel";
import { useGameMinutes } from "./useGameMinutes";

const SEASON_RU = ["Весна", "Лето", "Осень", "Зима"];
const families = (n: number) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return "семей";
  return n % 10 === 1 ? "семья" : n % 10 >= 2 && n % 10 <= 4 ? "семьи" : "семей";
};
const SPEEDS: { v: Speed; label: string; key: string }[] = [
  { v: 0, label: "Пауза", key: "P" },
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

const Row = ({ label, value }: { label: string; value: ComponentChildren }) => (
  <span class="tip-row">
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
const GOOD_UNIT: Record<Good, string> = { logs: "м³", planks: "м³", stone: "т", wares: "шт" };
const GOODS: { id: Good; icon: IconName; title: string; cap: string }[] = [
  { id: "logs", icon: "log", title: "Брёвна", cap: "брёвна" },
  { id: "planks", icon: "planks", title: "Доски", cap: "доски" },
  { id: "stone", icon: "stone", title: "Камень", cap: "камень" },
  { id: "wares", icon: "wares", title: "Товары", cap: "товары" },
];

export function TopBar({ city, map }: { city: City; map?: maplibregl.Map }) {
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
      if (e.key === "h" || e.key === "H" || e.key === "Home") {
        if (map) {
          e.preventDefault();
          flyOrJump(map, { center: [city.lng, city.lat], zoom: 16 });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map, city.lng, city.lat]);
  const p = people.value;
  const st = stock.value;
  const eco = economy.value;
  const clearing = (state.value?.clearings ?? []).filter((c) => !isCleared(c));
  const clearGot = clearing.reduce((a, c) => a + (clearingLogs(c.area, c.forest) * c.done) / c.labor, 0);
  const clearAll = clearing.reduce((a, c) => a + clearingLogs(c.area, c.forest), 0);
  const mood = eco ? Math.round(eco.avgMood) : 0;
  const net = eco ? foodNet(eco) : 0;
  const text = (id: Good) => (st ? (id === "wares" ? String(Math.floor(st[id])) : amount(st[id])) : "");

  return (
    <header class="topbar">
      <div class="tb-city">
        {map ? (
          <Tooltip text="К центру поселения (H)">
            <button
              class="city-name-btn"
              type="button"
              onClick={() => flyOrJump(map, { center: [city.lng, city.lat], zoom: 16 })}
            >
              <span class="city-name">{city.name}</span>
            </button>
          </Tooltip>
        ) : (
          <div class="city-name">{city.name}</div>
        )}
        <div class="city-date">
          <Icon name={phase} size={16} label={PHASE_LABEL[phase]} class={`phase-${phase}`} />
          <span>
            Год {cal.year} · {SEASON_RU[cal.season]}, день {cal.dayOfSeason} · {pad(cal.hour)}:{pad(cal.minute)}
          </span>
        </div>
      </div>
      <div class="speed" role="group" aria-label="Скорость времени">
        {SPEEDS.map((s) => (
          <button key={s.v} type="button" aria-pressed={speed.value === s.v} title={`Клавиша ${s.key}`} aria-label={s.v === 0 ? "Пауза" : undefined} onClick={() => setSpeed(s.v)}>
            {s.v === 0 ? <Icon name="pause" size={16} /> : s.label}
          </button>
        ))}
        {speed.value > 0 && isNight(gm) && <span class="speed-note">ночь ×{NIGHT_BOOST}</span>}
      </div>
      {p && st && eco && (
        <div class="stats">
          <BarStat
            icon="person"
            value={String(p.pop)}
            caption="жители"
            title="Население"
            tip={
              <>
                <Row label="Семей" value={p.households} />
                <Row label="В палатках" value={p.tents} />
                {incomingCount.value > 0 && <Row label="В пути" value={`${incomingCount.value} ${families(incomingCount.value)}`} />}
                <Row label="Работают" value={p.employed} />
                <Row label="На стройке" value={p.builders} />
                <Row label="Без работы" value={p.unemployed} />
              </>
            }
          />
          <BarStat
            icon="food"
            value={`${tons(st.food)} т`}
            delta={perDay(net, "кг")}
            dir={deltaDir(net)}
            caption={eco.foodPerDay > 0 ? `на ${eco.foodDays >= 999 ? "999+" : Math.floor(eco.foodDays)} дн.` : "еда"}
            tone={eco.foodPerDay > 0 && st.food < eco.foodPerDay ? "bad" : eco.foodPerDay > 0 && eco.foodDays < LOW_FOOD_DAYS ? "warn" : undefined}
            title="Еда"
            tip={
              <>
                <Row label="На складах" value={`${tons(st.food)} из ${tons(eco.foodCap)} т`} />
                {eco.foodPerDay > 0 && <Row label="Хватит на" value={`${eco.foodDays >= 999 ? "999+" : Math.floor(eco.foodDays)} дн.`} />}
                <Row label="Сделано вчера" value={`+${amount(eco.yesterday.food)} кг`} />
                <Row label="Собирают за день" value={`+${amount(eco.forage)} кг`} />
                <Row label="Съедают за день" value={`−${amount(eco.foodPerDay)} кг`} />
                {eco.foodPerDay > 0 && eco.outlook < 1 && <span class="tip-note">Запасов и одного урожая не хватит на год вперёд: приезжих меньше.</span>}
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
                    <Row label="На складе" value={`${text(g.id)} ${GOOD_UNIT[g.id]}`} />
                    <Row label="Сделано вчера" value={`${made > 0 ? "+" : ""}${amount(made)} ${GOOD_UNIT[g.id]}`} />
                    {g.id === "logs" && clearing.length > 0 && <Row label="Вырубка уже дала" value={`+${amount(clearGot)} из ${amount(clearAll)} м³`} />}
                    {g.id === "wares" && eco.eveningWares > 0 && <Row label="Вечерние ремёсла, 19–22 ч" value={`+${eco.eveningWares.toFixed(2).replace(".", ",")} шт/ч`} />}
                  </>
                }
              />
            );
          })}
          <BarStat
            icon="mood"
            value={mood > 0 ? String(mood) : "—"}
            caption="настроение"
            title="Настроение"
            align="end"
            tip={<span class="tip-note">Среднее по семьям, от 0 до 100.</span>}
          />
        </div>
      )}
      <span class="tb-end">
        <IconButton icon="town" size={20} label="Город" aria-pressed={rightPanel.value === "town"} onClick={() => togglePanel("town")} />
        <IconButton icon="help" size={16} label="Горячие клавиши (?)" onClick={() => (hotkeysOpen.value = true)} />
        <IconButton icon="settings" size={16} label="Настройки" onClick={() => (settingsOpen.value = true)} />
        <IconButton icon="info" size={16} label="Об игре" onClick={() => (aboutOpen.value = true)} />
      </span>
    </header>
  );
}

// Problems as icon + text chips under the bar.
export function currentWarnings() {
  const p = people.value;
  const st = stock.value;
  const eco = economy.value;
  if (!p || !st || !eco) return [];
  const { queue } = roadQueue(roads.value);
  const b = buildings.value;
  const building = b ? Object.values(b).filter((x) => x.state === "building").length : 0;
  return warnings({ food: st.food, eco, builders: p.builders, queue, logs: st.logs, building });
}

export function Warnings() {
  const list = currentWarnings();
  if (list.length === 0) return null;
  return (
    <ul class="warns" aria-label="Предупреждения">
      {list.map((w) => (
        <li key={w.id} class="warn-chip">
          <Icon name="warning" size={16} />
          {w.text}
        </li>
      ))}
    </ul>
  );
}
