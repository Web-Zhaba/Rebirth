import { useState } from "preact/hooks";
import { platform } from "../platform";
import { act } from "./InspectorParts";
import { Button } from "./kit";
import { L } from "../i18n";

type Phase = "idle" | "showing" | "done" | "missed";

// Supplies for watching a rewarded ad (the sim's grantSupplies), taken once per card. Nothing where the portal has no
// rewarded ads (the standalone build).
export function SuppliesOffer() {
  const [phase, setPhase] = useState<Phase>("idle");
  const show = platform.rewarded;
  if (!show) return null;
  if (phase === "done") return <p class="supplies-note" role="status">{L("Припасы прибыли в поселение.", "The supplies have arrived in the settlement.")}</p>;
  const watch = async () => {
    setPhase("showing");
    const earned = await show();
    if (earned) act({ type: "grantSupplies" });
    setPhase(earned ? "done" : "missed");
  };
  return (
    <div class="supplies-offer">
      <Button icon="gumno" disabled={phase === "showing"} onClick={watch}>
        {L("Припасы за просмотр рекламы", "Supplies for watching an ad")}
      </Button>
      {phase === "missed" && <p class="supplies-note" role="status">{L("Реклама не досмотрена, припасов нет.", "The ad was not watched to the end, no supplies.")}</p>}
    </div>
  );
}
