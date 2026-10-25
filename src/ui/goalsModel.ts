import type { IconName } from "./icons";

// Pure helpers of the goals tracker.

const REWARD_ICONS: [RegExp, IconName][] = [
  [/пильня/i, "sawpit"],
  [/амбар/i, "barn"],
  [/каменолом/i, "quarry"],
  [/ремесл/i, "craft"],
  [/рыбак/i, "fisher"],
  [/семь/i, "person"],
  [/торгов/i, "trade"],
  [/рынок/i, "market"],
  [/часовн/i, "chapel"],
  [/праздник/i, "gumno"],
  [/школ/i, "school"],
  [/лекарь/i, "healer"],
  [/изб/i, "res"],
  [/тетрад|статья/i, "notebook"],
];

// «пильня, амбар» -> one entry per reward with its icon (a flag when nothing fits).
export function rewardParts(reward: string): { text: string; icon: IconName }[] {
  return reward
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ text, icon: REWARD_ICONS.find(([re]) => re.test(text))?.[1] ?? "flag" }));
}
