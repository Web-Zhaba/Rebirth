import { selectedSite, typedFoundations } from "../map/heritageSpots";
import { flash } from "../map/tools";
import { articles, sendCmd, state } from "../simClient";
import { buildHeritageView, type HeritageView } from "./heritageModel";
import { InspectorHead, Line, num } from "./InspectorParts";
import { Button } from "./kit";
import { closePanel, rightPanel } from "./panels";
import { areaText } from "./inspectorModel";
import "./heritage.css";
import { SEMANTIC_IDS } from "./semanticIds";
import { decimal, L } from "../i18n";

function Body({ v }: { v: HeritageView }) {
  const order = async () => {
    const r = await sendCmd({ type: "placeOnFoundation", template: v.template, foundationId: v.id });
    if (!r.ok) flash(r.reason ?? L("Не вышло", "That didn't work"));
  };
  return (
    <>
      <div class="insp-sub">
        {v.kind} · {v.domainName}
      </div>
      <Line label={L("Площадь", "Area")}>{areaText(v.area)} ({Math.round(v.area)} {L("м²", "m²")})</Line>
      {v.height !== null && (
        <Line label={L("Высота", "Height")}>
          {v.height} {L("м", "m")} · {L("этажей", "floors")} {v.floors}
        </Line>
      )}
      {v.state !== null ? (
        <div class="people-note" role="status">{v.note}</div>
      ) : (
        <>
          <div class="her-opt her-picked">
            <span class="her-opt-body">
              <b>{L(`Как было: ${v.purpose}`, `As it was: ${v.purpose}`)}</b>
              {v.effects.map((e) => (
                <span key={e}>{e}</span>
              ))}
              <span class="her-gain">{v.research}</span>
              {v.insight && <span>{L("Идея", "Idea")} {v.insight}</span>}
            </span>
          </div>
          <Line label={L("Цена", "Cost")} icon="hourglass">
            {L(`${num(v.cost.labor)} чел.-ч · брёвна ${num(v.cost.logs)} м³ · доски ${num(v.cost.planks)} м³ · камень ${num(v.cost.stone)} т`, `${num(v.cost.labor)} person-h · logs ${num(v.cost.logs)} m³ · planks ${num(v.cost.planks)} m³ · stone ${num(v.cost.stone)} t`)}
          </Line>
          {v.mul > 1 && <div class="people-note">{L("Таких построек в округе мало: вклад в науку ×", "Few buildings like this nearby: research contribution ×")}{decimal(String(v.mul))}</div>}
          {v.repeat && (
            <div class="people-note">
              {L(`Ещё один ${v.repeat.kind.toLowerCase()}: вклад ×${decimal(String(v.repeat.factor))}, идеи не будет`, `Another ${v.repeat.kind.toLowerCase()}: contribution ×${decimal(String(v.repeat.factor))}, no idea`)}
            </div>
          )}
          {v.note && <div class="prod-warn">{v.note}</div>}
          <div class="insp-actions">
            <Button variant="primary" disabled={!v.canOrder} onClick={() => void order()}>
              {L("Восстановить как было", "Restore as it was")}
            </Button>
          </div>
          <div class="people-note">
            {L("Другое назначение, и памятник тоже, выбирают в строительстве, наведя здание на фундамент: так постройка не даст вклада в науку. Снос восстановленной постройки делает её утраченной.", "Another purpose, a monument included, is chosen in the build bar by pointing a building at the foundation: it then adds nothing to research. Demolishing a restored building loses it for good.")}
          </div>
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

// A typed old building picked on the map: what it is, what bringing it back as it was costs and gives.
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
