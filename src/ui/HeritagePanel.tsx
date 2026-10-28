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
        {o.insight && <span>Идея {o.insight}</span>}
        {o.why && <span class="prod-warn">Недоступно: {o.why}</span>}
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
    if (!r.ok) flash(r.reason ?? "Не вышло");
  };
  return (
    <>
      <div class="insp-sub">
        {v.kind} · {v.domainName}
      </div>
      <Line label="Площадь">{areaText(v.area)} ({Math.round(v.area)} м²)</Line>
      {v.height !== null && <Line label="Высота">{v.height} м</Line>}
      {v.state !== null ? (
        <div class="people-note" role="status">{v.stateText}</div>
      ) : (
        <>
          <Line label="Цена" icon="hourglass">
            {num(v.cost.labor)} чел.-ч · брёвна {num(v.cost.logs)} м³ · доски {num(v.cost.planks)} м³ · камень {num(v.cost.stone)} т
          </Line>
          {v.mul > 1 && <div class="people-note">Таких построек в округе мало: вклад в науку ×{String(v.mul).replace(".", ",")}</div>}
          {v.repeat && (
            <div class="people-note">
              Ещё один {v.repeat.kind.toLowerCase()}: вклад ×{String(v.repeat.factor).replace(".", ",")}, идеи не будет
            </div>
          )}
          <fieldset class="her-opts">
            <legend>Как восстановить</legend>
            {v.options.map((o) => (
              <Option key={o.mode} o={o} picked={mode === o.mode} onPick={() => setMode(o.mode)} />
            ))}
          </fieldset>
          {!v.canOrder && v.note && <div class="prod-warn">{v.note}</div>}
          <div class="insp-actions">
            <Button variant="primary" disabled={!pick} onClick={() => void order()}>
              Восстановить
            </Button>
          </div>
          <div class="people-note">Выбор окончательный: сменить его можно только сносом, а снос делает постройку утраченной.</div>
        </>
      )}
      {v.article && (
        <a class="link" href={v.article.url} target="_blank" rel="noopener noreferrer">
          Статья: {v.article.title}
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
