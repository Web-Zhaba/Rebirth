import { L } from "../i18n";
export interface HotkeyRow {
  keys: string[];
  desc: string;
}

export interface HotkeySection {
  title: string;
  rows: HotkeyRow[];
}

export const HOTKEY_SECTIONS: HotkeySection[] = [
  {
    title: L("Время и перемещение", "Time and movement"),
    rows: [
      { keys: ["Space", "P"], desc: L("Пауза / продолжить симуляцию", "Pause / resume the simulation") },
      { keys: ["1", "2", "3"], desc: L("Скорость игры (1×, 2×, 4×)", "Game speed (1×, 2×, 4×)") },
      { keys: ["H", "Home"], desc: L("К центру поселения", "To the settlement centre") },
      { keys: ["N"], desc: L("Наука: дерево исследований", "Research: the technology tree") },
    ],
  },
  {
    title: L("Строительство", "Building"),
    rows: [
      { keys: ["F1 – F6"], desc: L("Категории (Дороги, Город, Еда, Ресурсы, Службы, Прошлое)", "Categories (Roads, Town, Food, Resources, Services, Past)") },
      { keys: ["Q – I"], desc: L("Выбор инструмента в выбранной категории", "Pick a tool in the open category") },
      { keys: ["B"], desc: L("Снос (Бульдозер)", "Demolish (Bulldozer)") },
    ],
  },
  {
    title: L("Управление", "Controls"),
    rows: [
      { keys: ["Esc", L("ПКМ", "RMB")], desc: L("Отмена инструмента / разрыв дороги / закрыть панель", "Cancel tool / break the road / close the panel") },
      { keys: ["F10"], desc: L("Скрыть / показать HUD (режим скриншота)", "Hide / show the HUD (screenshot mode)") },
      { keys: ["?"], desc: L("Открыть эту шпаргалку клавиш", "Open this shortcut sheet") },
    ],
  },
];

export const hasHotkey = (key: string): boolean => HOTKEY_SECTIONS.some((s) => s.rows.some((r) => r.keys.includes(key)));
