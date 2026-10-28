/**
 * Temporary, URL-driven isolation switches for the custom terrain zoom stall.
 *
 * All *-off-base tests suppress the custom renderers so the remaining transition
 * parts can be compared without a change in renderer workload.
 */
const query = typeof window === "undefined" ? "" : window.location.search;
const requested = new URLSearchParams(query).get("terrainDiag");

export type TerrainDiagnosticMode =
  | "normal"
  | "layers-off"
  | "projection-off"
  | "transition-off"
  | "camera-off"
  | "visibility-off"
  | "projection-off-base"
  | "center-off"
  | "center-set-off"
  | "dem-load-off"
  | "dem-no-retry";

export const terrainDiagnosticMode: TerrainDiagnosticMode =
  requested === "layers-off" ||
  requested === "projection-off" ||
  requested === "transition-off" ||
  requested === "camera-off" ||
  requested === "visibility-off" ||
  requested === "projection-off-base" ||
  requested === "center-off" ||
  requested === "center-set-off" ||
  requested === "dem-load-off" ||
  requested === "dem-no-retry"
    ? requested
    : "normal";

export const disableTerrainTransition = terrainDiagnosticMode === "transition-off";

export const disableCustomTerrainRenderers =
  terrainDiagnosticMode === "layers-off" ||
  terrainDiagnosticMode === "transition-off" ||
  terrainDiagnosticMode === "camera-off" ||
  terrainDiagnosticMode === "visibility-off" ||
  terrainDiagnosticMode === "projection-off-base" ||
  terrainDiagnosticMode === "center-off" ||
  terrainDiagnosticMode === "center-set-off" ||
  terrainDiagnosticMode === "dem-load-off";

export const disableProjectionTransition =
  terrainDiagnosticMode === "projection-off" ||
  terrainDiagnosticMode === "transition-off" ||
  terrainDiagnosticMode === "projection-off-base";

export const disableTerrainCameraSync =
  disableTerrainTransition || terrainDiagnosticMode === "camera-off";
export const disableTerrainCenterElevation = terrainDiagnosticMode === "center-off";
export const disableTerrainCenterSet = terrainDiagnosticMode === "center-set-off" || terrainDiagnosticMode === "dem-load-off";
export const disableDemLoading = terrainDiagnosticMode === "dem-load-off";
export const disableDemRetrySync = terrainDiagnosticMode === "dem-no-retry";

export const disableBaseLayerVisibilityTransition =
  disableTerrainTransition || terrainDiagnosticMode === "visibility-off";

if (terrainDiagnosticMode !== "normal") {
  console.info(`[terrain diagnostic] mode=${terrainDiagnosticMode}`);
}
