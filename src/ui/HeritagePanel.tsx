import { useEffect, useState } from "preact/hooks";
import { selectedSite, typedFoundations } from "../map/heritageSpots";
import { flash } from "../map/tools";
import { articles, sendCmd, state } from "../simClient";
import type { RestoreMode } from "../sim/types";
import { buildHeritageView, type HeritageView, type ModeOption } from "./heritageModel";
import { InspectorHead, Line, num } from "./InspectorParts";
import { Button } from "./kit";
import { closePanel, rightPanel } from "./panels";
import { areaText } from "./inspectorModel";
import "./heritage.css";
import { SEMANTIC_IDS } from "./semanticIds";
import { decimal, L } from "../i18n";

function Option({ o, picked, onPick }: { o: ModeOption; picked: boolean; onPick: () => void }) {
  return (
    <label class={`her-opt${picked ? " her-picked" : ""}${o.available ? "" : " her-closed"}`}>
      <input type="radio" name="restore-mode" checked={picked} disabled={!o.available} onChange={onPick} />
      <span class="her-opt-body">
        <b>{o.label}</b>
        {o.effects.map((e) => (
          <span key={e}>{e}</span>
        ))}
        <span class="her-gain">{o.research}</span>
        {o.insight && <span>{L("Идея", "Idea")} {o.insight}</span>}
        {o.why && <span class="prod-warn">{L("Недоступно:", "Unavailable:")} {o.why}</span>}
      </span>
    </label>
  );
}

function Body({ v }: { v: HeritageView }) {
  const first = v.options.find((o) => o.available);
  const [mode, setMode] = useState<RestoreMode | null>(first?.mode ?? null);
  useEffect(() => setMode(first?.mode ?? null), [v.id, first?.mode]);
  const pick = v.options.find((o) => o.mode === mode && o.available);
  const order = async () => {
    if (!pick) return;
    const r = await sendCmd({ type: "restoreSite", siteId: v.id, mode: pick.mode });
    if (!r.ok) flash(r.reason ?? L("Не вышло", "That didn't work"));
  };
  return (
    <>
      <div class="insp-sub">
        {v.kind} · {v.domainName}
      </div>
      <Line label={L("Площадь", "Area")}>{areaText(v.area)} ({Math.round(v.area)} {L("м²", "m²")})</Line>
      {v.height !== null && <Line label={L("Высота", "Height")}>{v.height} {L("м", "m")}</Line>}
      {v.state !== null ? (
        <div class="people-note" role="status">{v.stateText}</div>
      ) : (
        <>
          <Line label={L("Цена", "Cost")} icon="hourglass">
            {L(`${num(v.cost.labor)} чел.-ч · брёвна ${num(v.cost.logs)} м³ · доски ${num(v.cost.planks)} м³ · камень ${num(v.cost.stone)} т`, `${num(v.cost.labor)} person-h · logs ${num(v.cost.logs)} m³ · planks ${num(v.cost.planks)} m³ · stone ${num(v.cost.stone)} t`)}
          </Line>
          {v.mul > 1 && <div class="people-note">{L("Таких построек в округе мало: вклад в науку ×", "Few buildings like this nearby: research contribution ×")}{decimal(String(v.mul))}</div>}
          {v.repeat && (
            <div class="people-note">
              {L(`Ещё один ${v.repeat.kind.toLowerCase()}: вклад ×${decimal(String(v.repeat.factor))}, идеи не будет`, `Another ${v.repeat.kind.toLowerCase()}: contribution ×${decimal(String(v.repeat.factor))}, no idea`)}
            </div>
          )}
          <fieldset class="her-opts">
            <legend>{L("Как восстановить", "How to restore")}</legend>
            {v.options.map((o) => (
              <Option key={o.mode} o={o} picked={mode === o.mode} onPick={() => setMode(o.mode)} />
            ))}
          </fieldset>
          {!v.canOrder && v.note && <div class="prod-warn">{v.note}</div>}
          <div class="insp-actions">
            <Button variant="primary" disabled={!pick} onClick={() => void order()}>
              {L("Восстановить", "Restore")}
            </Button>
          </div>
          <div class="people-note">{L("Выбор окончательный: сменить его можно только сносом, а снос делает постройку утраченной.", "The choice is final: only demolition can change it, and demolition loses the building for good.")}</div>
        </>
      )}
      {v.article && (
        <a class="link" href={v.article.url} target="_blank" rel="noopener noreferrer">
          {L("Статья:", "Article:")} {v.article.title}
        </a>
      )}
    </>
  );
}

// A typed old building picked on the map: what it is, what restoring it costs and gives in each mode.
export function HeritagePanel() {
  const id = selectedSite.value;
  const st = state.value;
  if (rightPanel.value !== "heritage" || id === null || !st) return null;
  const site = st.finds.foundations.find((f) => f.id === id) ?? typedFoundations.value.find((t) => t.id === id);
  if (!site) return null;
  const v = buildHeritageView({ site, sim: st, mul: st.heritageMul, articles: articles.value });
  return (
    <aside class="rs-panel inspector panel her-panel" aria-labelledby={SEMANTIC_IDS.heritageInspectorTitle}>
      <InspectorHead icon="foundations" title={v.title} chip={v.stateText ? { label: v.stateText, tone: v.state === "lost" ? "bad" : v.state === "restored" ? "ok" : "build" } : undefined} onClose={closePanel} headingId={SEMANTIC_IDS.heritageInspectorTitle} />
      <Body v={v} />
    </aside>
  );
}
