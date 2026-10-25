import type { IconName } from "./icons";

// Pure helpers of the goals tracker.

const REWARD_ICONS: [RegExp, IconName][] = [
  [/лесопилк/i, "sawpit"],
  [/склад/i, "barn"],
  [/карьер/i, "quarry"],
  [/ремесл/i, "craft"],
  [/рыболов/i, "fisher"],
  [/огород/i, "garden"],
  [/охотн/i, "hunter"],
  [/семь/i, "person"],
  [/торгов/i, "trade"],
  [/рынок/i, "market"],
  [/храм/i, "chapel"],
  [/праздник/i, "gumno"],
  [/школ/i, "school"],
  [/лечебниц/i, "healer"],
  [/дом/i, "res"],
  [/тетрад|статья/i, "notebook"],
];

// «лесопилка, склад» -> one entry per reward with its icon (a flag when nothing fits).
export function rewardParts(reward: string): { text: string; icon: IconName }[] {
  return reward
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ text, icon: REWARD_ICONS.find(([re]) => re.test(text))?.[1] ?? "flag" }));
}
