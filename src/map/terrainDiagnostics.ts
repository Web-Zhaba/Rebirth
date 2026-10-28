/**
 * Temporary, URL-driven isolation switches for the custom terrain zoom stall.
 *
 * Use one mode at a time on the preview deployment:
 *   ?terrainDiag=layers-off      Keep the projection/camera transition, skip custom 3D renderers.
 *   ?terrainDiag=projection-off Keep custom 3D renderers, skip setProjection transitions.
 *
 * Remove this module once the failing subsystem is identified.
 */
const query = typeof window === "undefined" ? "" : window.location.search;
const requested = new URLSearchParams(query).get("terrainDiag");

export type TerrainDiagnosticMode = "normal" | "layers-off" | "projection-off";

export const terrainDiagnosticMode: TerrainDiagnosticMode =
  requested === "layers-off" || requested === "projection-off"
    ? requested
    : "normal";

export const disableCustomTerrainRenderers = terrainDiagnosticMode === "layers-off";
export const disableProjectionTransition = terrainDiagnosticMode === "projection-off";

if (terrainDiagnosticMode !== "normal") {
  console.info(`[terrain diagnostic] mode=${terrainDiagnosticMode}`);
}
