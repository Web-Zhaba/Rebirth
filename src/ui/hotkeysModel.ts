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
    title: "Время и перемещение",
    rows: [
      { keys: ["Space", "P"], desc: "Пауза / продолжить симуляцию" },
      { keys: ["1", "2", "3"], desc: "Скорость игры (1×, 2×, 4×)" },
      { keys: ["H", "Home"], desc: "К центру поселения" },
      { keys: ["N"], desc: "Наука: дерево исследований" },
    ],
  },
  {
    title: "Строительство",
    rows: [
      { keys: ["F1 – F5"], desc: "Категории (Дороги, Зоны, Хозяйство, Службы, Прошлое)" },
      { keys: ["Q – Y"], desc: "Выбор инструмента в выбранной категории" },
      { keys: ["B"], desc: "Снос (Бульдозер)" },
    ],
  },
  {
    title: "Управление",
    rows: [
      { keys: ["Esc", "ПКМ"], desc: "Отмена инструмента / разрыв дороги / закрыть панель" },
      { keys: ["Enter"], desc: "Быстрый безопасный выбор в карточке события" },
      { keys: ["F10"], desc: "Скрыть / показать HUD (режим скриншота)" },
      { keys: ["?"], desc: "Открыть эту шпаргалку клавиш" },
    ],
  },
];

export const hasHotkey = (key: string): boolean => HOTKEY_SECTIONS.some((s) => s.rows.some((r) => r.keys.includes(key)));
