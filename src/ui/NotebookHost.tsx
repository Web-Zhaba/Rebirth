import { computed, effect } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { selectedBuilding } from "../map/buildingLayer";
import { articles, chronicle, digs, finds } from "../simClient";
import { Notebook } from "./Notebook";
import { findsToEntries, readSeen, writeSeen } from "./notebookLogic";

// Recomputed only when the finds change (the worker sends them only then) or a dig appears.
const entries = computed(() =>
  findsToEntries(
    finds.value,
    digs.value.map((d) => d.id),
  ),
);

// Wires the notebook to the town. It shares the right edge with the building panel: only one of them is open.
export function NotebookHost() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);

  useEffect(
    () =>
      effect(() => {
        if (selectedBuilding.value !== null) setOpen(false);
      }),
    [],
  );

  const onOpenChange = (next: boolean) => {
    if (next) selectedBuilding.value = null;
    setOpen(next);
  };
  const onSeen = (n: number) => {
    setSeen(n);
    writeSeen(n);
  };

  return <Notebook finds={entries.value} articles={articles.value} chronicle={chronicle.value} seen={seen} onSeen={onSeen} open={open} onOpenChange={onOpenChange} />;
}
