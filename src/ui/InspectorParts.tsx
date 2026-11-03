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
import { decimal, L, plural } from "../i18n";

export const num = (v: number) => decimal((v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString());

export { plural };

// Fires a command and flashes the reason when the sim refuses it.
export const act = (cmd: Parameters<typeof sendCmd>[0]) =>
  void sendCmd(cmd).then((r) => {
    if (!r.ok) flash(r.reason ?? L("Не удалось", "Failed"));
  });

// Time to finish `hours` of work at a site: real time at the current speed, with the hands one site can use.
// A site key is a building id, or -id of a clearing. The queue ahead of the site is ignored, as in the build bar.
export function siteEta(hours: number, key: number): string {
  const s = state.value;
  if (!s || hours <= 0) return "";
  const toloka = !!s.levers.toloka && s.levers.toloka.site === key && gameClock.value < s.levers.toloka.until;
  const hands = siteHands(artelHands(), toloka);
  if (hands <= 0) return L("некому строить", "no one to build");
  if (speed.value === 0) return L(`${num(hours / hands)} ч работы, время стоит`, `${num(hours / hands)} h of work, time is stopped`);
  const ms = etaRealMs(hours, hands, s.gameMinutes, speed.value, s.levers);
  return Number.isFinite(ms) ? `${formatReal(ms)} (${hands} ${L("стр.", "bld.")})` : L("очень долго", "very long");
}

// The tar head of a right-slot sheet: icon, name, status tag and a quiet line under the name. It stays on top while
// the sheet scrolls.
export function InspectorHead({ icon, title, chip, sub, onClose, headingId }: { icon: IconName; title: string; chip?: Chip; sub?: ComponentChildren; onClose: () => void; headingId?: string }) {
  return (
    <div class="insp-head">
      <span class="insp-ic">
        <Icon name={icon} size={26} />
      </span>
      <div class="insp-title">
        <h2 id={headingId}>{title}</h2>
        {(chip || sub) && (
          <div class="insp-meta">
            {chip && <span class={`chip chip-${chip.tone}`}>{chip.label}</span>}
            {sub && <span class="insp-sub">{sub}</span>}
          </div>
        )}
      </div>
      <IconButton icon="close" size={16} label={L("Закрыть", "Close")} onClick={onClose} />
    </div>
  );
}

// A titled part of a sheet, ruled off from the one above by a lenticel.
export function Section({ title, aside, children, class: cls }: { title?: string; aside?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`insp-sec${cls ? ` ${cls}` : ""}`}>
      {(title || aside) && (
        <div class="insp-sec-head">
          {title && <h3>{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
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
const waitText = (min: number) => (min >= 1440 ? `${Math.ceil(min / 1440)} ${L("дн.", "d")}` : `${Math.max(1, Math.ceil(min / 60))} ${L("ч", "h")}`);

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
        aria-label={L("В первую очередь", "Build first")}
        aria-pressed={first}
        variant={first ? "primary" : "default"}
        onClick={() => act({ type: "setPriority", key: first ? null : siteKey })}
      >
        {first ? L("Первая очередь: снять", "Build first: cancel") : L("В первую очередь", "Build first")}
      </Button>
      <Button
        icon="crowd"
        aria-label={L("Общий сбор", "All hands")}
        title={L("Все взрослые идут на эту стройку до конца рабочего дня, прочие дела стоят", "All adults work on this site until the end of the workday; everything else waits")}
        disabled={wait > 0 || running}
        onClick={() => act({ type: "callToloka", key: siteKey })}
      >
        {running ? L("Общий сбор идёт", "All hands in progress") : wait > 0 ? L(`Общий сбор (через ${waitText(wait)})`, `All hands (in ${waitText(wait)})`) : L("Общий сбор", "All hands")}
      </Button>
    </div>
  );
}
