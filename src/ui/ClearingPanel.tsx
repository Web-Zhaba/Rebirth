import { useEffect, useState } from "preact/hooks";
import { isCleared } from "../sim/clearing";
import { queuedLabel } from "../sim/clock";
import { selectedClearing } from "../view/layers/land";
import { tool } from "../map/tools";
import { gameClock, state } from "../simClient";
import { act, InspectorHead, Line, num, siteEta, SiteLevers } from "./InspectorParts";
import { areaText, clearingView } from "./inspectorModel";
import { Button, Confirm, ProgressBar } from "./kit";
import { closePanel, rightPanel } from "./panels";
import { SEMANTIC_IDS } from "./semanticIds";
import { L } from "../i18n";

// Inspector of an unfinished clearing (right slot). Its lever key is -id.
export function ClearingPanel() {
  const [confirming, setConfirming] = useState(false);
  const id = selectedClearing.value;
  const c = id === null ? undefined : state.value?.clearings.find((x) => x.id === id);
  const gone = id !== null && state.value !== null && (!c || isCleared(c));
  // A finished or removed clearing leaves the selection.
  useEffect(() => {
    if (gone) selectedClearing.value = null;
  }, [gone]);
  useEffect(() => setConfirming(false), [id]);
  if (!c || gone || tool.value || rightPanel.value !== "inspector") return null;
  const v = clearingView(c);
  const key = -c.id;
  const queued = queuedLabel(gameClock.value, state.value?.levers);
  const onRemove = () => {
    act({ type: "removeClearing", id: c.id });
    selectedClearing.value = null;
  };
  return (
    <aside class="rs-panel inspector panel" aria-labelledby={SEMANTIC_IDS.clearingInspectorTitle}>
      <InspectorHead icon="clearing" title={L("Вырубка", "Clearing")} chip={{ label: L("рубят лес", "felling"), tone: "build" }} onClose={closePanel} headingId={SEMANTIC_IDS.clearingInspectorTitle} />
      <div class="insp-sub">
        {areaText(c.area)} · {L("лес", "forest")} {Math.round(c.forest * 100)}{L(" %", "%")}
      </div>
      <div class="insp-block">
        <ProgressBar big value={v.share} label={L("Вырубка", "Clearing")} />
        <Line icon="hourglass" label={L("Готово", "Done")}>
          {Math.floor(v.share * 100)}{L(" % · осталось", "% · left")} {num(v.remaining)} {L("чел.-ч", "person-h")}
        </Line>
        <Line icon="log" label={L("Брёвна", "Logs")}>
          {num(v.logsNow)} {L("из", "of")} {num(v.logsAll)} {L("м³", "m³")}
        </Line>
        <Line label={L("Ждать", "Wait")}>{siteEta(v.remaining, key) || "—"}</Line>
        {queued && <div class="people-note">{queued}</div>}
        <SiteLevers siteKey={key} />
      </div>
      <div class="people-note">{L("Брёвна идут на склад, а земля станет лугом, когда работа закончится.", "Logs go to the store, and the land turns into meadow once the work is done.")}</div>
      <div class="insp-actions">
        <Button variant="danger" icon="trash" aria-label={L("Убрать вырубку", "Remove clearing")} onClick={() => setConfirming(true)}>
          {L("Убрать вырубку", "Remove clearing")}
        </Button>
      </div>
      {confirming && (
        <Confirm title={L("Убрать вырубку?", "Remove the clearing?")} okLabel={L("Убрать", "Remove")} onOk={onRemove} onCancel={() => setConfirming(false)}>
          {L("Работа остановится. Уже полученные брёвна останутся на складе, участок можно отметить заново.", "Work stops. Logs already cut stay in the store; you can mark the area again.")}
        </Confirm>
      )}
    </aside>
  );
}
