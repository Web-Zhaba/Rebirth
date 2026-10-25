import { useEffect, useState } from "preact/hooks";
import { isCleared } from "../sim/clearing";
import { queuedLabel } from "../sim/clock";
import { selectedClearing } from "../map/zoneLayer";
import { tool } from "../map/tools";
import { gameClock, state } from "../simClient";
import { act, InspectorHead, Line, num, siteEta, SiteLevers } from "./InspectorParts";
import { areaText, clearingView } from "./inspectorModel";
import { Button, Confirm, ProgressBar } from "./kit";
import { closePanel, rightPanel } from "./panels";

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
    <div class="rs-panel inspector panel" role="region" aria-label="Вырубка">
      <InspectorHead icon="clearing" title="Вырубка" chip={{ label: "рубят лес", tone: "build" }} onClose={closePanel} />
      <div class="insp-sub">
        {areaText(c.area)} · лес {Math.round(c.forest * 100)} %
      </div>
      <div class="insp-block">
        <ProgressBar big value={v.share} label="Вырубка" />
        <Line icon="hourglass" label="Готово">
          {Math.floor(v.share * 100)} % · осталось {num(v.remaining)} чел.-ч
        </Line>
        <Line icon="log" label="Брёвна">
          {num(v.logsNow)} из {num(v.logsAll)} м³
        </Line>
        <Line label="Ждать">{siteEta(v.remaining, key) || "—"}</Line>
        {queued && <div class="people-note">{queued}</div>}
        <SiteLevers siteKey={key} />
      </div>
      <div class="people-note">Брёвна идут на склад, а земля станет лугом, когда работа закончится.</div>
      <div class="insp-actions">
        <Button variant="danger" icon="trash" aria-label="Убрать вырубку" onClick={() => setConfirming(true)}>
          Убрать вырубку
        </Button>
      </div>
      {confirming && (
        <Confirm title="Убрать вырубку?" okLabel="Убрать" onOk={onRemove} onCancel={() => setConfirming(false)}>
          Работа остановится. Уже полученные брёвна останутся на складе, участок можно отметить заново.
        </Confirm>
      )}
    </div>
  );
}
