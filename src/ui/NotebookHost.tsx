import type { View } from "../view/view";
import { articleMapMpp, articleMapTarget } from "./articleMapModel";
import { computed } from "@preact/signals";
import { useState } from "preact/hooks";
import { articles, buildings, chronicle, digs, finds, sendCmd } from "../simClient";
import { findsView } from "./findsModel";
import { flash } from "../map/tools";
import { L } from "../i18n";
import { Notebook } from "./Notebook";
import { findsToEntries, readSeen, writeSeen } from "./notebookLogic";
import { openPanel, rightPanel } from "./panels";

// Recomputed only when the finds change (the worker sends them only then) or a dig appears.
const entries = computed(() =>
  findsToEntries(
    finds.value,
    digs.value.map((d) => d.id),
  ),
);

// The finds found so far, by theme: recomputed when the finds, the buildings or the articles change.
const items = computed(() => {
  const f = finds.value;
  const b = buildings.value;
  return f && b ? findsView({ finds: f, buildings: b, articles: articles.value }) : [];
});

// Wires the notebook to the town. It shares the right slot with the inspector and the town panel (panels.ts).
export function NotebookHost({ view }: { view: View }) {
  const open = rightPanel.value === "notebook";
  const [seen, setSeen] = useState(readSeen);

  const onOpenChange = (next: boolean) => openPanel(next ? "notebook" : null);
  const onSeen = (n: number) => {
    setSeen(n);
    writeSeen(n);
  };

  const onArticleMap = (article: (typeof articles.value)[number]) => {
    const target = articleMapTarget(article);
    if (!target) return;
    view.flyTo({ center: target, mpp: articleMapMpp(view.metersPerPixel()) });
  };

  const onItem = async (action: "return" | "use", id: string) => {
    const r = await sendCmd(action === "return" ? { type: "returnFind", id } : { type: "useFind", id });
    if (!r.ok) flash(r.reason ?? L("Не вышло", "That didn't work"));
  };

  return <Notebook finds={entries.value} items={items.value} onItem={(a, id) => void onItem(a, id)} articles={articles.value} chronicle={chronicle.value} seen={seen} onSeen={onSeen} open={open} onOpenChange={onOpenChange} onArticleMap={onArticleMap} />;
}
