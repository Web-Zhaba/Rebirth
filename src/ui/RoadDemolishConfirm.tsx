import { ROAD_KINDS } from "../sim/roads";
import { roads, sendCmd } from "../simClient";
import { roadDemolishRequest } from "../map/roadTool";
import { flash } from "../map/tools";
import { play } from "./sound";
import { Confirm } from "./kit";
import { L } from "../i18n";

export function RoadDemolishConfirm() {
  const id = roadDemolishRequest.value;
  if (id === null) return null;
  const edge = roads.value?.edges[id];
  if (!edge) {
    roadDemolishRequest.value = null;
    return null;
  }
  const close = () => (roadDemolishRequest.value = null);
  const remove = () => {
    close();
    void sendCmd({ type: "removeRoad", edgeId: id }).then((r) => {
      if (!r.ok) flash(r.reason ?? L("Не удалось снести", "Could not demolish"));
      else play("place");
    });
  };
  return (
    <Confirm title={L(`Снести: ${ROAD_KINDS[edge.kind].name}?`, `Demolish: ${ROAD_KINDS[edge.kind].name}?`)} okLabel={L("Снести", "Demolish")} onOk={remove} onCancel={close}>
      {L(`Построенный участок длиной ${Math.round(edge.length)} м будет удалён. Потраченные материалы и работа не вернутся.`, `The built section, ${Math.round(edge.length)} m long, will be removed. Materials and work spent on it are not returned.`)}
    </Confirm>
  );
}
