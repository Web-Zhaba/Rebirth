import type { View } from "../view/view";
import { DaySummary } from "./DaySummary";
import { FollowCard } from "./FollowCard";
import "./feedback.css";
import { LANDMARK_LABELS } from "./semanticModel";

// Centre of the screen under the top bar: transient day summaries and the follow card belong here.
// Persistent research status lives in the left HUD column with the other status chips.
export function CentreColumn({ view }: { view: View }) {
  return (
    <section class="centre-col" aria-label={LANDMARK_LABELS.summaries}>
      <FollowCard />
      <DaySummary view={view} />
    </section>
  );
}
