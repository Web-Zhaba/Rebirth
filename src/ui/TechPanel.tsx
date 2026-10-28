import { Icon } from "./Icon";
import { Button, IconButton, ProgressBar } from "./kit";
import { closePanel, rightPanel } from "./panels";
import { cancelTech, queueTech, selectedTech, startTech, techView } from "./techState";
import { eraLabel, formatDays, type TechLane, type TechNode, type TechView } from "./techModel";
import { MAX_QUEUE } from "../sim/tech";
import "./tech.css";
import { SEMANTIC_IDS } from "./semanticIds";

const speedText = (v: number): string => `×${v.toFixed(2).replace(/0$/, "").replace(".", ",")}`;
const select = (id: string): void => {
  selectedTech.value = selectedTech.peek() === id ? null : id;
};

function Header({ v }: { v: TechView }) {
  return (
    <>
      <div class="insp-head">
        <span class="insp-ic">
          <Icon name="scroll" size={28} />
        </span>
        <div class="insp-title">
          <h2>Наука</h2>
          <span class="insp-sub">
            Эпоха {eraLabel(v.era)} «{v.eraName}» · изучено {v.techsDone} из {v.techsTotal}
          </span>
        </div>
        <IconButton icon="close" size={16} label="Закрыть" onClick={closePanel} />
      </div>
      <ul class="tech-speeds" aria-label="Скорость исследований по областям">
        {v.speeds.map((s) => (
          <li key={s.id} class={`tech-speed dom-${s.id}`}>
            <span>{s.name}</span> <b>{speedText(s.speed)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

function Queue({ v }: { v: TechView }) {
  const a = v.active;
  return (
    <section class="tech-queue" aria-label="Очередь исследований">
      {a ? (
        <div class="tech-now">
          <div class="tech-now-row">
            <button type="button" class="link tech-now-name" onClick={() => select(a.id)}>
              Исследуется: {a.name}
            </button>
            <IconButton icon="close" size={14} label={`Отменить исследование: ${a.name}`} onClick={() => void cancelTech(a.id)} />
          </div>
          <ProgressBar value={a.share} label={`${a.name}: готово ${Math.floor(a.share * 100)} %`} />
          <span class="tech-note">
            {Math.floor(a.share * 100)} %, осталось {formatDays(a.days)}
          </span>
        </div>
      ) : (
        <p class="tech-idle" role="status">
          Наука простаивает: выберите, что изучать.
        </p>
      )}
      {v.queue.length > 0 && (
        <ol class="tech-q-list" aria-label={`В очереди ${v.queue.length} из ${MAX_QUEUE}`}>
          {v.queue.map(({ node, waits }) => (
            <li key={node.id}>
              <button type="button" class="link" onClick={() => select(node.id)}>
                {node.name}
              </button>
              {waits && <span class="tech-note"> · ждёт: {waits}</span>}
              <IconButton icon="close" size={14} label={`Убрать из очереди: ${node.name}`} onClick={() => void cancelTech(node.id)} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Card({ n }: { n: TechNode }) {
  return (
    <section class={`tech-card dom-${n.domain}`} aria-label={`Технология: ${n.name}`}>
      <div class="tech-card-head">
        <h3>{n.name}</h3>
        <span class="tech-note">Эпоха {eraLabel(n.era)}</span>
        <IconButton icon="close" size={14} label="Скрыть карточку" onClick={() => (selectedTech.value = null)} />
      </div>
      <p>{n.description}</p>
      <dl class="tech-facts">
        <dt>Состояние</dt>
        <dd>{n.statusText}</dd>
        {n.state !== "done" && (
          <>
            <dt>Время</dt>
            <dd>
              {formatDays(n.days)}
              {n.state === "active" ? " осталось" : ""} (базовое {n.baseDays} дн.)
            </dd>
          </>
        )}
        {n.requires.length > 0 && (
          <>
            <dt>Требует</dt>
            <dd>{n.requires.map((r) => `${r.name}${r.done ? " (изучено)" : ""}`).join(", ")}</dd>
          </>
        )}
        {n.opens.length > 0 && (
          <>
            <dt>Открывает</dt>
            <dd>{n.opens.join(", ")}</dd>
          </>
        )}
        {n.insight && (
          <>
            <dt>Идея</dt>
            <dd>
              «{n.insight.text}»: время короче на {Math.round(n.insight.cut * 100)} %
            </dd>
          </>
        )}
      </dl>
      <div class="tech-actions">
        {n.canStart && (
          <Button variant="primary" onClick={() => void startTech(n.id)}>
            Исследовать
          </Button>
        )}
        {n.canQueue && <Button onClick={() => void queueTech(n.id)}>В очередь</Button>}
        {n.canCancel && (
          <Button variant="danger" onClick={() => void cancelTech(n.id)}>
            {n.state === "queued" ? "Убрать из очереди" : "Отменить"}
          </Button>
        )}
      </div>
    </section>
  );
}

function Node({ n }: { n: TechNode }) {
  return (
    <li>
      <button type="button" class={`tech-node tn-${n.state}`} aria-pressed={selectedTech.value === n.id} onClick={() => select(n.id)}>
        <span class="tn-name">
          {n.state === "done" && <Icon name="check" size={12} />}
          {n.state === "locked" && <Icon name="lock" size={12} />}
          {n.name}
        </span>
        <span class="tn-state">{n.statusText}</span>
        {n.state === "active" && <span class="tn-bar" style={{ width: `${Math.floor(n.share * 100)}%` }} aria-hidden="true" />}
      </button>
    </li>
  );
}

function Lane({ lane }: { lane: TechLane }) {
  const c = lane.conditions;
  return (
    <section class={`tech-lane${lane.open ? "" : " tl-closed"}`} aria-label={`Эпоха ${eraLabel(lane.era)} «${lane.name}»`}>
      <h3 class="tech-lane-head">
        Эпоха {eraLabel(lane.era)} «{lane.name}»{!lane.open && <span class="tech-note"> · пока закрыта</span>}
      </h3>
      {c && (
        <p class="tech-cond">
          Откроется, когда: жители {Math.min(c.pop, c.popNeed)}/{c.popNeed}, технологии эпохи I {Math.min(c.techs, c.techsNeed)}/{c.techsNeed}.
        </p>
      )}
      <div class="tech-cols">
        {lane.domains.map((d) => (
          <div key={d.id} class={`tech-col dom-${d.id}`}>
            <h4>{d.name}</h4>
            <ul>
              {d.nodes.map((n) => (
                <Node key={n.id} n={n} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// Science panel (right slot): research speed, the queue, the tech card and the tree by eras and domains.
export function TechPanel() {
  const v = techView.value;
  if (rightPanel.value !== "tech" || !v) return null;
  const sel = selectedTech.value ? v.nodes.get(selectedTech.value) : undefined;
  return (
    <aside class="rs-panel tech-panel panel" id={SEMANTIC_IDS.techPanel} aria-label="Наука">
      <Header v={v} />
      <Queue v={v} />
      {sel && <Card n={sel} />}
      <div class="rs-body">
        {v.lanes.map((l) => (
          <Lane key={l.era} lane={l} />
        ))}
      </div>
    </aside>
  );
}
