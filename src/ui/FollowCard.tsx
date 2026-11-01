import { calendar } from "../sim/clock";
import { isWorkHour } from "../sim/levers";
import { START_MINUTE_OF_DAY } from "../sim/time";
import { gameClock, gameNow, lifeTrips, state } from "../simClient";
import { followed, followInfo, stopFollowing } from "./follow";
import { followStatus, residentWalk } from "./followModel";
import { Icon } from "./Icon";
import { IconButton, Panel } from "./kit";
import { NeedsBars } from "./NeedsBars";

// Small card in the centre column while the camera follows one resident (src/ui/FollowCamera.tsx).
export function FollowCard() {
  const target = followed.value;
  const info = followInfo.value;
  void gameClock.value; // subscribe: the card re-renders as the game clock moves the resident along the walk
  if (!target) return null;
  const now = gameNow();
  const minute = (((now + START_MINUTE_OF_DAY) % 1440) + 1440) % 1440;
  const working = isWorkHour(calendar(now).hour, state.value?.levers);
  const walk = residentWalk(lifeTrips.value, target.id, minute);
  const status = followStatus(info, walk, working);
  return (
    <Panel class={`follow-card follow-${status.key}`} role="status" aria-live="polite">
      <div class="follow-head">
        <strong>
          <Icon name="locate" size={16} /> {target.name}
        </strong>
        <IconButton icon="close" label="Перестать следить" size={16} onClick={stopFollowing} />
      </div>
      <div class="follow-status">{status.text}</div>
      <div class="people-note">{info ? info.role : "Данных о жителе нет"}</div>
      {info?.needs && <NeedsBars needs={info.needs} />}
      {info?.problems && info.problems.length > 0 && <div class="prod-warn">Тяжело: {info.problems.join(", ")}</div>}
      {typeof info?.work === "number" && info.work < 0.95 && <div class="people-note">Силы к работе: {Math.round(info.work * 100)} %</div>}
    </Panel>
  );
}
