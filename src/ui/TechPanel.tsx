import { useState } from "preact/hooks";
import { Icon } from "./Icon";
import { Button, IconButton } from "./kit";
import { closePanel, rightPanel } from "./panels";
import { cancelTech, queueTech, selectedTech, startTech, techView } from "./techState";
import { eraLabel, formatDays, type TechLane, type TechNode, type TechView } from "./techModel";
import { MAX_QUEUE } from "../sim/tech";
import "./tech.css";
import { SEMANTIC_IDS } from "./semanticIds";
import { decimal, L } from "../i18n";

const speedText = (v: number): string => `×${decimal(v.toFixed(2).replace(/0$/, ""))}`;
const select = (id: string): void => {
  selectedTech.value = selectedTech.peek() === id ? null : id;
};

type Filter = "all" | "available" | "locked" | "done";

const FILTERS: [Filter, string][] = [
  ["all", L("Всё", "All")],
  ["available", L("Доступно", "Available")],
  ["locked", L("Закрыто", "Locked")],
  ["done", L("Изучено", "Researched")],
];

// The tag a row carries: the state in one word, so the ledger reads top to bottom.
function RowTag({ n }: { n: TechNode }) {
  const text =
    n.state === "available" ? L("изучать", "research") : n.state === "active" ? L("идёт", "running") : n.state === "queued" ? L("в очереди", "queued") : n.state === "done" ? L("изучено", "done") : L("закрыто", "locked");
  return <span class={`tl-tag tl-${n.state}`}>{text}</span>;
}

function Row({ n }: { n: TechNode }) {
  const sel = selectedTech.value === n.id;
  const why =
    n.state === "locked"
      ? n.statusText
      : n.opens.length > 0
        ? `${L("открывает", "unlocks")}: ${n.opens.slice(0, 2).join(", ")}`
        : n.description;
  return (
    <li>
      <button
        type="button"
        class={`tl-row tl-${n.state}${sel ? " sel" : ""}`}
        aria-pressed={sel}
        onClick={() => select(n.id)}
      >
        <span class="tl-name">
          {n.state === "done" && <Icon name="check" size={12} />}
          {n.state === "locked" && <Icon name="lock" size={12} />}
          {n.name}
        </span>
        <span class="tl-days">{n.state === "done" ? "—" : formatDays(n.days)}</span>
        <RowTag n={n} />
        <span class="tl-why">{why}</span>
      </button>
    </li>
  );
}

function Group({ title, count, available, dom, nodes }: { title: string; count: number; available: number; dom: string; nodes: TechNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <section class={`tl-group dom-${dom}`}>
      <h3 class="tl-head">
        <i class="tl-sw" />
        {title}
        <span class="tl-count">
          {available > 0 ? `${available} ${L("доступно", "available")} · ` : ""}
          {count}
        </span>
      </h3>
      <ul class="tl-list">
        {nodes.map((n) => (
          <Row key={n.id} n={n} />
        ))}
      </ul>
    </section>
  );
}

