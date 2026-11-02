import { effect } from "@preact/signals";
import type { Engine } from "../../engine/engine";
import { HIGHLIGHT, type Highlight } from "../../engine/frame/frameUniforms";
import { PALETTE } from "../../ui/palette";
import { contextLayerForTool } from "../../map/contextModel";
import { rgb } from "../../map/modelGeometry";
import { tool } from "../../map/tools";
import { ruinsAutoShown } from "../ruinsShown";

// What a tool needs to see on the ground, as the old map's context fills: the forest for the woodcutters and clearings,
// the water for the fishers, the wetlands and water a quarry cannot stand on, and the buried old city for digs.

const LOOKS: Record<"forest" | "water" | "quarry", Highlight> = {
  forest: { mode: HIGHLIGHT.wood, colour: rgb(PALETTE.ok), opacity: 0.3 },
  water: { mode: HIGHLIGHT.water, colour: rgb(PALETTE.info), opacity: 0.32 },
  quarry: { mode: HIGHLIGHT.wetOrWater, colour: rgb(PALETTE.bad), opacity: 0.28 },
};

export function attachToolContext(engine: Engine): void {
  effect(() => {
    const context = contextLayerForTool(tool.value);
    engine.highlight = context && context !== "ruins" ? LOOKS[context] : null;
    ruinsAutoShown.value = context === "ruins";
  });
}
