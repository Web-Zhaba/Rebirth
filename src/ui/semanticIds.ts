export const SEMANTIC_IDS = {
  layerControls: "map-layer-controls",
  notebookPanel: "notebook-panel",
  notebookTitle: "notebook-title",
  townPanel: "town-panel",
  techPanel: "tech-panel",
  daySummaryTitle: "day-summary-title",
  eventCardTitle: "event-card-title",
  buildingInspectorTitle: "building-inspector-title",
  clearingInspectorTitle: "clearing-inspector-title",
  heritageInspectorTitle: "heritage-inspector-title",
  foundCityTitle: "found-city-title",
} as const;

export const semanticIds = Object.values(SEMANTIC_IDS);