function Rail({
  v,
  era,
  setEra,
  filter,
  setFilter,
}: {
  v: TechView;
  era: number;
  setEra: (e: number) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  return (
    <aside class="tech-rail" aria-label={L("Эпохи и области", "Eras and fields")}>
      <h2 class="tr-cap">{L("Эпохи", "Eras")}</h2>
      {v.lanes.map((l: TechLane) => {
        const nodes = l.domains.flatMap((d) => d.nodes);
        const done = nodes.filter((n) => n.state === "done").length;
        const on = l.era === era;
        return (
          <button
            key={l.era}
            type="button"
            class={`tr-era${on ? " sel" : ""}${l.open ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => setEra(l.era)}
          >
            <span class="tr-era-t">
              {eraLabel(l.era)} «{l.name}»
            </span>
            <span class="tr-era-s">{l.open ? `${done} ${L("из", "of")} ${nodes.length}` : L("пока закрыта", "not yet open")}</span>
          </button>
        );
      })}
      <h2 class="tr-cap">{L("Области", "Fields")}</h2>
      {v.speeds.map((s) => (
        <div key={s.id} class={`tr-dom dom-${s.id}`}>
          <i class="tr-sw" />
          <span>{s.name}</span>
          <b>{speedText(s.speed)}</b>
        </div>
      ))}
      <h2 class="tr-cap">{L("Показывать", "Show")}</h2>
      <div class="tr-filter">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            class={`tr-f${filter === id ? " on" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
    </aside>
  );
}

function Leaf({ n }: { n: TechNode }) {
  return (
    <aside class={`tech-leaf dom-${n.domain}`} aria-label={`${L("Технология", "Technology")}: ${n.name}`}>
      <h2 class="tr-cap">{L("Технология", "Technology")}</h2>
      <h3 class="tl-leaf-name">{n.name}</h3>
      <p class="tl-leaf-text">{n.description}</p>
      <dl class="tl-facts">
        <dt>{L("Состояние", "State")}</dt>
        <dd>{n.statusText}</dd>
        {n.state !== "done" && (
          <>
            <dt>{L("Время", "Time")}</dt>
            <dd>{formatDays(n.days)}</dd>
          </>
        )}
        {n.requires.length > 0 && (
          <>
            <dt>{L("Требует", "Requires")}</dt>
            <dd>{n.requires.map((r) => `${r.name}${r.done ? L(" (изучено)", " (researched)") : ""}`).join(", ")}</dd>
          </>
        )}
        {n.opens.length > 0 && (
          <>
            <dt>{L("Открывает", "Unlocks")}</dt>
            <dd>{n.opens.join(", ")}</dd>
          </>
        )}
        {n.insight && (
          <>
            <dt>{L("Идея", "Idea")}</dt>
            <dd>
              {L(`«${n.insight.text}»: короче на ${Math.round(n.insight.cut * 100)} %`, `“${n.insight.text}”: ${Math.round(n.insight.cut * 100)}% shorter`)}
            </dd>
          </>
        )}
      </dl>
      <div class="tl-actions">
        {n.canStart && (
          <Button variant="primary" onClick={() => void startTech(n.id)}>
            {L("Исследовать", "Research")}
          </Button>
        )}
        {n.canQueue && <Button onClick={() => void queueTech(n.id)}>{L("В очередь", "Queue")}</Button>}
        {n.canCancel && (
          <Button variant="danger" onClick={() => void cancelTech(n.id)}>
            {n.state === "queued" ? L("Убрать из очереди", "Remove from queue") : L("Отменить", "Cancel")}
          </Button>
        )}
      </div>
      <IconButton icon="close" size={14} label={L("Скрыть карточку", "Hide the card")} onClick={() => (selectedTech.value = null)} />
    </aside>
  );
}

// Science as a full screen: era rail on the left, the era's register in the middle, the chosen tech on the right,
// the queue along the foot. The tree is the register's order, not a diagram to pan around.
export function TechPanel() {
  const [filter, setFilter] = useState<Filter>("all");
  const [era, setEra] = useState<number | null>(null);
  const v = techView.value;
  if (rightPanel.value !== "tech" || !v) return null;
  const sel = selectedTech.value ? v.nodes.get(selectedTech.value) : undefined;

  // The era in view: the player's pick, or the era they are actually in.
  const shownEra = era ?? v.era;
  const lane = v.lanes.find((l) => l.era === shownEra) ?? v.lanes[0];
  const keep = (n: TechNode): boolean =>
    filter === "all" || (filter === "available" ? n.state === "available" : filter === "locked" ? n.state === "locked" : n.state === "done");
  const rank = (n: TechNode): number =>
    n.state === "available" ? 0 : n.state === "active" ? 1 : n.state === "queued" ? 2 : n.state === "locked" ? 3 : 4;
  const c = lane.conditions;
  const shown = lane.domains.reduce((sum, d) => sum + d.nodes.filter(keep).length, 0);

  return (
    <div class="tech-screen" id={SEMANTIC_IDS.techPanel} role="dialog" aria-modal="false" aria-label={L("Наука", "Research")}>
      <div class="tech-sheet">
        <header class="tech-head">
          <h2 class="tech-title">{L("Наука", "Research")}</h2>
          <span class="tech-era-line">
            {L("Эпоха", "Era")} {eraLabel(v.era)} «{v.eraName}» · {L("изучено", "researched")} {v.techsDone} {L("из", "of")} {v.techsTotal}
          </span>
          <IconButton icon="close" size={18} label={L("Закрыть", "Close")} onClick={closePanel} />
        </header>
        <div class="tech-body">
          <Rail v={v} era={shownEra} setEra={setEra} filter={filter} setFilter={setFilter} />
          <div class="tech-ledger">
            <div class="tl-era-head">
              <span class="tl-era-title">
                {L("Эпоха", "Era")} {eraLabel(lane.era)} «{lane.name}»
              </span>
              <span class="tl-count">
                {lane.open ? L("идёт", "current") : L("закрыта", "locked")} · {shown} {L("технол.", "tech.")}
              </span>
            </div>
            {c && !lane.open && (
              <p class="tl-cond">
                {L("Откроется, когда: жители", "Opens when: residents")} {Math.min(c.pop, c.popNeed)}/{c.popNeed}, {L("технологии эпохи I", "era I technologies")}{" "}
                {Math.min(c.techs, c.techsNeed)}/{c.techsNeed}.
              </p>
            )}
            {lane.domains.map((d) => {
              const nodes = d.nodes.filter(keep).sort((x, y) => rank(x) - rank(y));
              return (
                <Group
                  key={d.id}
                  dom={d.id}
                  title={d.name}
                  count={d.nodes.length}
                  available={d.nodes.filter((n) => n.state === "available").length}
                  nodes={nodes}
                />
              );
            })}
            {shown === 0 && <p class="tl-empty">{L("Здесь пока ничего нет.", "Nothing here yet.")}</p>}
          </div>
          {sel ? (
            <Leaf n={sel} />
          ) : (
            <aside class="tech-leaf tech-leaf-empty">
              <h2 class="tr-cap">{L("Технология", "Technology")}</h2>
              <p class="tl-leaf-text">{L("Выберите строку в реестре: здесь появятся время, предпосылки и то, что технология открывает.", "Pick a row in the register: its time, prerequisites and what it unlocks will appear here.")}</p>
            </aside>
          )}
        </div>
        <Desk v={v} />
      </div>
    </div>
  );
}

// The study desk along the foot: the tech under way is a leaf read through a loupe whose rim fills as the work goes;
// the queue hangs beside it as leaves pinned to the wall, a bare nail for each free place.
function Desk({ v }: { v: TechView }) {
  const a = v.active;
  const done = a ? Math.floor(a.share * 100) : 0;
  return (
    <footer class="tech-foot">
      <div class={`tf-desk${a ? " on" : ""}`}>
        <div
          class="tf-loupe"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={done}
          aria-label={a ? L(`${a.name}: готово ${done} %`, `${a.name}: ${done}% done`) : L("Под лупой пусто", "Nothing under the loupe")}
        >
          <div class="tf-glass">
            {a && (
              <div class={`tf-leaf dom-${a.domain}`} key={a.id}>
                <span class="tf-leaf-name">{a.name}</span>
              </div>
            )}
          </div>
          <svg class="tf-frame" viewBox="0 0 132 132" aria-hidden="true">
            <path class="tf-handle" d="M88 88 L124 124" />
            <circle class="tf-rim" cx="54" cy="54" r="46" />
            <circle class="tf-done" cx="54" cy="54" r="46" pathLength={100} style={{ strokeDashoffset: 100 - done }} />
            <path class="tf-glint" d="M26 44 A30 30 0 0 1 42 24" />
          </svg>
        </div>
        {a ? (
          <div class="tf-now">
            <span class="tr-cap">{L("Исследуется", "Researching")}</span>
            <button type="button" class="link tf-name" onClick={() => select(a.id)}>
              {a.name}
            </button>
            <span class="tl-why">
              {done}
              {L(" %, осталось", "%, left:")} {formatDays(a.days)}
            </span>
            <Button variant="danger" class="tf-cancel" onClick={() => void cancelTech(a.id)}>
              {L("Отменить", "Cancel")}
            </Button>
          </div>
        ) : (
          <p class="tf-idle" role="status">
            {L("Наука простаивает: выберите, что изучать.", "Research is idle: choose what to study.")}
          </p>
        )}
      </div>
      <div class="tf-wall" role="group" aria-label={L("Очередь исследований", "Research queue")}>
        <span class="tr-cap tf-wall-cap">
          {L("В очереди", "Queued")} {v.queue.length} {L("из", "of")} {MAX_QUEUE}
        </span>
        {Array.from({ length: MAX_QUEUE }, (_, i) => {
          const q = v.queue[i];
          if (!q) return <span key={`nail-${i}`} class="tf-nail" aria-hidden="true" />;
          const { node, waits } = q;
          return (
            <div key={node.id} class={`tf-note dom-${node.domain}`} style={{ "--i": i }}>
              <i class="tf-pin" aria-hidden="true" />
              <button type="button" class="tf-note-body" onClick={() => select(node.id)}>
                <span class="tf-note-name">{node.name}</span>
                <span class="tf-note-sub">{waits ? `${L("ждёт", "waits for")}: ${waits}` : formatDays(node.days)}</span>
              </button>
              <IconButton icon="close" size={12} label={`${L("Убрать из очереди", "Remove from queue")}: ${node.name}`} onClick={() => void cancelTech(node.id)} />
            </div>
          );
        })}
      </div>
    </footer>
  );
}
