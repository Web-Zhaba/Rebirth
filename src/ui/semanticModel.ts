import { L } from "../i18n";
export const LANDMARK_LABELS = {
  map: L("Игровая карта Rebirth", "Rebirth game map"),
  interface: L("Интерфейс игры", "Game interface"),
  status: L("Состояние поселения", "Settlement status"),
  build: L("Строительство", "Building"),
  summaries: L("Сводки дня", "Daily reports"),
  layers: L("Слои карты", "Map layers"),
  builders: L("Задачи строителей", "Builders’ tasks"),
} as const;

export const landmarkLabels = Object.values(LANDMARK_LABELS);
