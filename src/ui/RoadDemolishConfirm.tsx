import { ROAD_KINDS } from "../sim/roads";
import { roads, sendCmd } from "../simClient";
import { flash, roadDemolishRequest } from "../map/roadTool";
import { play } from "./sound";
import { Confirm } from "./kit";

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
      if (!r.ok) flash(r.reason ?? "Не удалось снести");
      else play("place");
    });
  };
  return (
    <Confirm title={`Снести: ${ROAD_KINDS[edge.kind].name}?`} okLabel="Снести" onOk={remove} onCancel={close}>
      Построенный участок длиной {Math.round(edge.length)} м будет удалён. Потраченные материалы и работа не вернутся.
    </Confirm>
  );
}
