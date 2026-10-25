import { describe, expect, it } from "vitest";
import { migrateText } from "./legacyText";

describe("migrateText", () => {
  it("replaces old words with universal ones, keeping case and agreement", () => {
    expect(migrateText("Изба перестроена")).toBe("Дом расширен");
    expect(migrateText("Построена первая лавка")).toBe("Построен первый магазин");
    expect(migrateText("Построен первый постоялый двор")).toBe("Построена первая таверна");
    expect(migrateText("Построено первое гумно")).toBe("Построена первая ферма");
    expect(migrateText("Построена первая каменоломня")).toBe("Построен первый карьер");
    expect(migrateText("Пропало 40 кг провизии: не хватает амбаров")).toBe("Пропало 40 кг еды: не хватает складов");
    expect(migrateText("Обменяли 10 шт утвари на 2 м³ досок")).toBe("Обменяли 10 шт товаров на 2 м³ досок");
    expect(migrateText("Толока: все взрослые идут на дом")).toBe("Общий сбор: все взрослые идут на дом");
    expect(migrateText("Страда: работают с 5 до 21 часов")).toBe("Долгий день: работают с 5 до 21 часов");
    expect(migrateText("Артель потеряет около 10 чел.-ч")).toBe("Строители потеряют около 10 чел.-ч");
    expect(migrateText("Лекаря рядом нет.")).toBe("Врача рядом нет.");
    expect(migrateText("Поставлена первая охотничья избушка")).toBe("Поставлен первый охотничий пост");
    expect(migrateText("Загорелась изба семьи")).toBe("Загорелся дом семьи");
    expect(migrateText("В посёлок пришли скоморохи")).toBe("В посёлок пришли бродячие музыканты");
    expect(migrateText("Скоморохов прогнали")).toBe("Музыкантов прогнали");
    expect(migrateText("Сдать в общину")).toBe("Сдать в общий запас");
  });
  it("leaves current texts and longer words alone", () => {
    for (const t of ["Дом расширен", "Хроника пуста", "Избыток досок", "Вырубка готова"]) expect(migrateText(t)).toBe(t);
  });
});
