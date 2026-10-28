import type * as maplibregl from "maplibre-gl";
import { flyOrJump } from "../map/motion";
import { articleMapTarget, articleMapZoom } from "./articleMapModel";
import { computed } from "@preact/signals";
import { useState } from "preact/hooks";
import { articles, chronicle, digs, finds } from "../simClient";
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

// Wires the notebook to the town. It shares the right slot with the inspector and the town panel (panels.ts).
export function NotebookHost({ map }: { map: maplibregl.Map }) {
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
    flyOrJump(map, { center: target, zoom: articleMapZoom(map.getZoom()) });
  };

  return <Notebook finds={entries.value} articles={articles.value} chronicle={chronicle.value} seen={seen} onSeen={onSeen} open={open} onOpenChange={onOpenChange} onArticleMap={onArticleMap} />;
}
