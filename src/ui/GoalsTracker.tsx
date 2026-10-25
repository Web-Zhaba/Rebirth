import { state } from "../simClient";
import type { GoalView } from "../sim/goals";
import { num } from "./buildMenu";
import { Icon } from "./Icon";
import { Panel, ProgressBar } from "./kit";

const figure = (g: GoalView) => `${num(g.value)} / ${num(g.target)}${g.unit ? ` ${g.unit}` : ""}`;

// Three active goals with progress and the reward listed up front; the next goal of the chain fills a freed slot.
export function GoalsTracker() {
  const goals = state.value?.goalViews;
  if (!goals || goals.length === 0) return null;
  return (
    <Panel class="goals" role="region" aria-label="Цели">
      <div class="goals-title">Цели</div>
      <ul class="goals-list">
        {goals.map((g) => (
          <li class="goal" key={g.id}>
            <div class="goal-head">
              <span class="goal-name">{g.title}</span>
              {g.target > 1 && <span class="goal-fig">{figure(g)}</span>}
            </div>
            {g.target > 1 && <ProgressBar value={g.value / g.target} label={g.title} />}
            <div class="goal-reward">
              <Icon name="check" size={12} />
              <span>Награда: {g.reward}</span>
            </div>
            {g.hint && <div class="goal-hint">{g.hint}</div>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
