// Load-time migration of stored player-visible texts (chronicle, events, day summary, pending choice) that were written
// with the old folk vocabulary. Whole-word rules, applied top to bottom; phrases come before the single words they contain.
// A rule is [pattern, replacement, caseSensitive?]: case-insensitive rules keep the capital letter of the match.

const W = (alts: string): string => `(?<![\\p{L}])(?:${alts})(?![\\p{L}])`;

export const LEGACY_TERMS: [RegExp, string, boolean?][] = [
  // phrases
  [new RegExp(W("загорелась пустая изба"), "iu"), "загорелся пустой дом"],
  [new RegExp(W("загорелась изба"), "iu"), "загорелся дом"],
  [new RegExp(W("изба сгорела"), "iu"), "дом сгорел"],
  [new RegExp(W("изба сгорит"), "iu"), "дом сгорит"],
  [new RegExp(W("изба уцелела"), "iu"), "дом уцелел"],
  [new RegExp(W("изба уцелеет"), "iu"), "дом уцелеет"],
  [new RegExp(W("поставлена первая охотничья избушка"), "iu"), "поставлен первый охотничий пост"],
  [new RegExp(W("охотничья избушка|охотничью избушку|охотничьей избушки"), "iu"), "охотничий пост"],
  [new RegExp(W("охотничьи избушки"), "iu"), "охотничьи посты"],
  [new RegExp(W("сдали в общину"), "iu"), "сдали в общий запас"],
  [new RegExp(W("сдать в общину"), "iu"), "сдать в общий запас"],
  [new RegExp(W("скоморохи"), "iu"), "бродячие музыканты"],
  [new RegExp(W("изба перестроена"), "iu"), "дом расширен"],
  [new RegExp(W("улучшение изб"), "iu"), "расширение домов"],
  [new RegExp(W("построена первая лавка"), "iu"), "построен первый магазин"],
  [new RegExp(W("построен первый постоялый двор"), "iu"), "построена первая таверна"],
  [new RegExp(W("построено первое гумно"), "iu"), "построена первая ферма"],
  [new RegExp(W("построена первая делянка лесоруба"), "iu"), "построена первая лесозаготовка"],
  [new RegExp(W("построена первая избушка рыбака"), "iu"), "построен первый рыболовный причал"],
  [new RegExp(W("построена первая каменоломня"), "iu"), "построен первый карьер"],
  [new RegExp(W("построена первая часовня"), "iu"), "построен первый храм"],
  [new RegExp(W("первый пятистенок"), "iu"), "первый большой дом"],
  [new RegExp(W("артель берётся"), "iu"), "строители берутся"],
  [new RegExp(W("артель потеряет"), "iu"), "строители потеряют"],
  [new RegExp(W("артель рубит"), "iu"), "строители рубят"],
  [new RegExp(W("постоялый двор"), "iu"), "таверна"],
  [new RegExp(W("постоялого двора"), "iu"), "таверны"],
  [new RegExp(W("постоялом дворе"), "iu"), "таверне"],
  // housing
  [new RegExp(W("пятистенок"), "iu"), "большой дом"],
  [new RegExp(W("пятистенка"), "iu"), "большого дома"],
  [new RegExp(W("пятистенке"), "iu"), "большом доме"],
  [new RegExp(W("избушка|избушку|избушки|избушке|избушкой"), "iu"), "домик"],
  [new RegExp(W("изба|избу"), "iu"), "дом"],
  [new RegExp(W("избы"), "iu"), "дома"],
  [new RegExp(W("избе"), "iu"), "доме"],
  [new RegExp(W("избой"), "iu"), "домом"],
  [new RegExp(W("изб"), "iu"), "домов"],
  [new RegExp(W("избам"), "iu"), "домам"],
  [new RegExp(W("избах"), "iu"), "домах"],
  // buildings
  [new RegExp(W("гумно|гумна|гумне|гумну"), "iu"), "ферма"],
  [new RegExp(W("пильня|пильню"), "iu"), "лесопилка"],
  [new RegExp(W("пильни"), "iu"), "лесопилки"],
  [new RegExp(W("пильне"), "iu"), "лесопилке"],
  [new RegExp(W("каменоломня|каменоломню"), "iu"), "карьер"],
  [new RegExp(W("каменоломни"), "iu"), "карьера"],
  [new RegExp(W("каменоломне"), "iu"), "карьере"],
  [new RegExp(W("амбар"), "iu"), "склад"],
  [new RegExp(W("амбара"), "iu"), "склада"],
  [new RegExp(W("амбаре"), "iu"), "складе"],
  [new RegExp(W("амбары"), "iu"), "склады"],
  [new RegExp(W("амбаров"), "iu"), "складов"],
  [new RegExp(W("амбарах"), "iu"), "складах"],
  [new RegExp(W("лавка|лавку"), "iu"), "магазин"],
  [new RegExp(W("лавки"), "iu"), "магазина"],
  [new RegExp(W("лавке"), "iu"), "магазине"],
  [new RegExp(W("часовня|часовню"), "iu"), "храм"],
  [new RegExp(W("часовни"), "iu"), "храма"],
  [new RegExp(W("часовне"), "iu"), "храме"],
  [new RegExp(W("Лекарь"), "u"), "Лечебница", true],
  [new RegExp(W("лекарь"), "u"), "врач", true],
  [new RegExp(W("лекаря"), "iu"), "врача"],
  // goods
  [new RegExp(W("провизия"), "iu"), "еда"],
  [new RegExp(W("провизии"), "iu"), "еды"],
  [new RegExp(W("провизию"), "iu"), "еду"],
  [new RegExp(W("провизией"), "iu"), "едой"],
  [new RegExp(W("утварь"), "iu"), "товары"],
  [new RegExp(W("утвари"), "iu"), "товаров"],
  [new RegExp(W("утварью"), "iu"), "товарами"],
  // levers and time of day
  [new RegExp(W("толока"), "iu"), "общий сбор"],
  [new RegExp(W("толоку"), "iu"), "общий сбор"],
  [new RegExp(W("толоки"), "iu"), "общего сбора"],
  [new RegExp(W("страда"), "iu"), "долгий день"],
  [new RegExp(W("страды"), "iu"), "долгого дня"],
  [new RegExp(W("посиделки"), "iu"), "вечерние ремёсла"],
  [new RegExp(W("пайки"), "iu"), "нормы еды"],
  [new RegExp(W("пайков"), "iu"), "норм еды"],
  [new RegExp(W("скромные"), "iu"), "урезанные"],
  [new RegExp(W("артель"), "iu"), "строители"],
  [new RegExp(W("скоморохов"), "iu"), "музыкантов"],
  [new RegExp(W("скоморохам"), "iu"), "музыкантам"],
  [new RegExp(W("скоморохом"), "iu"), "музыкантом"],
  [new RegExp(W("скоморох"), "iu"), "музыкант"],
  [new RegExp(W("общину"), "iu"), "общий запас"],
  [new RegExp(W("летопись"), "iu"), "хроника"],
  [new RegExp(W("жатва"), "iu"), "уборка урожая"],
  [new RegExp(W("жатву"), "iu"), "уборку урожая"],
  [new RegExp(W("жатвы"), "iu"), "уборки урожая"],
];

const capitalized = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Old words -> universal ones in one stored text.
export function migrateText(text: string): string {
  let out = text;
  for (const [re, to, exact] of LEGACY_TERMS) {
    out = out.replace(re, (m) => (!exact && m.charAt(0) !== m.charAt(0).toLowerCase() ? capitalized(to) : to));
  }
  return out;
}
