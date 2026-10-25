import { useEffect, useState } from "preact/hooks";
import { state } from "../simClient";
import type { GoalView } from "../sim/goals";
import { num } from "./buildMenu";
import { rewardParts } from "./goalsModel";
import { compactScreen } from "../map/motion";
import { Icon } from "./Icon";
import { Panel, ProgressBar } from "./kit";
import { goalFlash } from "./toastStore";

const figure = (g: GoalView) => `${num(g.value)} / ${num(g.target)}${g.unit ? ` ${g.unit}` : ""}`;

const KEY = "rebirth.goals.collapsed";
const readCollapsed = (): boolean => {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? compactScreen() : v === "1";
  } catch {
    return false;
  }
};

const FLASH_MS = 5000;

// Three active goals with progress and the reward listed up front; the next goal of the chain fills a freed slot.
// Collapsible (remembered); a finished goal lights the panel up for a few seconds.
export function GoalsTracker() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [flashing, setFlashing] = useState<string | null>(null);
  const flash = goalFlash.value;
  useEffect(() => {
    if (!flash) return;
    setFlashing(flash.text);
    const id = setTimeout(() => setFlashing(null), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash?.n]);
  const goals = state.value?.goalViews;
  if (!goals || goals.length === 0) return null;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // storage unavailable: the state just is not remembered
    }
  };
  return (
    <Panel class={`goals${flashing ? " goals-flash" : ""}`} role="region" aria-label="Цели">
      <button class="goals-head" aria-expanded={!collapsed} aria-controls="goals-body" onClick={toggle}>
        <span class="goals-title">Цели</span>
        {collapsed && <span class="goals-count">{goals.length}</span>}
        <Icon name={collapsed ? "caretDown" : "caretUp"} size={14} />
      </button>
      {flashing && (
        <div class="goals-done" role="status">
          <Icon name="check" size={14} /> {flashing}
        </div>
      )}
      <ul class="goals-list" id="goals-body" hidden={collapsed}>
        {goals.map((g) => (
          <li class="goal" key={g.id}>
            <div class="goal-head">
              <span class="goal-name">{g.title}</span>
              {g.target > 1 && <span class="goal-fig">{figure(g)}</span>}
            </div>
            {g.target > 1 && <ProgressBar value={g.value / g.target} label={g.title} />}
            <div class="goal-reward">
              <span class="goal-reward-label">Награда:</span>
              {rewardParts(g.reward).map((r) => (
                <span class="goal-reward-item" key={r.text}>
                  <Icon name={r.icon} size={13} />
                  {r.text}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
