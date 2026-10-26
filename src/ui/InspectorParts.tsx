import "./panels.css";
import type { ComponentChildren } from "preact";
import { etaRealMs, formatReal } from "../sim/buildEta";
import { artelHands } from "../map/buildCost";
import { flash } from "../map/tools";
import { gameClock, sendCmd, speed, state } from "../simClient";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { siteHands, type Chip } from "./inspectorModel";
import { Button, IconButton } from "./kit";

export const num = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString().replace(".", ",");

// Russian plural: one / few / many.
export const plural = (n: number, one: string, few: string, many: string) => {
  const m = n % 100;
  if (m >= 11 && m <= 14) return many;
  return n % 10 === 1 ? one : n % 10 >= 2 && n % 10 <= 4 ? few : many;
};

// Fires a command and flashes the reason when the sim refuses it.
export const act = (cmd: Parameters<typeof sendCmd>[0]) =>
  void sendCmd(cmd).then((r) => {
    if (!r.ok) flash(r.reason ?? "Не удалось");
  });

// Time to finish `hours` of work at a site: real time at the current speed, with the hands one site can use.
// A site key is a building id, or -id of a clearing. The queue ahead of the site is ignored, as in the build bar.
export function siteEta(hours: number, key: number): string {
  const s = state.value;
  if (!s || hours <= 0) return "";
  const toloka = !!s.levers.toloka && s.levers.toloka.site === key && gameClock.value < s.levers.toloka.until;
  const hands = siteHands(artelHands(), toloka);
  if (hands <= 0) return "некому строить";
  if (speed.value === 0) return `${num(hours / hands)} ч работы, время стоит`;
  const ms = etaRealMs(hours, hands, s.gameMinutes, speed.value, s.levers);
  return Number.isFinite(ms) ? `${formatReal(ms)} (${hands} стр.)` : "очень долго";
}

export function InspectorHead({ icon, title, chip, onClose }: { icon: IconName; title: string; chip?: Chip; onClose: () => void }) {
  return (
    <div class="insp-head">
      <span class="insp-ic">
        <Icon name={icon} size={28} />
      </span>
      <div class="insp-title">
        <h2>{title}</h2>
        {chip && <span class={`chip chip-${chip.tone}`}>{chip.label}</span>}
      </div>
      <IconButton icon="close" size={16} label="Закрыть" onClick={onClose} />
    </div>
  );
}

// Label and value on one line.
export function Line({ icon, label, children, tone }: { icon?: IconName; label: string; children: ComponentChildren; tone?: "bad" | "warn" | "ok" }) {
  return (
    <div class={`insp-line${tone ? ` insp-${tone}` : ""}`}>
      {icon && <Icon name={icon} size={16} />}
      <span class="insp-label">{label}</span>
      <span class="insp-value">{children}</span>
    </div>
  );
}

// Game time to wait, in words: «3 ч», «2 дн.».
const waitText = (min: number) => (min >= 1440 ? `${Math.ceil(min / 1440)} дн.` : `${Math.max(1, Math.ceil(min / 60))} ч`);

// Levers for a site that still needs work: served first, and a толока (all adults come, production stands).
export function SiteLevers({ siteKey }: { siteKey: number }) {
  const lv = state.value?.levers;
  if (!lv) return null;
  const first = lv.priority === siteKey;
  const wait = Math.max(0, lv.tolokaReady - gameClock.value);
  const running = !!lv.toloka && gameClock.value < lv.toloka.until;
  return (
    <div class="site-levers">
      <Button
        icon="flag"
        aria-label="В первую очередь"
        aria-pressed={first}
        variant={first ? "primary" : "default"}
        onClick={() => act({ type: "setPriority", key: first ? null : siteKey })}
      >
        {first ? "Первая очередь: снять" : "В первую очередь"}
      </Button>
      <Button
        icon="crowd"
        aria-label="Общий сбор"
        title="Все взрослые идут на эту стройку до конца рабочего дня, прочие дела стоят"
        disabled={wait > 0 || running}
        onClick={() => act({ type: "callToloka", key: siteKey })}
      >
        {running ? "Общий сбор идёт" : wait > 0 ? `Общий сбор (через ${waitText(wait)})` : "Общий сбор"}
      </Button>
    </div>
  );
}
